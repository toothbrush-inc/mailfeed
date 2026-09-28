/**
 * Digest groups: every top-level link falls in exactly one, based on how far
 * it got through fetch → analysis and, if it stopped, why.
 */

import type { Prisma } from "@prisma/client"

export const DIGEST_BUCKETS = [
  "analyzed",
  "paywalled",
  "unreachable",
  "analysis_failed",
  "waiting",
  "hidden",
] as const

export type DigestBucket = (typeof DIGEST_BUCKETS)[number]

export function isDigestBucket(value: string | null): value is DigestBucket {
  return !!value && (DIGEST_BUCKETS as readonly string[]).includes(value)
}

// A link sitting in FETCHING or ANALYZING longer than this is shown as stuck.
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000

function hiddenDomainWhere(hiddenDomains: string[]): Prisma.LinkWhereInput {
  if (hiddenDomains.length === 0) return { id: { in: [] } }
  return {
    OR: [
      { domain: { in: hiddenDomains } },
      { finalDomain: { in: hiddenDomains } },
    ],
  }
}

function visibleDomainWhere(hiddenDomains: string[]): Prisma.LinkWhereInput {
  if (hiddenDomains.length === 0) return {}
  return {
    AND: [
      { OR: [{ domain: null }, { domain: { notIn: hiddenDomains } }] },
      { OR: [{ finalDomain: null }, { finalDomain: { notIn: hiddenDomains } }] },
    ],
  }
}

// A post with too little text of its own (e.g. a tweet sharing an article)
// whose nested article was analyzed: the article's analysis stands in for it.
const SHARED_ARTICLE_ANALYZED: Prisma.LinkWhereInput = {
  fetchStatus: "PAYWALL_DETECTED",
  paywallType: "insufficient_content",
  childLinks: { some: { fetchStatus: "COMPLETED" } },
}

/** Analyzed itself, or through the article it shares. */
export const ANALYZED_WHERE: Prisma.LinkWhereInput = {
  OR: [{ fetchStatus: "COMPLETED" }, SHARED_ARTICLE_ANALYZED],
}

/**
 * The exact complement of ANALYZED_WHERE. Written out rather than as
 * NOT(ANALYZED_WHERE), because NOT over the nullable paywallType would
 * drop rows where it is null.
 */
export const NOT_ANALYZED_WHERE: Prisma.LinkWhereInput = {
  AND: [
    { fetchStatus: { not: "COMPLETED" } },
    {
      OR: [
        { fetchStatus: { not: "PAYWALL_DETECTED" } },
        { paywallType: null },
        { paywallType: { not: "insufficient_content" } },
        { childLinks: { none: { fetchStatus: "COMPLETED" } } },
      ],
    },
  ],
}

const STATUS_WHERE: Record<Exclude<DigestBucket, "hidden">, Prisma.LinkWhereInput> = {
  analyzed: ANALYZED_WHERE,
  paywalled: {
    AND: [
      { fetchStatus: "PAYWALL_DETECTED" },
      // Leave out posts counted as analyzed through their shared article
      {
        OR: [
          { paywallType: null },
          { paywallType: { not: "insufficient_content" } },
          { childLinks: { none: { fetchStatus: "COMPLETED" } } },
        ],
      },
    ],
  },
  unreachable: { fetchStatus: "FAILED" },
  analysis_failed: { fetchStatus: "FETCHED", analysisError: { not: null } },
  waiting: {
    OR: [
      { fetchStatus: { in: ["PENDING", "FETCHING", "ANALYZING"] } },
      { fetchStatus: "FETCHED", analysisError: null },
    ],
  },
}

/**
 * Prisma filter for one digest group. Links on hidden domains are only in
 * "hidden", matching the feed, which leaves them out entirely.
 */
export function bucketWhere(
  bucket: DigestBucket,
  userId: string,
  hiddenDomains: string[]
): Prisma.LinkWhereInput {
  const base: Prisma.LinkWhereInput = { userId, parentLinkId: null }
  if (bucket === "hidden") {
    return { AND: [base, hiddenDomainWhere(hiddenDomains)] }
  }
  return { AND: [base, visibleDomainWhere(hiddenDomains), STATUS_WHERE[bucket]] }
}

export type FailureKind =
  | "blocked"
  | "not_found"
  | "server_error"
  | "timeout"
  | "unreadable"
  | "network"
  | "excluded"
  | "other"

export const FAILURE_LABELS: Record<FailureKind, string> = {
  blocked: "Site blocked the request",
  not_found: "Page no longer exists",
  server_error: "Site returned a server error",
  timeout: "Timed out",
  // New fetches put these under Paywalled ("insufficient_content"); this
  // covers a wayback-only run that could not parse the archived copy.
  unreadable: "No readable text (needs JavaScript or is empty)",
  network: "Couldn't connect to the site",
  excluded: "Redirected to an excluded site",
  other: "Couldn't load",
}

/** Turn a fetcher error message into a reason a reader can act on. */
export function classifyFetchError(error: string | null | undefined): FailureKind {
  if (!error) return "other"
  const status = error.match(/\b(?:HTTP|returned) (\d{3})\b/)?.[1]
  if (status) {
    const code = Number(status)
    if ([401, 403, 407, 429, 451].includes(code)) return "blocked"
    if (code === 404 || code === 410) return "not_found"
    if (code >= 500) return "server_error"
  }
  const text = error.toLowerCase()
  if (text.includes("timed out") || text.includes("timeout") || text.includes("abort")) return "timeout"
  if (text.includes("poor content") || text.includes("could not parse")) return "unreadable"
  if (text.includes("excluded")) return "excluded"
  if (
    text.includes("fetch failed") ||
    text.includes("enotfound") ||
    text.includes("econnrefused") ||
    text.includes("econnreset") ||
    text.includes("certificate") ||
    text.includes("getaddrinfo")
  ) {
    return "network"
  }
  return "other"
}

export interface AttemptSummary {
  operationId: string
  fetcherName: string | null
  fetcherId: string
  sequence: number
  success: boolean
  error: string | null
}

/**
 * The reason a fetch failed. The stored fetchError is whatever the last
 * fetcher in the chain said (usually "not in Wayback"), so prefer the first
 * fetcher of the most recent run, which saw the real site.
 */
export function primaryFetchError(
  fetchError: string | null,
  attempts: AttemptSummary[]
): { error: string | null; tried: AttemptSummary[] } {
  if (attempts.length === 0) return { error: fetchError, tried: [] }
  const latestOp = attempts[0].operationId
  const tried = attempts
    .filter((a) => a.operationId === latestOp)
    .sort((a, b) => a.sequence - b.sequence)
  const first = tried.find((a) => !a.success && a.error)
  return { error: first?.error || fetchError, tried }
}
