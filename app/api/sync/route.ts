import { NextResponse } from "next/server"
import { auth } from "@/auth"
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

type SyncMode = "check-new" | "load-more" | "initial" | "full-resync"

// Type for link processing results
interface LinkProcessResult {
  fetched: boolean
  skippedExcluded: boolean
  skippedDuplicate: boolean
  skippedHidden: boolean
  nestedCreated: number
  nestedFetched: number
  error?: string
}

// Process a single link - fetch content only, no AI analysis
async function processLink(
  linkId: string,
  url: string,
  userId: string,
  emailId: string,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings
): Promise<LinkProcessResult> {
  const result: LinkProcessResult = {
    fetched: false,
    skippedExcluded: false,
    skippedDuplicate: false,
    skippedHidden: false,
    nestedCreated: 0,
    nestedFetched: 0,
  }

  // Check if domain is hidden by user - skip fetching entirely
  const domain = extractDomain(url)
  if (domain && hiddenDomains.has(domain)) {
    syncLogger.info("Skipping link - hidden domain", { url, domain })
    await prisma.link.update({
      where: { id: linkId },
      data: { fetchStatus: "PENDING" }, // Keep as pending, don't fetch
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

    // Record fetch attempts before any potential link deletion to avoid FK violations
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

    // Check if final URL is in excluded domains
    if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
      syncLogger.info("Skipping link - final URL excluded", { url, finalUrl: content.finalUrl })
      await prisma.link.delete({ where: { id: linkId } })
      result.skippedExcluded = true
      return result
    }

    // Check if final domain is hidden by user
    const finalDomain = content.finalUrl ? extractDomain(content.finalUrl) : null
    if (finalDomain && hiddenDomains.has(finalDomain)) {
      syncLogger.info("Skipping link - final domain hidden", { url, finalDomain })
      await prisma.link.delete({ where: { id: linkId } })
      result.skippedHidden = true
      return result
    }

    // Check for duplicate by final URL
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

    // Save fetched content - NO AI analysis during sync
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

    // Trigger auto-analysis and embedding (fire and forget)
    triggerAutoAnalysisAndEmbedding(linkId, userId)

    // Process nested links from social media posts
    const nestedResult = await processNestedLinks({
      id: linkId,
      userId,
      emailId,
      url,
      finalUrl: content.finalUrl || null,
      rawHtml: rawHtml || null,
      finalDomain,
      domain,
    }, settings)
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

// Process links in parallel with concurrency limit
async function processLinksInParallel(
  links: Array<{ id: string; url: string; emailId: string }>,
  userId: string,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  concurrency: number = 5
) {
  const results: LinkProcessResult[] = []

  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((link) => processLink(link.id, link.url, userId, link.emailId, hiddenDomains, settings))
    )
    results.push(...batchResults)
  }

  return results
}

// Process a page of Gmail messages: save emails, extract links, fetch content
async function processEmailPage(
  messageIds: string[],
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  userId: string,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  syncResults: SyncResults
) {
  // Batch fetch email contents in parallel
  const emailContents = await batchGetEmailContents(messageIds, gmail, settings.sync.emailConcurrency)

  // Collect all links to process
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

      // Extract links from email
      const links = extractLinks(emailData.content)

      // Batch check for existing links
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

  // Process all links in parallel
  if (allLinksToProcess.length > 0) {
    syncLogger.info(`Processing ${allLinksToProcess.length} links in parallel`)
    const linkResults = await processLinksInParallel(allLinksToProcess, userId, hiddenDomains, settings, settings.sync.linkConcurrency)

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

interface SyncResults {
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
  // Response-specific fields
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

// Paginated fetch + process loop shared by initial / load-more
async function fetchAndProcessPages(
  userId: string,
  query: string,
  maxPages: number,
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  hiddenDomains: Set<string>,
  settings: ResolvedSettings,
  syncResults: SyncResults
) {
  let pageToken: string | undefined
  let currentPage = 0
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

    // Filter out already-processed emails
    const messageIds = messages.map((m) => m.id).filter(Boolean) as string[]
    const existingEmails = await prisma.email.findMany({
      where: { gmailId: { in: messageIds } },
      select: { gmailId: true },
    })
    const existingGmailIds = new Set(existingEmails.map((e) => e.gmailId))
    const newMessageIds = messageIds.filter((id) => !existingGmailIds.has(id))

    if (newMessageIds.length === 0) {
      syncLogger.info(`All emails on page ${currentPage} already processed`)
      continue
    }

    syncResults.pagesProcessed++
    await processEmailPage(newMessageIds, gmail, userId, hiddenDomains, settings, syncResults)
  } while (pageToken && currentPage < maxPages)

  syncResults.hasMoreHistory = !!pageToken
}

export async function POST(request: Request) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const settings = await getUserSettings(userId)

  // Parse mode from query params
  const reqUrl = new URL(request.url)
  const mode = (reqUrl.searchParams.get("mode") || "check-new") as SyncMode

  const syncResults = makeSyncResults(mode)

  try {
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

    // ───────────────────────────────────────
    // Mode dispatch
    // ───────────────────────────────────────

    if (mode === "check-new") {
      // 1. Query mismatch check
      if (user?.syncQuery && user.syncQuery !== settings.email.query) {
        syncResults.queryChanged = true
        return NextResponse.json(syncResults)
      }

      // 2. If never synced, fall through to initial
      if (!user?.syncNewestEmailDate) {
        return handleInitialSync(userId, settings, gmail, hiddenDomains, syncResults)
      }

      // 3. Build query with after: filter (subtract 1 day for overlap safety)
      const afterDate = new Date(user.syncNewestEmailDate)
      afterDate.setDate(afterDate.getDate() - 1)
      const query = `${settings.email.query} after:${formatGmailDate(afterDate)}`

      // check-new only fetches 1 page
      await fetchAndProcessPages(userId, query, 1, gmail, hiddenDomains, settings, syncResults)

      if (syncResults.emailsProcessed === 0) {
        syncResults.upToDate = true
      }

      // Update coverage
      await updateSyncCoverage(userId)

    } else if (mode === "load-more") {
      if (!user?.syncOldestEmailDate) {
        return NextResponse.json(
          { error: "Run initial sync first", mode },
          { status: 400 }
        )
      }

      // Build query with before: filter (add 1 day for overlap safety)
      const beforeDate = new Date(user.syncOldestEmailDate)
      beforeDate.setDate(beforeDate.getDate() + 1)
      const query = `${settings.email.query} before:${formatGmailDate(beforeDate)}`

      await fetchAndProcessPages(
        userId, query, settings.sync.maxPagesLoadMore, gmail, hiddenDomains, settings, syncResults
      )

      // Update coverage
      await updateSyncCoverage(userId)

    } else if (mode === "initial" || mode === "full-resync") {
      return handleInitialSync(userId, settings, gmail, hiddenDomains, syncResults)

    } else {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
    }

    // Finalize
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

    syncLogger.info("Completed", {
      mode,
      pagesProcessed: syncResults.pagesProcessed,
      emails: syncResults.emailsProcessed,
      links: syncResults.linksExtracted,
      hasMore: syncResults.hasMoreHistory,
    })

    return NextResponse.json(syncResults)
  } catch (error) {
    if (error instanceof AuthenticationError) {
      syncLogger.error("Authentication failed", error)
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          requiresReauth: true,
        },
        { status: 401 }
      )
    }

    syncLogger.error("Sync failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    )
  }
}

async function handleInitialSync(
  userId: string,
  settings: ResolvedSettings,
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  hiddenDomains: Set<string>,
  syncResults: SyncResults
) {
  // Clear sync state
  await prisma.user.update({
    where: { id: userId },
    data: {
      syncQuery: null,
      syncNewestEmailDate: null,
      syncOldestEmailDate: null,
    },
  })

  // Fetch with plain query (no date filter)
  await fetchAndProcessPages(
    userId, settings.email.query, settings.sync.maxPagesInitial, gmail, hiddenDomains, settings, syncResults
  )

  // Set sync state from processed emails
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

  return NextResponse.json(syncResults)
}
