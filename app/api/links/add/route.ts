import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hashUrl, extractDomain } from "@/lib/link-extractor"
import { isExcludedUrl } from "@/lib/constants/domains"
import { fetchAndParseContent, estimateReadingTime } from "@/lib/content-fetcher"
import { processNestedLinks } from "@/lib/process-nested-links"

export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { url } = body as { url?: string }

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  // Validate URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  // Check if URL is excluded
  if (isExcludedUrl(url)) {
    return NextResponse.json({ error: "This URL is in the excluded domains list" }, { status: 400 })
  }

  const urlHash = hashUrl(url)
  const domain = extractDomain(url)

  // Check for duplicate
  const existingLink = await prisma.link.findUnique({
    where: { userId_urlHash: { userId: session.user.id, urlHash } },
  })

  if (existingLink) {
    return NextResponse.json({
      error: "This URL already exists in your feed",
      link: existingLink,
    }, { status: 409 })
  }

  try {
    // Create link record
    const link = await prisma.link.create({
      data: {
        userId: session.user.id,
        url,
        urlHash,
        domain,
        fetchStatus: "FETCHING",
      },
    })

    console.log("[/api/links/add] Created link:", link.id, "for URL:", url)

    // Fetch content
    const content = await fetchAndParseContent(url)

    if (!content.success) {
      const updatedLink = await prisma.link.update({
        where: { id: link.id },
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

    // Check if final URL is excluded
    if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
      await prisma.link.delete({ where: { id: link.id } })
      return NextResponse.json({
        error: `Final URL redirected to excluded domain: ${content.finalUrl}`,
      }, { status: 400 })
    }

    const finalUrlHash = content.finalUrl ? hashUrl(content.finalUrl) : null

    const updatedLink = await prisma.link.update({
      where: { id: link.id },
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
      emailId: null,
      url,
      finalUrl: content.finalUrl || null,
      rawHtml: content.rawHtml || null,
      finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
      domain,
    })

    console.log("[/api/links/add] Nested links:", nestedResult)

    return NextResponse.json({
      success: true,
      link: updatedLink,
      nestedLinks: nestedResult,
    })
  } catch (error) {
    console.error("[/api/links/add] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add link" },
      { status: 500 }
    )
  }
}
