import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hashUrl, extractDomain, EXCLUDED_DOMAINS } from "@/lib/link-extractor"
import { fetchAndParseContent, estimateReadingTime } from "@/lib/content-fetcher"

const isExcludedUrl = (url: string) => {
  const lowerUrl = url.toLowerCase()
  return EXCLUDED_DOMAINS.some((d) => lowerUrl.includes(d))
}

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

  try {
    // Update status to FETCHING
    await prisma.link.update({
      where: { id },
      data: { fetchStatus: "FETCHING" },
    })

    console.log("[/api/links/[id]/refetch] Fetching content for:", link.url)
    const content = await fetchAndParseContent(link.url)

    if (!content.success) {
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
        rawHtml: content.rawHtml,
        wordCount: content.wordCount,
        readingTimeMin: content.wordCount
          ? estimateReadingTime(content.wordCount)
          : null,
        isPaywalled: content.isPaywalled || false,
        paywallType: content.paywallType,
        finalUrl: content.finalUrl,
        finalUrlHash,
        finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
        wasRedirected: content.wasRedirected || false,
        fetchedAt: new Date(),
      },
    })

    console.log("[/api/links/[id]/refetch] Total time:", Date.now() - startTime, "ms")

    return NextResponse.json({
      success: true,
      link: updatedLink,
    })
  } catch (error) {
    console.error("[/api/links/[id]/refetch] Error:", error)

    await prisma.link.update({
      where: { id },
      data: {
        fetchStatus: "FAILED",
        fetchError: error instanceof Error ? error.message : "Unknown error",
      },
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refetch failed" },
      { status: 500 }
    )
  }
}
