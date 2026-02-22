import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hashUrl, extractDomain } from "@/lib/link-extractor"
import { isExcludedUrl } from "@/lib/constants/domains"
import { estimateReadingTime } from "@/lib/content-fetcher"
import { processNestedLinks } from "@/lib/process-nested-links"
import { getUserSettings } from "@/lib/user-settings"
import { fetchWithFallbackChain } from "@/lib/fetchers"
import { generateOperationId, recordFetchAttempts } from "@/lib/fetch-attempts"
import "@/lib/fetchers/direct"
import "@/lib/fetchers/wayback"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id } = await params
  console.log("[/api/links/[id]/refetch] Request started for link:", id)

  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const link = await prisma.link.findUnique({
    where: { id },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const settings = await getUserSettings(session.user.id)

  // Parse optional chain override from request body
  let chain = settings.fetching.fallbackChain
  let trigger = "refetch"
  try {
    const body = await request.json()
    if (body.chain && Array.isArray(body.chain) && body.chain.length > 0) {
      chain = body.chain as string[]
      // Use a more specific trigger when a single fetcher is explicitly chosen
      if (chain.length === 1) {
        trigger = `${chain[0]}_manual`
      }
    }
  } catch {
    // No body or invalid JSON — use default chain
  }

  // When a single fetcher is manually chosen and the link already has good content,
  // a failure should restore the previous status rather than overwrite it with FAILED.
  const previousStatus = link.fetchStatus
  const hadGoodContent = ["COMPLETED", "FETCHED", "ANALYZING"].includes(previousStatus)
  const isManualSingleFetcher = chain.length === 1 && trigger !== "refetch"

  try {
    // Update status to FETCHING
    await prisma.link.update({
      where: { id },
      data: { fetchStatus: "FETCHING" },
    })

    console.log("[/api/links/[id]/refetch] Fetching content for:", link.url, "chain:", chain)
    const operationId = generateOperationId()
    const content = await fetchWithFallbackChain(link.url, chain, {
      timeoutMs: settings.fetching.fetchTimeoutMs,
    })

    // Record fetch attempts for this refetch operation
    await recordFetchAttempts(id, operationId, trigger, content.attempts)

    if (!content.success) {
      if (isManualSingleFetcher && hadGoodContent) {
        // Restore previous status — the existing content is still valid
        await prisma.link.update({
          where: { id },
          data: { fetchStatus: previousStatus },
        })

        return NextResponse.json({
          success: false,
          link: { ...link, fetchStatus: previousStatus },
          error: content.error,
        })
      }

      const updatedLink = await prisma.link.update({
        where: { id },
        data: {
          fetchStatus: content.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
          fetchError: content.error,
          isPaywalled: content.isPaywalled || false,
          paywallType: content.paywallType,
          rawHtml: content.rawHtml,
          finalUrl: content.finalUrl,
          finalUrlHash: content.finalUrl ? hashUrl(content.finalUrl) : null,
          finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
          wasRedirected: content.wasRedirected || false,
          fetchedAt: new Date(),
        },
      })

      return NextResponse.json({
        success: false,
        link: updatedLink,
        error: content.error,
      })
    }

    // Check if final URL is in excluded domains
    if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
      await prisma.link.update({
        where: { id },
        data: {
          fetchStatus: "FAILED",
          fetchError: "Final URL is in excluded domains",
          finalUrl: content.finalUrl,
          finalDomain: extractDomain(content.finalUrl),
          wasRedirected: content.wasRedirected || false,
        },
      })

      return NextResponse.json({
        success: false,
        error: `Final URL redirected to excluded domain: ${content.finalUrl}`,
      })
    }

    const finalUrlHash = content.finalUrl ? hashUrl(content.finalUrl) : null

    const updatedLink = await prisma.link.update({
      where: { id },
      data: {
        fetchStatus: "FETCHED",
        fetchError: null,
        title: content.title,
        description: content.excerpt,
        imageUrl: content.imageUrl,
        contentText: content.textContent,
        contentHtml: content.content,
        rawHtml: content.rawHtml,
        wordCount: content.wordCount,
        readingTimeMin: content.wordCount
          ? estimateReadingTime(content.wordCount)
          : null,
        isPaywalled: content.isPaywalled || false,
        paywallType: content.paywallType,
        contentSource: content.contentSource,
        finalUrl: content.finalUrl,
        finalUrlHash,
        finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
        wasRedirected: content.wasRedirected || false,
        fetchedAt: new Date(),
      },
    })

    // Process nested links from social media posts
    const nestedResult = await processNestedLinks({
      id: updatedLink.id,
      userId: session.user.id,
      emailId: link.emailId,
      url: link.url,
      finalUrl: content.finalUrl || null,
      rawHtml: content.rawHtml || null,
      finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
      domain: link.domain,
    }, settings)

    console.log("[/api/links/[id]/refetch] Total time:", Date.now() - startTime, "ms")
    console.log("[/api/links/[id]/refetch] Nested links:", nestedResult)

    return NextResponse.json({
      success: true,
      link: updatedLink,
      nestedLinks: nestedResult,
    })
  } catch (error) {
    console.error("[/api/links/[id]/refetch] Error:", error)

    if (isManualSingleFetcher && hadGoodContent) {
      // Restore previous status — the existing content is still valid
      await prisma.link.update({
        where: { id },
        data: { fetchStatus: previousStatus },
      })
    } else {
      await prisma.link.update({
        where: { id },
        data: {
          fetchStatus: "FAILED",
          fetchError: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refetch failed" },
      { status: 500 }
    )
  }
}
