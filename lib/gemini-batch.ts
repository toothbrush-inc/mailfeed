import { GoogleGenAI, JobState, type GenerateContentResponse, type InlinedRequest } from "@google/genai"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { buildClientRegistry } from "@/lib/baml-registry"
import { BAML_CLIENTS, isAiConfigured } from "@/lib/ai-provider"
import {
  analyzeLink,
  persistLinkAnalysis,
  recordAnalysisFailure,
  markInsufficientContent,
  analyzableWordCount,
  analyzableText,
  MAX_AUTO_ANALYSIS_ATTEMPTS,
  MIN_ANALYZABLE_WORDS,
  type LinkAnalysisInput,
} from "@/lib/analysis"
import {
  generateAndStoreEmbedding,
  generateEmbedding,
  persistLinkEmbedding,
  persistEmailEmbedding,
  prepareTextForEmbedding,
  prepareEmailForEmbedding,
} from "@/lib/embeddings"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys, resolveGeminiKey, type AiKeys } from "@/lib/user-keys"
import { FEATURE_FLAGS } from "@/lib/flags"
import type { ResolvedSettings } from "@/lib/settings"
import { createLogger } from "@/lib/logger"
import { recordAiUsage } from "@/lib/ai-usage"

const log = createLogger("GeminiBatch")

export const LIVE_AI_THRESHOLD = Number(process.env.MAILFEED_LIVE_AI_THRESHOLD) || 15
const BATCH_CHUNK_SIZE = 100
const MAX_HTML_CHARS = 24_000
const IN_FLIGHT = ["PENDING", "RUNNING"]
// Gemini expires batch jobs after 48h. Past this, a batch that still is not
// finished (or cannot be looked up) is expired locally and its items requeued.
const BATCH_STALE_MS = 72 * 60 * 60 * 1000

export type GeminiBatchKind = "ANALYZE_LINKS" | "EMBED_LINKS" | "EMBED_EMAILS"

function genAI(apiKey: string) {
  return new GoogleGenAI({ apiKey })
}

export function isGeminiAnalysisClient(settings: ResolvedSettings): boolean {
  const client = BAML_CLIENTS.find((c) => c.name === settings.ai.bamlClient)
  return client?.provider === "google-ai"
}

async function inFlightItemIds(userId: string, kind: GeminiBatchKind): Promise<Set<string>> {
  const rows = await prisma.geminiBatch.findMany({
    where: { userId, kind, status: { in: IN_FLIGHT } },
    select: { itemIds: true },
  })
  return new Set(rows.flatMap((r) => r.itemIds))
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function responseText(response?: GenerateContentResponse | null): string | null {
  if (!response) return null
  const direct = response.text
  if (typeof direct === "string" && direct.trim()) return direct
  const parts = response.candidates?.[0]?.content?.parts
  if (!parts) return null
  const joined = parts.map((p) => p.text || "").join("")
  return joined.trim() || null
}

function bamlBodyToInline(
  body: Record<string, unknown>,
  metadata: Record<string, string>
): InlinedRequest | null {
  const contents = body.contents ?? body.Contents
  if (!contents) return null
  const generationConfig = (body.generationConfig ??
    body.generation_config ??
    body.config) as Record<string, unknown> | undefined
  const config: NonNullable<InlinedRequest["config"]> = {}
  if (generationConfig) {
    const mime =
      (typeof generationConfig.responseMimeType === "string" && generationConfig.responseMimeType) ||
      (typeof generationConfig.response_mime_type === "string" && generationConfig.response_mime_type) ||
      undefined
    if (mime) config.responseMimeType = mime
    if (generationConfig.responseSchema) config.responseSchema = generationConfig.responseSchema
    else if (generationConfig.response_schema) config.responseSchema = generationConfig.response_schema
    if (typeof generationConfig.temperature === "number") config.temperature = generationConfig.temperature
  }
  if (body.systemInstruction) config.systemInstruction = body.systemInstruction as never
  else if (body.system_instruction) config.systemInstruction = body.system_instruction as never
  return {
    contents: contents as InlinedRequest["contents"],
    config: Object.keys(config).length ? config : undefined,
    metadata,
  }
}

async function recordBatch(
  userId: string,
  kind: GeminiBatchKind,
  geminiName: string,
  itemIds: string[],
  model: string
) {
  await prisma.geminiBatch.create({
    data: {
      userId,
      kind,
      geminiName,
      itemIds,
      model,
      status: "PENDING",
    },
  })
}

async function markAnalyzeStatus(userId: string, ids: string[], status: "ANALYZING" | "FETCHED") {
  if (ids.length === 0) return
  await prisma.link.updateMany({
    where: { userId, id: { in: ids } },
    data: { fetchStatus: status },
  })
}

async function markEmbedStatus(
  userId: string,
  ids: string[],
  kind: "EMBED_LINKS" | "EMBED_EMAILS",
  status: string,
  error?: string
) {
  if (ids.length === 0) return
  const data = { embeddingStatus: status, embeddingError: error ?? null }
  if (kind === "EMBED_LINKS") {
    await prisma.link.updateMany({ where: { userId, id: { in: ids } }, data })
  } else {
    await prisma.email.updateMany({ where: { userId, id: { in: ids } }, data })
  }
}

/**
 * Apply parsed analysis to links. Never writes a row that is not owned by userId.
 */
export async function applyLinkAnalysisResults(
  userId: string,
  items: Array<{ id: string; analysis: LinkAnalysisInput | null; error?: string }>
): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0
  for (const item of items) {
    if (!item.analysis) {
      await recordAnalysisFailure(userId, [item.id], item.error || "No analysis in batch response")
      skipped++
      continue
    }
    const ok = await persistLinkAnalysis(item.id, userId, item.analysis)
    if (ok) applied++
    else skipped++
  }
  return { applied, skipped }
}

/**
 * Apply embeddings. Never writes a row that is not owned by userId.
 */
export async function applyLinkEmbeddingResults(
  userId: string,
  items: Array<{ id: string; embedding: number[] | null }>
): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0
  for (const item of items) {
    if (!item.embedding) {
      await markEmbedStatus(userId, [item.id], "EMBED_LINKS", "FAILED", "No embedding in batch response")
      skipped++
      continue
    }
    const ok = await persistLinkEmbedding(item.id, userId, item.embedding)
    if (ok) applied++
    else {
      skipped++
      await markEmbedStatus(userId, [item.id], "EMBED_LINKS", "FAILED", "Link not found for user")
    }
  }
  return { applied, skipped }
}

export async function applyEmailEmbeddingResults(
  userId: string,
  items: Array<{ id: string; embedding: number[] | null }>
): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0
  for (const item of items) {
    if (!item.embedding) {
      await markEmbedStatus(userId, [item.id], "EMBED_EMAILS", "FAILED", "No embedding in batch response")
      skipped++
      continue
    }
    const ok = await persistEmailEmbedding(item.id, userId, item.embedding)
    if (ok) applied++
    else {
      skipped++
      await markEmbedStatus(userId, [item.id], "EMBED_EMAILS", "FAILED", "Email not found for user")
    }
  }
  return { applied, skipped }
}

async function liveAnalyze(userId: string, ids: string[], settings: ResolvedSettings, aiKeys: AiKeys) {
  for (const id of ids) {
    await analyzeLink(id, settings, aiKeys, userId)
  }
}

async function liveEmbedLinks(userId: string, ids: string[], settings: ResolvedSettings, aiKeys: AiKeys) {
  for (const id of ids) {
    await generateAndStoreEmbedding(id, userId, settings, "RETRIEVAL_DOCUMENT", aiKeys)
  }
}

async function liveEmbedEmails(userId: string, ids: string[], settings: ResolvedSettings, aiKeys: AiKeys) {
  const emails = await prisma.email.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, subject: true, rawContent: true, snippet: true },
  })
  for (const email of emails) {
    const text = prepareEmailForEmbedding(email)
    if (!text) {
      await markEmbedStatus(userId, [email.id], "EMBED_EMAILS", "SKIPPED", "No content available for embedding")
      continue
    }
    await markEmbedStatus(userId, [email.id], "EMBED_EMAILS", "PROCESSING")
    try {
      const embedding = await generateEmbedding(text, "RETRIEVAL_DOCUMENT", settings, aiKeys)
      const ok = await persistEmailEmbedding(email.id, userId, embedding)
      if (!ok) await markEmbedStatus(userId, [email.id], "EMBED_EMAILS", "FAILED", "Email not found for user")
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      await markEmbedStatus(userId, [email.id], "EMBED_EMAILS", "FAILED", msg)
    }
  }
}

async function submitAnalyzeBatch(
  userId: string,
  ids: string[],
  settings: ResolvedSettings,
  aiKeys: AiKeys,
  apiKey: string
) {
  const model = BAML_CLIENTS.find((c) => c.name === settings.ai.bamlClient)?.model || "gemini-3.1-pro-preview"
  const links = await prisma.link.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, url: true, title: true, rawHtml: true, contentText: true },
  })
  const clientRegistry = buildClientRegistry(settings, aiKeys)
  const requests: InlinedRequest[] = []
  const orderedIds: string[] = []

  const thin = links.filter((l) => analyzableWordCount(analyzableText(l)) < MIN_ANALYZABLE_WORDS)
  await markInsufficientContent(userId, thin.map((l) => l.id))
  const thinIds = new Set(thin.map((l) => l.id))

  for (const link of links.filter((l) => !thinIds.has(l.id))) {
    const html = (link.rawHtml || link.contentText || "").slice(0, MAX_HTML_CHARS) || undefined
    try {
      const httpReq = await b.request.IngestLink(link.url, link.title || link.url, html, {
        clientRegistry,
        env: { GEMINI_API_KEY: apiKey },
      })
      const body = httpReq.body.json() as Record<string, unknown>
      const inline = bamlBodyToInline(body, { itemId: link.id })
      if (!inline) {
        log.warn("Could not map BAML request to batch; falling back live for link", { id: link.id })
        await analyzeLink(link.id, settings, aiKeys, userId)
        continue
      }
      requests.push(inline)
      orderedIds.push(link.id)
    } catch (error) {
      log.warn("BAML request build failed; live analyze", {
        id: link.id,
        error: error instanceof Error ? error.message : String(error),
      })
      await analyzeLink(link.id, settings, aiKeys, userId)
    }
  }

  if (requests.length === 0) return

  await markAnalyzeStatus(userId, orderedIds, "ANALYZING")
  try {
    const job = await genAI(apiKey).batches.create({
      model,
      src: requests,
      config: { displayName: `mailfeed-analyze-${userId.slice(0, 8)}` },
    })
    if (!job.name) throw new Error("Gemini batch create returned no name")
    await recordBatch(userId, "ANALYZE_LINKS", job.name, orderedIds, model)
    log.info("Submitted analyze batch", { userId, count: orderedIds.length, name: job.name })
  } catch (error) {
    await markAnalyzeStatus(userId, orderedIds, "FETCHED")
    log.warn("Analyze batch create failed; running live", {
      error: error instanceof Error ? error.message : String(error),
    })
    await liveAnalyze(userId, orderedIds, settings, aiKeys)
  }
}

async function submitEmbedBatch(
  userId: string,
  kind: "EMBED_LINKS" | "EMBED_EMAILS",
  items: Array<{ id: string; text: string }>,
  settings: ResolvedSettings,
  apiKey: string
) {
  if (items.length === 0) return
  const model = settings.ai.embeddingModel
  const ids = items.map((i) => i.id)
  await markEmbedStatus(userId, ids, kind, "PROCESSING")
  try {
    const job = await genAI(apiKey).batches.createEmbeddings({
      model,
      src: {
        inlinedRequests: {
          contents: items.map((i) => i.text),
          config: {
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: settings.ai.embeddingDimensions,
          },
        },
      },
      config: { displayName: `mailfeed-embed-${kind}-${userId.slice(0, 8)}` },
    })
    if (!job.name) throw new Error("Gemini embeddings batch create returned no name")
    await recordBatch(userId, kind, job.name, ids, model)
    log.info("Submitted embed batch", { userId, kind, count: ids.length, name: job.name })
  } catch (error) {
    await markEmbedStatus(userId, ids, kind, "PENDING")
    log.warn("Embed batch create failed; running live", {
      kind,
      error: error instanceof Error ? error.message : String(error),
    })
    const aiKeys = await getUserAiKeys(userId)
    if (kind === "EMBED_LINKS") {
      await liveEmbedLinks(userId, ids, settings, aiKeys)
    } else {
      await liveEmbedEmails(userId, ids, settings, aiKeys)
    }
  }
}

// Live analysis sets ANALYZING and has no batch row, so a process that dies
// mid-call leaves the link there. Far longer than any live call or batch.
const INTERRUPTED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Hand links left in ANALYZING by an interrupted live analysis back to the
 * submit pass. Counts as a failed attempt, so MAX_AUTO_ANALYSIS_ATTEMPTS
 * stops a link that keeps killing the process from looping.
 */
export async function recoverInterruptedAnalysis(userId: string): Promise<number> {
  const busy = await inFlightItemIds(userId, "ANALYZE_LINKS")
  const stuck = await prisma.link.findMany({
    where: {
      userId,
      fetchStatus: "ANALYZING",
      updatedAt: { lt: new Date(Date.now() - INTERRUPTED_AFTER_MS) },
    },
    select: { id: true },
  })
  const ids = stuck.map((l) => l.id).filter((id) => !busy.has(id))
  if (ids.length === 0) return 0
  await recordAnalysisFailure(userId, ids, "Analysis was interrupted")
  log.warn("Requeued interrupted analysis", { userId, count: ids.length })
  return ids.length
}

export async function submitPendingAiForUser(userId: string): Promise<void> {
  const [settings, aiKeys] = await Promise.all([
    getUserSettings(userId),
    getUserAiKeys(userId),
  ])
  const geminiKey = resolveGeminiKey(aiKeys)
  const analysisConfigured = isAiConfigured(settings, aiKeys)

  if (FEATURE_FLAGS.enableAnalysis && settings.analysis.enabled && analysisConfigured) {
    const busy = await inFlightItemIds(userId, "ANALYZE_LINKS")
    const pending = await prisma.link.findMany({
      where: {
        userId,
        fetchStatus: "FETCHED",
        analyzedAt: null,
        analysisAttempts: { lt: MAX_AUTO_ANALYSIS_ATTEMPTS },
        OR: [{ rawHtml: { not: null } }, { contentText: { not: null } }],
      },
      select: { id: true },
      take: 500,
    })
    const ids = pending.map((p) => p.id).filter((id) => !busy.has(id))
    if (ids.length > 0) {
      const useGeminiBatch = isGeminiAnalysisClient(settings) && !!geminiKey && ids.length > LIVE_AI_THRESHOLD
      if (useGeminiBatch) {
        for (const part of chunk(ids, BATCH_CHUNK_SIZE)) {
          await submitAnalyzeBatch(userId, part, settings, aiKeys, geminiKey)
        }
      } else {
        await liveAnalyze(userId, ids, settings, aiKeys)
      }
    }
  }

  if (!geminiKey || !settings.embeddings.enabled) return

  const busyLinks = await inFlightItemIds(userId, "EMBED_LINKS")
  const embedLinks = await prisma.link.findMany({
    where: {
      userId,
      embeddingStatus: { in: ["PENDING", "FAILED"] },
      OR: [{ contentText: { not: null } }, { description: { not: null } }, { aiSummary: { not: null } }, { title: { not: null } }],
    },
    select: { id: true, title: true, contentText: true, description: true, aiSummary: true },
    take: 500,
  })
  const linkItems = embedLinks
    .filter((l) => !busyLinks.has(l.id))
    .map((l) => ({ id: l.id, text: prepareTextForEmbedding(l) }))
    .filter((l): l is { id: string; text: string } => !!l.text)

  if (linkItems.length > 0) {
    if (linkItems.length > LIVE_AI_THRESHOLD) {
      for (const part of chunk(linkItems, BATCH_CHUNK_SIZE)) {
        await submitEmbedBatch(userId, "EMBED_LINKS", part, settings, geminiKey)
      }
    } else {
      await liveEmbedLinks(userId, linkItems.map((i) => i.id), settings, aiKeys)
    }
  }

  const busyEmails = await inFlightItemIds(userId, "EMBED_EMAILS")
  const embedEmails = await prisma.email.findMany({
    where: {
      userId,
      embeddingStatus: { in: ["PENDING", "FAILED"] },
    },
    select: { id: true, subject: true, rawContent: true, snippet: true },
    take: 500,
  })
  const emailItems = embedEmails
    .filter((e) => !busyEmails.has(e.id))
    .map((e) => ({ id: e.id, text: prepareEmailForEmbedding(e) }))
    .filter((e): e is { id: string; text: string } => !!e.text)

  if (emailItems.length > 0) {
    if (emailItems.length > LIVE_AI_THRESHOLD) {
      for (const part of chunk(emailItems, BATCH_CHUNK_SIZE)) {
        await submitEmbedBatch(userId, "EMBED_EMAILS", part, settings, geminiKey)
      }
    } else {
      await liveEmbedEmails(userId, emailItems.map((i) => i.id), settings, aiKeys)
    }
  }
}

function jobStatusFromState(state?: JobState): string {
  switch (state) {
    case JobState.JOB_STATE_SUCCEEDED:
      return "SUCCEEDED"
    case JobState.JOB_STATE_FAILED:
      return "FAILED"
    case JobState.JOB_STATE_EXPIRED:
      return "EXPIRED"
    case JobState.JOB_STATE_CANCELLED:
      return "CANCELLED"
    case JobState.JOB_STATE_RUNNING:
    case JobState.JOB_STATE_PENDING:
    case JobState.JOB_STATE_QUEUED:
      return "RUNNING"
    default:
      return "PENDING"
  }
}

async function revertFailed(userId: string, kind: GeminiBatchKind, itemIds: string[], error: string) {
  if (kind === "ANALYZE_LINKS") {
    await recordAnalysisFailure(userId, itemIds, `Gemini batch failed: ${error}`)
  } else {
    await markEmbedStatus(userId, itemIds, kind, "FAILED", error)
  }
}

type BatchRow = {
  id: string
  userId: string
  geminiName: string
  kind: string
  itemIds: string[]
  model: string | null
  submittedAt: Date
}

// Close out a batch locally and hand its items back to the next submit pass.
async function failBatch(row: BatchRow, status: string, error: string) {
  await revertFailed(row.userId, row.kind as GeminiBatchKind, row.itemIds, error)
  await prisma.geminiBatch.update({
    where: { id: row.id },
    data: { status, error, completedAt: new Date() },
  })
}

async function expireBatch(row: BatchRow, reason: string) {
  await failBatch(row, "EXPIRED", reason)
  log.warn("Expired stale batch", { id: row.id, userId: row.userId, name: row.geminiName, reason })
}

async function reapOne(row: BatchRow): Promise<void> {
  // Past this we stop waiting, but a finished job is still applied first.
  const stale = Date.now() - row.submittedAt.getTime() > BATCH_STALE_MS

  const aiKeys = await getUserAiKeys(row.userId)
  const apiKey = resolveGeminiKey(aiKeys)
  if (!apiKey) {
    if (stale) return expireBatch(row, "No Gemini key to collect batch within 72h")
    log.warn("No Gemini key to reap batch", { id: row.id, userId: row.userId })
    return
  }

  const ai = genAI(apiKey)
  let job: Awaited<ReturnType<typeof ai.batches.get>>
  try {
    job = await ai.batches.get({ name: row.geminiName })
  } catch (error) {
    if (!stale) throw error
    const msg = error instanceof Error ? error.message : String(error)
    return expireBatch(row, `Batch lookup still failing after 72h: ${msg}`)
  }
  const status = jobStatusFromState(job.state)

  if (status === "PENDING" || status === "RUNNING") {
    if (stale) {
      // Results would be dropped anyway; stop paying for the job.
      await ai.batches.cancel({ name: row.geminiName }).catch((error) => {
        log.warn("Cancel of stale batch failed", {
          name: row.geminiName,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      return expireBatch(row, "Batch still running after 72h")
    }
    if (status !== "PENDING") {
      await prisma.geminiBatch.update({ where: { id: row.id }, data: { status: "RUNNING" } })
    }
    return
  }

  if (status !== "SUCCEEDED") {
    const err = job.error?.message || status
    await failBatch(row, status, err)
    log.warn("Batch did not succeed", { name: row.geminiName, status, err })
    return
  }

  try {
    if (row.kind === "ANALYZE_LINKS") {
      const responses = job.dest?.inlinedResponses || []
      const items = row.itemIds.map((id, i) => {
        const text = responseText(responses[i]?.response)
        if (!text) {
          const error = responses[i]?.error?.message || "Empty response from Gemini batch"
          return { id, analysis: null, error }
        }
        try {
          return { id, analysis: b.parse.IngestLink(text) as LinkAnalysisInput }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.warn("Failed to parse analysis response", { itemId: id, error: message })
          return { id, analysis: null, error: `Could not parse analysis: ${message}` }
        }
      })
      const result = await applyLinkAnalysisResults(row.userId, items)
      log.info("Applied analyze batch", { userId: row.userId, ...result })
      await recordAiUsage(
        row.itemIds.map((id, i) => ({
          userId: row.userId,
          kind: "ANALYZE_LINK" as const,
          linkId: id,
          model: responses[i]?.response?.modelVersion || row.model || "unknown",
          usage: responses[i]?.response?.usageMetadata,
          batch: true,
        }))
      )
    } else if (row.kind === "EMBED_LINKS" || row.kind === "EMBED_EMAILS") {
      const responses = job.dest?.inlinedEmbedContentResponses || []
      const items = row.itemIds.map((id, i) => ({
        id,
        embedding: responses[i]?.response?.embedding?.values ?? null,
      }))
      const result =
        row.kind === "EMBED_LINKS"
          ? await applyLinkEmbeddingResults(row.userId, items)
          : await applyEmailEmbeddingResults(row.userId, items)
      log.info("Applied embed batch", { userId: row.userId, kind: row.kind, ...result })
    }

    await prisma.geminiBatch.update({
      where: { id: row.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    await failBatch(row, "FAILED", msg)
    log.error("Failed applying batch", error)
  }
}

export async function reapPendingBatches(): Promise<number> {
  const rows = await prisma.geminiBatch.findMany({
    where: { status: { in: IN_FLIGHT } },
    select: { id: true, userId: true, geminiName: true, kind: true, itemIds: true, model: true, submittedAt: true },
    orderBy: { submittedAt: "asc" },
    take: 50,
  })
  for (const row of rows) {
    try {
      await reapOne(row)
    } catch (error) {
      log.error("Reap failed", error, { id: row.id, name: row.geminiName })
    }
  }
  return rows.length
}
