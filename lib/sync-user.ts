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
import { formatGmailDate, updateSyncCoverage } from "@/lib/sync-coverage"
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
  emailId: string,
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
      const existingByFinalUrl = await prisma.link.findFirst({
        where: {
          userId,
          finalUrlHash,
          id: { not: linkId },
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
        title: content.title,
        description: content.excerpt,
        imageUrl: content.imageUrl,
        contentText: content.textContent,
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

    const nestedResult = await processNestedLinks({
      id: linkId,
      userId,
      emailId,
      url,
      finalUrl: content.finalUrl || null,
      rawHtml: rawHtml || null,
      finalDomain,
      domain,
    }, settings, { triggerAi })
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

async function processLinksInParallel(
  links: Array<{ id: string; url: string; emailId: string }>,
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

// Hard stop on Gmail list calls per run. Pages of already-synced mail are
// skipped without counting against maxPages, so this bounds that walk.
const MAX_LISTED_PAGES = 40

/** Returns true when the run stopped with pages left (page cap hit). */
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
  } while (pageToken && processedPages < maxPages && currentPage < MAX_LISTED_PAGES)

  if (pageToken && currentPage >= MAX_LISTED_PAGES) {
    syncLogger.warn(`Stopped after listing ${MAX_LISTED_PAGES} pages`, { mode: syncResults.mode })
  }

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
      syncGapFrom: null,
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
  const triggerAi = options.triggerAi !== false
  const settings = await getUserSettings(userId)
  const syncResults = makeSyncResults(mode)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      hiddenDomains: true,
      syncQuery: true,
      syncNewestEmailDate: true,
      syncGapFrom: true,
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

    const searchFrom = user.syncGapFrom ?? user.syncNewestEmailDate
    const afterDate = new Date(searchFrom)
    afterDate.setDate(afterDate.getDate() - 1)
    const query = `${settings.email.query} after:${formatGmailDate(afterDate)}`

    const truncated = await fetchAndProcessPages(
      userId, query, options.maxPagesOverride ?? 1, gmail, hiddenDomains, settings, syncResults, triggerAi
    )

    if (syncResults.emailsProcessed === 0 && !truncated) {
      syncResults.upToDate = true
    }

    await updateSyncCoverage(userId)
    // Gmail lists newest first, so a cut-off run leaves older unseen mail
    // behind the new syncNewestEmailDate. Keep searching from where this run
    // started until a run lists the whole window.
    await prisma.user.update({
      where: { id: userId },
      data: { syncGapFrom: truncated ? searchFrom : null },
    })
    if (truncated) {
      syncLogger.info("check-new stopped at page cap; next run resumes from gap", {
        gapFrom: searchFrom.toISOString(),
      })
    }
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

    await updateSyncCoverage(userId)
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
