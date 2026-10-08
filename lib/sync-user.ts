import { prisma } from "@/lib/prisma"
import { getGmailClient, fetchEmails, batchGetEmailContents, AuthenticationError } from "@/lib/gmail"
import { extractLinks, hashUrl, extractDomain } from "@/lib/link-extractor"
import { isExcludedUrl } from "@/lib/constants/domains"
import { estimateReadingTime } from "@/lib/content-fetcher"
import { processNestedLinks } from "@/lib/process-nested-links"
import { syncLogger } from "@/lib/logger"
import { getUserSettings } from "@/lib/user-settings"
import { fetchWithFallbackChain } from "@/lib/fetchers"
import { generateOperationId, recordFetchAttempts } from "@/lib/fetch-attempts"
import { triggerAutoAnalysisAndEmbedding } from "@/lib/ai-triggers"
import { runPendingLookups, triggerMediaLookup } from "@/lib/media-lookup"
import { storedPostContext } from "@/lib/post-context"
import { analyzeLink } from "@/lib/analysis"
import { isAiConfigured } from "@/lib/ai-provider"
import { FEATURE_FLAGS } from "@/lib/flags"
import { getUserAiKeys } from "@/lib/user-keys"
import { formatGmailDate, updateSyncCoverage } from "@/lib/sync-coverage"
import { isRetryableFetchError, primaryFetchError, visibleDomainWhere } from "@/lib/link-buckets"
import "@/lib/fetchers/direct"
import "@/lib/fetchers/wayback"
import type { ResolvedSettings } from "@/lib/settings"

export type SyncMode = "check-new" | "load-more" | "initial" | "full-resync"

export interface RunSyncOptions {
  /** When false, skip fire-and-forget analysis/embeddings (scheduled worker batches them). Default true. */
  triggerAi?: boolean
  /** Override page cap (scheduled check-new walks more than the interactive 1 page). */
  maxPagesOverride?: number
}

interface LinkProcessResult {
  fetched: boolean
  skippedExcluded: boolean
  skippedDuplicate: boolean
  skippedHidden: boolean
  nestedCreated: number
  nestedFetched: number
  error?: string
}

export interface SyncResults {
  emailsProcessed: number
  emailsSynced: number
  linksExtracted: number
  linksFetched: number
  linksSkippedExcluded: number
  linksSkippedDuplicate: number
  linksSkippedHidden: number
  nestedLinksCreated: number
  nestedLinksFetched: number
  pagesProcessed: number
  hasMoreHistory: boolean
  gmailTotalEstimate: number
  errors: string[]
  mode: SyncMode
  upToDate: boolean
  queryChanged: boolean
  newestEmailDate: string | null
  oldestEmailDate: string | null
}

function makeSyncResults(mode: SyncMode): SyncResults {
  return {
    emailsProcessed: 0,
    emailsSynced: 0,
    linksExtracted: 0,
    linksFetched: 0,
    linksSkippedExcluded: 0,
    linksSkippedDuplicate: 0,
    linksSkippedHidden: 0,
    nestedLinksCreated: 0,
    nestedLinksFetched: 0,
    pagesProcessed: 0,
    hasMoreHistory: false,
    gmailTotalEstimate: 0,
    errors: [],
    mode,
    upToDate: false,
    queryChanged: false,
    newestEmailDate: null,
    oldestEmailDate: null,
  }
}

async function processLink(
  linkId: string,
  url: string,
  userId: string,
  emailId: string | null,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  triggerAi: boolean
): Promise<LinkProcessResult> {
  const result: LinkProcessResult = {
    fetched: false,
    skippedExcluded: false,
    skippedDuplicate: false,
    skippedHidden: false,
    nestedCreated: 0,
    nestedFetched: 0,
  }

  const domain = extractDomain(url)
  if (domain && hiddenDomains.has(domain)) {
    syncLogger.info("Skipping link - hidden domain", { url, domain })
    await prisma.link.update({
      where: { id: linkId },
      data: { fetchStatus: "PENDING" },
    })
    result.skippedHidden = true
    return result
  }

  try {
    await prisma.link.update({
      where: { id: linkId },
      data: { fetchStatus: "FETCHING" },
    })

    const operationId = generateOperationId()
    const content = await fetchWithFallbackChain(url, settings.fetching.fallbackChain, {
      timeoutMs: settings.fetching.fetchTimeoutMs,
    })
    const rawHtml = content.rawHtml

    await recordFetchAttempts(linkId, operationId, "sync", content.attempts).catch((err) =>
      console.error("[Sync] Failed to record fetch attempts:", err)
    )

    if (!content.success) {
      await prisma.link.update({
        where: { id: linkId },
        data: {
          fetchStatus: content.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
          fetchError: content.error,
          isPaywalled: content.isPaywalled || false,
          paywallType: content.paywallType,
          rawHtml: rawHtml,
          finalUrl: content.finalUrl,
          finalUrlHash: content.finalUrl ? hashUrl(content.finalUrl) : null,
          finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
          wasRedirected: content.wasRedirected || false,
          fetchedAt: new Date(),
        },
      })
      return result
    }

    if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
      syncLogger.info("Skipping link - final URL excluded", { url, finalUrl: content.finalUrl })
      await prisma.link.delete({ where: { id: linkId } })
      result.skippedExcluded = true
      return result
    }

    const finalDomain = content.finalUrl ? extractDomain(content.finalUrl) : null
    if (finalDomain && hiddenDomains.has(finalDomain)) {
      syncLogger.info("Skipping link - final domain hidden", { url, finalDomain })
      await prisma.link.delete({ where: { id: linkId } })
      result.skippedHidden = true
      return result
    }

    const finalUrlHash = content.finalUrl ? hashUrl(content.finalUrl) : null
    if (finalUrlHash) {
      // Only defer to a duplicate that has content. A failed or in-progress
      // one (e.g. being retried in the same batch) must not delete this one.
      const existingByFinalUrl = await prisma.link.findFirst({
        where: {
          userId,
          finalUrlHash,
          id: { not: linkId },
          fetchStatus: { in: ["FETCHED", "ANALYZING", "COMPLETED"] },
        },
      })

      if (existingByFinalUrl) {
        syncLogger.info("Skipping link - duplicate final URL", { url, finalUrl: content.finalUrl })
        await prisma.link.delete({ where: { id: linkId } })
        result.skippedDuplicate = true
        return result
      }
    }

    await prisma.link.update({
      where: { id: linkId },
      data: {
        fetchStatus: "FETCHED",
        fetchError: null,
        title: content.title,
        description: content.excerpt,
        imageUrl: content.imageUrl,
        contentText: content.textContent,
        postContext: storedPostContext(content.postContext),
        contentHtml: content.content,
        rawHtml: rawHtml,
        wordCount: content.wordCount,
        readingTimeMin: content.wordCount
          ? estimateReadingTime(content.wordCount)
          : null,
        isPaywalled: content.isPaywalled || false,
        paywallType: content.paywallType,
        contentSource: content.contentSource,
        finalUrl: content.finalUrl,
        finalUrlHash,
        finalDomain,
        wasRedirected: content.wasRedirected || false,
        fetchedAt: new Date(),
      },
    })

    result.fetched = true

    if (triggerAi) {
      triggerAutoAnalysisAndEmbedding(linkId, userId)
    }

    // A sync can bring in many posts at once: their media lookups are run
    // a few at a time after it (runSyncForUser), not one per post here
    const nestedResult = await processNestedLinks({
      id: linkId,
      userId,
      emailId,
      url,
      finalUrl: content.finalUrl || null,
      rawHtml: rawHtml || null,
      finalDomain,
      domain,
    }, settings, { triggerAi, lookup: false })
    result.nestedCreated = nestedResult.created
    result.nestedFetched = nestedResult.fetched

    return result
  } catch (fetchError) {
    await prisma.link.update({
      where: { id: linkId },
      data: {
        fetchStatus: "FAILED",
        fetchError:
          fetchError instanceof Error ? fetchError.message : "Unknown error",
      },
    })
    result.error = `Failed to process ${url}: ${fetchError}`
    return result
  }
}

export interface MoveToFeedResult {
  /**
   * MOVED: now a link of its own in the feed. HIDDEN: moved, but its domain
   * is hidden, so it is parked like any hidden link. DUPLICATE: the page was
   * already in the feed, so the reference was dropped in its favour.
   * EXCLUDED: its final address is one the app never keeps.
   */
  status: "MOVED" | "HIDDEN" | "DUPLICATE" | "EXCLUDED" | "NOT_FOUND" | "NOT_MOVABLE"
  /** The page's content was fetched. */
  fetched: boolean
  error?: string
}

/**
 * Move a link from a podcast episode's show notes into the feed, as if it
 * had been emailed: it stops being a reference under the episode, its page
 * is fetched, and it is analyzed. Asking for one link is asking for its
 * analysis, so that runs whether or not analysis is set to run on its own.
 */
export async function moveLinkToFeed(linkId: string, userId: string): Promise<MoveToFeedResult> {
  const link = await prisma.link.findFirst({
    where: { id: linkId, userId },
    select: {
      id: true,
      url: true,
      emailId: true,
      parentLinkId: true,
      foundVia: true,
      description: true,
      parentLink: { where: { userId }, select: { title: true } },
    },
  })
  if (!link) return { status: "NOT_FOUND", fetched: false }
  if (!link.parentLinkId || link.foundVia !== "SHOW_NOTES") return { status: "NOT_MOVABLE", fetched: false }

  // Its description says which episode it came from; the fetch is about to replace it
  const originNote = link.description?.startsWith("From the show notes of")
    ? link.description
    : `From the show notes of ${link.parentLink?.title ?? "a podcast episode"}`
  const moved = await prisma.link.updateMany({
    where: { id: linkId, userId, parentLinkId: { not: null }, foundVia: "SHOW_NOTES" },
    data: {
      parentLinkId: null,
      foundVia: null,
      foundRole: null,
      originNote,
      // A link of its own now: a podcast episode or a post gets its own lookup
      lookupStatus: null,
      contentSource: null,
      fetchStatus: "PENDING",
    },
  })
  if (moved.count === 0) return { status: "NOT_MOVABLE", fetched: false }

  const [settings, user, aiKeys] = await Promise.all([
    getUserSettings(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { hiddenDomains: true } }),
    getUserAiKeys(userId),
  ])
  const result = await processLink(
    link.id,
    link.url,
    userId,
    link.emailId,
    new Set(user?.hiddenDomains || []),
    settings,
    true
  )
  if (result.skippedDuplicate) return { status: "DUPLICATE", fetched: false }
  if (result.skippedExcluded) return { status: "EXCLUDED", fetched: false }
  if (result.skippedHidden) return { status: "HIDDEN", fetched: false }

  if (result.fetched) {
    // processLink started the analysis already when it is set to run on its own
    if (!settings.analysis.autoRun && FEATURE_FLAGS.enableAnalysis && settings.analysis.enabled && isAiConfigured(settings, aiKeys)) {
      analyzeLink(link.id, settings, aiKeys, userId)
        // Books the analysis names are matched by the media lookup
        .then(() => triggerMediaLookup(link.id, userId))
        .catch((error) => console.error("[Move to feed] Analysis failed:", error))
    }
    // A moved post or podcast episode was queued for its lookup by processLink
    triggerMediaLookup(link.id, userId)
  }
  return { status: "MOVED", fetched: result.fetched, error: result.error }
}

async function processLinksInParallel(
  links: Array<{ id: string; url: string; emailId: string | null }>,
  userId: string,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  concurrency: number,
  triggerAi: boolean
) {
  const results: LinkProcessResult[] = []

  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((link) =>
        processLink(link.id, link.url, userId, link.emailId, hiddenDomains, settings, triggerAi)
      )
    )
    results.push(...batchResults)
  }

  return results
}

async function processEmailPage(
  messageIds: string[],
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  userId: string,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  syncResults: SyncResults,
  triggerAi: boolean
) {
  const emailContents = await batchGetEmailContents(messageIds, gmail, settings.sync.emailConcurrency)
  const allLinksToProcess: Array<{ id: string; url: string; emailId: string }> = []

  for (let i = 0; i < messageIds.length; i++) {
    const emailData = emailContents[i]
    if (!emailData) continue

    try {
      const email = await prisma.email.create({
        data: {
          userId,
          gmailId: emailData.id,
          threadId: emailData.threadId,
          subject: emailData.subject,
          snippet: emailData.snippet,
          receivedAt: emailData.receivedAt,
          rawContent: emailData.content,
          processedAt: new Date(),
        },
      })

      syncResults.emailsProcessed++

      const links = extractLinks(emailData.content)
      const urlHashes = links.map((linkUrl) => hashUrl(linkUrl))
      const existingLinks = await prisma.link.findMany({
        where: {
          userId,
          urlHash: { in: urlHashes },
        },
        select: { urlHash: true },
      })
      const existingUrlHashes = new Set(existingLinks.map((l) => l.urlHash))

      for (const linkUrl of links) {
        const urlHash = hashUrl(linkUrl)
        if (existingUrlHashes.has(urlHash)) continue
        existingUrlHashes.add(urlHash)

        const link = await prisma.link.create({
          data: {
            userId,
            emailId: email.id,
            sharedAt: email.receivedAt,
            url: linkUrl,
            urlHash,
            domain: extractDomain(linkUrl),
            fetchStatus: "PENDING",
          },
        })

        syncResults.linksExtracted++
        allLinksToProcess.push({ id: link.id, url: linkUrl, emailId: email.id })
      }
    } catch (emailError) {
      syncResults.errors.push(
        `Failed to process email ${messageIds[i]}: ${emailError}`
      )
    }
  }

  if (allLinksToProcess.length > 0) {
    syncLogger.info(`Processing ${allLinksToProcess.length} links in parallel`)
    const linkResults = await processLinksInParallel(
      allLinksToProcess, userId, hiddenDomains, settings, settings.sync.linkConcurrency, triggerAi
    )

    for (const lr of linkResults) {
      if (lr.fetched) syncResults.linksFetched++
      if (lr.skippedExcluded) syncResults.linksSkippedExcluded++
      if (lr.skippedDuplicate) syncResults.linksSkippedDuplicate++
      if (lr.skippedHidden) syncResults.linksSkippedHidden++
      syncResults.nestedLinksCreated += lr.nestedCreated
      syncResults.nestedLinksFetched += lr.nestedFetched
      if (lr.error) syncResults.errors.push(lr.error)
    }
  }
}

// A link is only fetched while its email syncs, so one left in PENDING or
// FETCHING by a crash or restart is never fetched again unless retried here.
const INTERRUPTED_FETCH_AFTER_MS = 24 * 60 * 60 * 1000
const INTERRUPTED_FETCH_MARKER = "Fetch was interrupted; retrying"
const INTERRUPTED_FETCH_GAVE_UP = "Fetch was interrupted"
const MAX_FETCH_RETRIES_PER_RUN = 50

/**
 * Retry links whose fetch was interrupted. Each link gets one retry: it is
 * marked first, and a marked link found stuck again is set to FAILED. Links
 * that finished fetching (FAILED, PAYWALL_DETECTED, FETCHED, ...) are never
 * touched, so bad or paywalled links are not fetched again. Returns how
 * many links it handled (retried or failed).
 */
export async function retryInterruptedFetches(
  userId: string,
  options: { triggerAi?: boolean } = {}
): Promise<number> {
  const settings = await getUserSettings(userId)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hiddenDomains: true } })
  const hiddenDomains = new Set(user?.hiddenDomains || [])

  const stuck = await prisma.link.findMany({
    where: {
      userId,
      fetchStatus: { in: ["PENDING", "FETCHING"] },
      updatedAt: { lt: new Date(Date.now() - INTERRUPTED_FETCH_AFTER_MS) },
      // Hidden-domain links are parked in PENDING on purpose
      ...visibleDomainWhere([...hiddenDomains]),
    },
    select: { id: true, url: true, emailId: true, parentLinkId: true, fetchError: true },
    orderBy: { createdAt: "desc" },
    take: MAX_FETCH_RETRIES_PER_RUN,
  })

  const giveUp: string[] = []
  const retry: Array<{ id: string; url: string; emailId: string | null }> = []
  for (const link of stuck) {
    // Nested links only add context to their parent, so they are not retried
    if (link.parentLinkId || link.fetchError === INTERRUPTED_FETCH_MARKER) giveUp.push(link.id)
    else retry.push(link)
  }

  if (giveUp.length > 0) {
    await prisma.link.updateMany({
      where: { userId, id: { in: giveUp } },
      data: { fetchStatus: "FAILED", fetchError: INTERRUPTED_FETCH_GAVE_UP },
    })
  }
  if (retry.length > 0) {
    await prisma.link.updateMany({
      where: { userId, id: { in: retry.map((l) => l.id) } },
      data: { fetchError: INTERRUPTED_FETCH_MARKER },
    })
    await processLinksInParallel(
      retry, userId, hiddenDomains, settings, settings.sync.linkConcurrency, options.triggerAi !== false
    )
  }

  if (stuck.length > 0) {
    syncLogger.warn("Recovered interrupted fetches", { userId, retried: retry.length, failed: giveUp.length })
  }
  return stuck.length
}

// Wait before each automatic retry of a temporary fetch failure, indexed by
// fetchRetryCount. Its length is the retry limit.
const TRANSIENT_RETRY_DELAYS_MS = [1, 6, 24].map((h) => h * 60 * 60 * 1000)
// Last retry is due 31h after the first failure; this covers it with slack.
const TRANSIENT_RETRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
// Candidates loaded per pass before the per-link checks
const TRANSIENT_RETRY_SCAN = 500

/**
 * Retry top-level links whose last fetch failed in a way that often clears up
 * (timeout, 5xx, network error, 429): up to 3 more fetches, 1h, 6h and 24h
 * apart. Blocked, gone, unreadable, paywalled and hidden links are never
 * retried, nor are links given up on after an interrupted fetch.
 *
 * Retries are counted on the link (fetchRetryCount) before fetching, so one
 * that crashes or records no attempt still counts toward the limit.
 *
 * The worker only looks at links that failed in the last 3 days. The
 * backfill script passes recentOnly: false to include older failures.
 */
export async function retryTransientFetchFailures(
  userId: string,
  options: { triggerAi?: boolean; recentOnly?: boolean; limit?: number } = {}
): Promise<number> {
  const settings = await getUserSettings(userId)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hiddenDomains: true } })
  const hiddenDomains = user?.hiddenDomains || []

  const due = await findTransientFetchRetries(userId, hiddenDomains, options)
  if (due.length === 0) return 0

  await prisma.link.updateMany({
    where: { userId, id: { in: due.map((l) => l.id) } },
    data: { fetchRetryCount: { increment: 1 }, lastFetchRetryAt: new Date() },
  })
  await processLinksInParallel(
    due, userId, new Set(hiddenDomains), settings, settings.sync.linkConcurrency,
    options.triggerAi !== false
  )
  syncLogger.info("Retried temporary fetch failures", { userId, count: due.length })
  return due.length
}

/** Links retryTransientFetchFailures would fetch now, oldest failure first. */
export async function findTransientFetchRetries(
  userId: string,
  hiddenDomains: string[],
  options: { recentOnly?: boolean; limit?: number } = {}
): Promise<Array<{ id: string; url: string; emailId: string | null }>> {
  const { recentOnly = true, limit = MAX_FETCH_RETRIES_PER_RUN } = options
  const now = Date.now()

  const failed = await prisma.link.findMany({
    where: {
      userId,
      fetchStatus: "FAILED",
      parentLinkId: null,
      fetchRetryCount: { lt: TRANSIENT_RETRY_DELAYS_MS.length },
      fetchError: { notIn: [INTERRUPTED_FETCH_GAVE_UP, INTERRUPTED_FETCH_MARKER] },
      updatedAt: {
        lt: new Date(now - TRANSIENT_RETRY_DELAYS_MS[0]),
        ...(recentOnly && { gt: new Date(now - TRANSIENT_RETRY_WINDOW_MS) }),
      },
      ...visibleDomainWhere(hiddenDomains),
    },
    select: {
      id: true,
      url: true,
      emailId: true,
      fetchError: true,
      fetchRetryCount: true,
      lastFetchRetryAt: true,
      updatedAt: true,
      fetchAttempts: {
        orderBy: { createdAt: "desc" },
        select: { operationId: true, fetcherName: true, fetcherId: true, sequence: true, success: true, error: true },
      },
    },
    orderBy: { updatedAt: "asc" },
    ...(recentOnly && { take: TRANSIENT_RETRY_SCAN }),
  })

  const due: Array<{ id: string; url: string; emailId: string | null }> = []
  for (const link of failed) {
    if (!isRetryableFetchError(primaryFetchError(link.fetchError, link.fetchAttempts).error)) continue
    const lastTry = link.lastFetchRetryAt ?? link.updatedAt
    if (now - lastTry.getTime() < TRANSIENT_RETRY_DELAYS_MS[link.fetchRetryCount]) continue
    due.push({ id: link.id, url: link.url, emailId: link.emailId })
    if (due.length >= limit) break
  }
  return due
}

async function fetchAndProcessPages(
  userId: string,
  query: string,
  maxPages: number,
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  syncResults: SyncResults,
  triggerAi: boolean
): Promise<boolean> {
  let pageToken: string | undefined
  let currentPage = 0
  let processedPages = 0
  const emailsPerPage = 50

  do {
    currentPage++
    syncLogger.info(`Processing page ${currentPage} (${syncResults.mode} mode, max ${maxPages})`)

    const { messages, nextPageToken, resultSizeEstimate } = await fetchEmails(
      userId, query, emailsPerPage, pageToken, gmail
    )
    pageToken = nextPageToken || undefined

    if (currentPage === 1) {
      syncResults.gmailTotalEstimate = resultSizeEstimate
    }

    if (messages.length === 0) {
      syncLogger.info(`No messages on page ${currentPage}, stopping`)
      break
    }

    const messageIds = messages.map((m) => m.id).filter(Boolean) as string[]
    const existingEmails = await prisma.email.findMany({
      where: { userId, gmailId: { in: messageIds } },
      select: { gmailId: true },
    })
    const existingGmailIds = new Set(existingEmails.map((e) => e.gmailId))
    const newMessageIds = messageIds.filter((id) => !existingGmailIds.has(id))

    if (newMessageIds.length === 0) {
      syncLogger.info(`All emails on page ${currentPage} already processed`)
      continue
    }

    processedPages++
    syncResults.pagesProcessed++
    await processEmailPage(newMessageIds, gmail, userId, hiddenDomains, settings, syncResults, triggerAi)
    // Pages of already-synced mail don't count against maxPages, so a run
    // resuming from an unmoved watermark skips them and reaches unseen mail.
  } while (pageToken && processedPages < maxPages)

  syncResults.hasMoreHistory = !!pageToken
  return !!pageToken
}

async function finalizeResults(userId: string, syncResults: SyncResults) {
  syncResults.emailsSynced = await prisma.email.count({ where: { userId } })

  const updatedUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { syncNewestEmailDate: true, syncOldestEmailDate: true },
  })
  syncResults.newestEmailDate = updatedUser?.syncNewestEmailDate?.toISOString() || null
  syncResults.oldestEmailDate = updatedUser?.syncOldestEmailDate?.toISOString() || null

  await prisma.user.update({
    where: { id: userId },
    data: { lastSyncAt: new Date() },
  })
}

async function handleInitialSync(
  userId: string,
  settings: ResolvedSettings,
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  hiddenDomains: Set<string>,
  syncResults: SyncResults,
  triggerAi: boolean,
  maxPages: number
) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      syncQuery: null,
      syncNewestEmailDate: null,
      syncOldestEmailDate: null,
    },
  })

  await fetchAndProcessPages(
    userId, settings.email.query, maxPages, gmail, hiddenDomains, settings, syncResults, triggerAi
  )

  const coverage = await updateSyncCoverage(userId)

  await prisma.user.update({
    where: { id: userId },
    data: {
      syncQuery: settings.email.query,
      lastSyncAt: new Date(),
    },
  })

  syncResults.emailsSynced = await prisma.email.count({ where: { userId } })
  syncResults.newestEmailDate = coverage.newestEmailDate?.toISOString() || null
  syncResults.oldestEmailDate = coverage.oldestEmailDate?.toISOString() || null

  syncLogger.info("Initial sync completed", {
    mode: syncResults.mode,
    pagesProcessed: syncResults.pagesProcessed,
    emails: syncResults.emailsProcessed,
    links: syncResults.linksExtracted,
    hasMore: syncResults.hasMoreHistory,
  })
}

/**
 * Run Gmail sync + link fetch for a user. No HTTP session required — uses
 * stored refresh tokens via getGmailClient. Throws AuthenticationError if
 * the Google account is missing or the refresh token is revoked.
 */
export async function runSyncForUser(
  userId: string,
  mode: SyncMode,
  options: RunSyncOptions = {}
): Promise<SyncResults> {
  const syncResults = await syncEmailsAndLinks(userId, mode, options)

  // Posts and pages synced that point at something they don't link: look for it
  // without holding up the sync. The worker passes triggerAi: false and
  // runs its own lookups after submitting the AI batch.
  if (options.triggerAi !== false) {
    runPendingLookups(userId, { limit: MAX_LOOKUPS_AFTER_SYNC, budgetMs: 10 * 60 * 1000 })
      .then((lookups) => {
        if (lookups.processed > 0) {
          syncLogger.info("Media lookups after sync", { userId, processed: lookups.processed, found: lookups.found })
        }
      })
      .catch((error) => console.error("[Sync] Media lookups failed:", error))
  }

  return syncResults
}

// The rest stay waiting, for the next sync or the Media page's "Find sources"
const MAX_LOOKUPS_AFTER_SYNC = 10

async function syncEmailsAndLinks(
  userId: string,
  mode: SyncMode,
  options: RunSyncOptions = {}
): Promise<SyncResults> {
  const triggerAi = options.triggerAi !== false
  const settings = await getUserSettings(userId)
  const syncResults = makeSyncResults(mode)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      hiddenDomains: true,
      syncQuery: true,
      syncNewestEmailDate: true,
      syncOldestEmailDate: true,
    },
  })
  const hiddenDomains = new Set(user?.hiddenDomains || [])
  const gmail = await getGmailClient(userId)

  if (mode === "check-new") {
    if (user?.syncQuery && user.syncQuery !== settings.email.query) {
      syncResults.queryChanged = true
      return syncResults
    }

    if (!user?.syncNewestEmailDate) {
      await handleInitialSync(
        userId, settings, gmail, hiddenDomains, syncResults, triggerAi,
        options.maxPagesOverride ?? settings.sync.maxPagesInitial
      )
      return syncResults
    }

    const afterDate = new Date(user.syncNewestEmailDate)
    afterDate.setDate(afterDate.getDate() - 1)
    const query = `${settings.email.query} after:${formatGmailDate(afterDate)}`

    const truncated = await fetchAndProcessPages(
      userId, query, options.maxPagesOverride ?? 1, gmail, hiddenDomains, settings, syncResults, triggerAi
    )

    if (syncResults.emailsProcessed === 0 && !truncated) {
      syncResults.upToDate = true
    }

    // Gmail lists newest first, so a cut-off run leaves older unseen mail
    // behind. Only advance the watermark once a run reaches the end.
    await updateSyncCoverage(userId, { advanceNewest: !truncated })
  } else if (mode === "load-more") {
    if (!user?.syncOldestEmailDate) {
      throw new Error("Run initial sync first")
    }

    const beforeDate = new Date(user.syncOldestEmailDate)
    beforeDate.setDate(beforeDate.getDate() + 1)
    const query = `${settings.email.query} before:${formatGmailDate(beforeDate)}`

    await fetchAndProcessPages(
      userId, query, options.maxPagesOverride ?? settings.sync.maxPagesLoadMore,
      gmail, hiddenDomains, settings, syncResults, triggerAi
    )

    // Only adds older mail; must not move a held-back check-new watermark.
    await updateSyncCoverage(userId, { advanceNewest: false })
  } else if (mode === "initial" || mode === "full-resync") {
    await handleInitialSync(
      userId, settings, gmail, hiddenDomains, syncResults, triggerAi,
      options.maxPagesOverride ?? settings.sync.maxPagesInitial
    )
    return syncResults
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }

  await finalizeResults(userId, syncResults)

  syncLogger.info("Completed", {
    mode,
    pagesProcessed: syncResults.pagesProcessed,
    emails: syncResults.emailsProcessed,
    links: syncResults.linksExtracted,
    hasMore: syncResults.hasMoreHistory,
  })

  return syncResults
}

export { AuthenticationError }
