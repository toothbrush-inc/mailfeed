import { Collector } from "@boundaryml/baml"
import type { LlmCall } from "@boundaryml/baml"
import { prisma } from "@/lib/prisma"
import { BAML_CLIENTS } from "@/lib/ai-provider"
import { priceCall } from "@/lib/ai-pricing"
import { createLogger } from "@/lib/logger"

const log = createLogger("AiUsage")

export type AiUsageKind = "ANALYZE_LINK" | "INGEST_EMAIL" | "CHAT"

export interface UsageContext {
  userId: string
  kind: AiUsageKind
  linkId?: string | null
}

/** Gemini's usageMetadata, as returned by generateContent and batch items. */
export interface GeminiUsage {
  promptTokenCount?: number | null
  candidatesTokenCount?: number | null
  thoughtsTokenCount?: number | null
}

export interface UsageRecord extends UsageContext {
  model: string
  usage: GeminiUsage | null | undefined
  batch?: boolean
}

function toRow({ userId, kind, linkId, model, usage, batch = false }: UsageRecord) {
  const inputTokens = usage?.promptTokenCount ?? 0
  const thinkingTokens = usage?.thoughtsTokenCount ?? 0
  // Gemini bills thinking as output but reports it separately.
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + thinkingTokens
  return {
    userId,
    kind,
    linkId: linkId ?? null,
    model,
    batch,
    inputTokens,
    outputTokens,
    thinkingTokens,
    costUsd: priceCall({ model, inputTokens, outputTokens, batch }),
  }
}

/**
 * Store token usage for AI calls. Never throws: losing a usage row must not
 * fail the analysis or chat it describes.
 */
export async function recordAiUsage(records: UsageRecord[]): Promise<void> {
  const rows = records.filter((r) => r.usage).map(toRow)
  if (rows.length === 0) return
  try {
    await prisma.aiUsage.createMany({ data: rows })
  } catch (error) {
    log.warn("Could not record AI usage", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// BAML's own Usage leaves out Gemini's thinking tokens, so prefer the raw
// usageMetadata from the response body and fall back to BAML's counts for
// other providers.
function usageFromCall(call: LlmCall): { model: string; usage: GeminiUsage } | null {
  let body: { usageMetadata?: GeminiUsage; modelVersion?: string } | undefined
  try {
    body = call.httpResponse?.body.json()
  } catch {
    body = undefined
  }
  const model =
    body?.modelVersion || BAML_CLIENTS.find((c) => c.name === call.clientName)?.model || call.clientName
  if (body?.usageMetadata) return { model, usage: body.usageMetadata }
  const usage = call.usage
  if (!usage || usage.inputTokens == null) return null
  return { model, usage: { promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens } }
}

/**
 * Run a BAML call with a collector attached and record what it cost,
 * whether it succeeded or not. Every call BAML made is recorded, since
 * retries and fallbacks are billed too.
 */
export async function withBamlUsage<T>(
  ctx: UsageContext,
  run: (collector: Collector) => Promise<T>
): Promise<T> {
  const collector = new Collector("ai-usage")
  try {
    return await run(collector)
  } finally {
    let records: UsageRecord[] = []
    try {
      const calls = (collector.last?.calls ?? []) as LlmCall[]
      records = calls.flatMap((call) => {
        const found = usageFromCall(call)
        return found ? [{ ...ctx, ...found }] : []
      })
    } catch (error) {
      log.warn("Could not read BAML usage", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    await recordAiUsage(records)
  }
}
