export interface FetchResult {
  success: boolean
  title?: string
  content?: string
  textContent?: string
  excerpt?: string
  byline?: string
  siteName?: string
  imageUrl?: string
  wordCount?: number
  isPaywalled?: boolean
  // "insufficient_content": the page loaded but had too little readable
  // text to analyze (JS-rendered, empty, or a teaser) — treated as a paywall
  paywallType?: "hard" | "soft" | "registration" | "insufficient_content"
  // The page was reached but Readability found (almost) no text
  insufficientContent?: boolean
  error?: string
  finalUrl?: string
  wasRedirected?: boolean
  rawHtml?: string
}

export interface ContentFetcher {
  id: string
  name: string
  description: string
  fetch(url: string, options?: { timeoutMs?: number }): Promise<FetchResult>
}

const FETCHER_REGISTRY: Record<string, ContentFetcher> = {}

export function registerFetcher(fetcher: ContentFetcher) {
  FETCHER_REGISTRY[fetcher.id] = fetcher
}

export function getFetcher(id: string): ContentFetcher | undefined {
  return FETCHER_REGISTRY[id]
}

export function getAvailableFetchers(): ContentFetcher[] {
  return Object.values(FETCHER_REGISTRY)
}

export interface FetchAttemptDetail {
  fetcherId: string
  fetcherName: string
  sequence: number
  success: boolean
  error?: string
  rawHtml?: string
  durationMs: number
}

export interface FetchWithSourceResult extends FetchResult {
  contentSource: string
  attempts: FetchAttemptDetail[]
}

export async function fetchWithFallbackChain(
  url: string,
  chain: string[],
  options?: { timeoutMs?: number }
): Promise<FetchWithSourceResult> {
  let lastError: string | undefined
  const attempts: FetchAttemptDetail[] = []
  const failures: FetchResult[] = []

  for (let i = 0; i < chain.length; i++) {
    const fetcherId = chain[i]
    const fetcher = FETCHER_REGISTRY[fetcherId]
    if (!fetcher) {
      console.warn(`[FallbackChain] Unknown fetcher: ${fetcherId}, skipping`)
      continue
    }

    const startTime = Date.now()
    try {
      const result = await fetcher.fetch(url, options)
      const durationMs = Date.now() - startTime

      attempts.push({
        fetcherId,
        fetcherName: fetcher.name,
        sequence: attempts.length + 1,
        success: result.success,
        error: result.error,
        rawHtml: result.rawHtml,
        durationMs,
      })

      if (result.success) {
        return { ...result, contentSource: fetcherId, attempts }
      }
      // If it failed but not fatally, try next fetcher
      failures.push(result)
      lastError = result.error
      console.log(`[FallbackChain] ${fetcherId} failed for ${url}: ${result.error}, trying next...`)
    } catch (error) {
      const durationMs = Date.now() - startTime
      lastError = error instanceof Error ? error.message : "Unknown error"

      attempts.push({
        fetcherId,
        fetcherName: fetcher.name,
        sequence: attempts.length + 1,
        success: false,
        error: lastError,
        durationMs,
      })

      console.log(`[FallbackChain] ${fetcherId} threw for ${url}: ${lastError}, trying next...`)
    }
  }

  // All fetchers failed — return what the first fetcher saw of the page
  // (redirects, paywall) with the last error. A page that loaded with too
  // little text counts as a paywall of type "insufficient_content", unless a
  // real paywall was detected.
  const first = failures[0]
  const insufficientContent = failures.some((f) => f.insufficientContent)
  return {
    success: false,
    error: lastError || "All fetchers failed",
    contentSource: chain[0] || "unknown",
    attempts,
    finalUrl: first?.finalUrl,
    wasRedirected: first?.wasRedirected,
    rawHtml: first?.rawHtml,
    isPaywalled: first?.isPaywalled || insufficientContent || undefined,
    paywallType: first?.isPaywalled
      ? first.paywallType
      : insufficientContent
        ? "insufficient_content"
        : undefined,
    insufficientContent: insufficientContent || undefined,
  }
}
