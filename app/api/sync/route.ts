import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getGmailClient, fetchSelfEmails, batchGetEmailContents, AuthenticationError } from "@/lib/gmail"
import { extractLinks, hashUrl, extractDomain } from "@/lib/link-extractor"
import { isExcludedUrl } from "@/lib/constants/domains"
import { fetchAndParseContent, estimateReadingTime } from "@/lib/content-fetcher"
import { processNestedLinks } from "@/lib/process-nested-links"
import { syncLogger } from "@/lib/logger"

// NOTE: Sites like avc.xyz use Next.js with React Server Components. Readability
// may fail to extract content from JS-rendered pages, but we now always extract
// JSON-LD structured data which provides title, description, and word count.

// TODO: Add headless browser support (Puppeteer/Playwright) for JS-rendered sites.
// When Readability fails but we detect the page is JS-rendered (e.g., has React
// hydration scripts, minimal body content), retry fetching with a headless browser
// to get the fully rendered HTML. This would enable content extraction from modern
// SPAs and Next.js sites. Consider: 1) Detection heuristics for when to use it,
// 2) Performance/resource implications, 3) Optional serverless browser service.

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
  hiddenDomains: Set<string>
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

    const content = await fetchAndParseContent(url)
    const rawHtml = content.rawHtml

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
        finalUrl: content.finalUrl,
        finalUrlHash,
        finalDomain,
        wasRedirected: content.wasRedirected || false,
        fetchedAt: new Date(),
      },
    })

    result.fetched = true

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
    })
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
  concurrency: number = 5
) {
  const results: LinkProcessResult[] = []

  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((link) => processLink(link.id, link.url, userId, link.emailId, hiddenDomains))
    )
    results.push(...batchResults)
  }

  return results
}

export async function POST(request: Request) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Check for sync parameters
  const reqUrl = new URL(request.url)
  const fullSync = reqUrl.searchParams.get("fullSync") === "true"
  const continueSync = reqUrl.searchParams.get("continue") === "true"
  const resetSync = reqUrl.searchParams.get("reset") === "true"
  const maxPages = fullSync ? 20 : continueSync ? 5 : 1 // Limit pages based on mode

  // Reset sync clears the stored page token
  if (resetSync) {
    await prisma.user.update({
      where: { id: userId },
      data: { syncPageToken: null },
    })
    syncLogger.info("Sync page token reset")
  }
  const emailsPerPage = 50

  const syncResults = {
    emailsProcessed: 0,
    emailsSynced: 0, // Total emails in DB after sync
    linksExtracted: 0,
    linksFetched: 0,
    linksSkippedExcluded: 0,
    linksSkippedDuplicate: 0,
    linksSkippedHidden: 0,
    nestedLinksCreated: 0,
    nestedLinksFetched: 0,
    pagesProcessed: 0,
    pagesSkipped: 0,
    hasMorePages: false,
    gmailTotalEstimate: 0,
    errors: [] as string[],
  }

  try {
    // Fetch user's hidden domains and stored page token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hiddenDomains: true, syncPageToken: true },
    })
    const hiddenDomains = new Set(user?.hiddenDomains || [])

    // Create Gmail client once and reuse throughout the sync
    const gmail = await getGmailClient(userId)

    // For continue mode, start from stored page token
    // For normal/full sync, start from the beginning
    let pageToken: string | undefined = continueSync ? (user?.syncPageToken || undefined) : undefined
    let currentPage = 0

    if (continueSync && pageToken) {
      syncLogger.info("Continuing from stored page token")
    }

    // Process pages of emails
    do {
      currentPage++
      const modeLabel = fullSync ? "full" : continueSync ? "continue" : "normal"
      syncLogger.info(`Processing page ${currentPage} (${modeLabel} mode, max ${maxPages})`)

      // Step 1: Fetch self-emails from Gmail
      const { messages, nextPageToken, resultSizeEstimate } = await fetchSelfEmails(userId, emailsPerPage, pageToken, gmail)
      pageToken = nextPageToken || undefined

      // Capture total estimate from first page
      if (currentPage === 1) {
        syncResults.gmailTotalEstimate = resultSizeEstimate
      }

      if (messages.length === 0) {
        syncLogger.info(`No messages on page ${currentPage}, stopping`)
        break
      }

      // Filter out already-processed emails first (batch check)
      const messageIds = messages.map((m) => m.id).filter(Boolean) as string[]
      const existingEmails = await prisma.email.findMany({
        where: { gmailId: { in: messageIds } },
        select: { gmailId: true },
      })
      const existingGmailIds = new Set(existingEmails.map((e) => e.gmailId))
      const newMessageIds = messageIds.filter((id) => !existingGmailIds.has(id))

      if (newMessageIds.length === 0) {
        syncLogger.info(`All emails on page ${currentPage} already processed`)
        syncResults.pagesSkipped++
        // In continue/full sync, keep going to find unprocessed pages
        // In normal sync, stop at first fully-processed page
        if (!fullSync && !continueSync) break
        continue
      }

      syncResults.pagesProcessed++

      // Batch fetch email contents in parallel (10 at a time)
      const emailContents = await batchGetEmailContents(newMessageIds, gmail, 10)

      // Collect all links to process
      const allLinksToProcess: Array<{ id: string; url: string; emailId: string }> = []

      // Process each email - save emails and extract links
      for (let i = 0; i < newMessageIds.length; i++) {
        const emailData = emailContents[i]
        if (!emailData) continue

        try {
          // Save email to database
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

          // Create new link records
          for (const linkUrl of links) {
            const urlHash = hashUrl(linkUrl)
            if (existingUrlHashes.has(urlHash)) continue

            // Mark as existing to avoid duplicates in same batch
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
            `Failed to process email ${newMessageIds[i]}: ${emailError}`
          )
        }
      }

      // Process all links in parallel (5 at a time for content fetching)
      if (allLinksToProcess.length > 0) {
        syncLogger.info(`Processing ${allLinksToProcess.length} links in parallel`)
        const linkResults = await processLinksInParallel(allLinksToProcess, userId, hiddenDomains, 5)

        // Aggregate results
        for (const result of linkResults) {
          if (result.fetched) syncResults.linksFetched++
          if (result.skippedExcluded) syncResults.linksSkippedExcluded++
          if (result.skippedDuplicate) syncResults.linksSkippedDuplicate++
          if (result.skippedHidden) syncResults.linksSkippedHidden++
          syncResults.nestedLinksCreated += result.nestedCreated
          syncResults.nestedLinksFetched += result.nestedFetched
          if (result.error) syncResults.errors.push(result.error)
        }
      }

    } while (pageToken && currentPage < maxPages)

    // Set hasMorePages if there's still a pageToken
    syncResults.hasMorePages = !!pageToken

    // Get total synced emails count
    syncResults.emailsSynced = await prisma.email.count({
      where: { userId },
    })

    // Update user's last sync time and save page token for continue sync
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastSyncAt: new Date(),
        syncPageToken: pageToken || null, // Save for next continue sync
      },
    })

    syncLogger.info("Completed", {
      pagesProcessed: syncResults.pagesProcessed,
      pagesSkipped: syncResults.pagesSkipped,
      emails: syncResults.emailsProcessed,
      links: syncResults.linksExtracted,
      hasMore: syncResults.hasMorePages,
      gmailTotal: syncResults.gmailTotalEstimate,
    })
    return NextResponse.json(syncResults)
  } catch (error) {
    // Handle authentication errors specially
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
