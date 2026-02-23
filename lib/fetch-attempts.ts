import { prisma } from "@/lib/prisma"
import type { FetchAttemptDetail } from "@/lib/fetchers"

// PostgreSQL text columns reject null bytes (0x00)
function stripNullBytes(s: string | undefined): string | undefined {
  return s?.replaceAll("\0", "")
}

export function generateOperationId(): string {
  return crypto.randomUUID()
}

export async function recordFetchAttempts(
  linkId: string,
  operationId: string,
  trigger: string,
  attempts: FetchAttemptDetail[]
) {
  if (attempts.length === 0) return

  await prisma.fetchAttempt.createMany({
    data: attempts.map((a) => ({
      linkId,
      operationId,
      fetcherId: a.fetcherId,
      fetcherName: a.fetcherName,
      trigger,
      sequence: a.sequence,
      success: a.success,
      error: stripNullBytes(a.error),
      rawHtml: stripNullBytes(a.rawHtml),
      durationMs: a.durationMs,
    })),
  })
}

export async function recordSingleFetchAttempt(
  linkId: string,
  trigger: string,
  detail: {
    fetcherId: string
    fetcherName: string
    success: boolean
    error?: string
    rawHtml?: string
    durationMs: number
  }
) {
  const operationId = generateOperationId()

  await prisma.fetchAttempt.create({
    data: {
      linkId,
      operationId,
      fetcherId: detail.fetcherId,
      fetcherName: detail.fetcherName,
      trigger,
      sequence: 1,
      success: detail.success,
      error: stripNullBytes(detail.error),
      rawHtml: stripNullBytes(detail.rawHtml),
      durationMs: detail.durationMs,
    },
  })
}
