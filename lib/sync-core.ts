// The sync machinery, shared by the interactive route (app/api/sync) and the
// background auto-sync runner (lib/auto-sync.ts). Everything here takes an
// explicit userId — nothing reads a session.
import { prisma } from "@/lib/prisma"
import { getGmailClient, fetchEmails, batchGetEmailContents } from "@/lib/gmail"
import { extractLinks, hashUrl, extractDomain } from "@/lib/link-extractor"
import { isExcludedUrl } from "@/lib/constants/domains"
import { estimateReadingTime } from "@/lib/content-fetcher"
import { processNestedLinks } from "@/lib/process-nested-links"
import { syncLogger } from "@/lib/logger"
import { fetchWithFallbackChain } from "@/lib/fetchers"
import { generateOperationId, recordFetchAttempts } from "@/lib/fetch-attempts"
import { triggerAutoAnalysisAndEmbedding } from "@/lib/ai-triggers"
import "@/lib/fetchers/direct"
import "@/lib/fetchers/wayback"
import type { ResolvedSettings } from "@/lib/settings"

export type SyncMode = "check-new" | "load-more" | "initial" | "full-resync"

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
  // Response-specific fields
  mode: SyncMode
  upToDate: boolean
  queryChanged: boolean
  newestEmailDate: string | null
  oldestEmailDate: string | null
}

export function makeSyncResults(mode: SyncMode): SyncResults {
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
export async function fetchAndProcessPages(
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
      where: { userId, gmailId: { in: messageIds } },
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
