import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { fetchFromWayback } from "@/lib/wayback-fetcher"
import { estimateReadingTime } from "@/lib/content-fetcher"
import { b } from "@/baml_client"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id } = await params
  console.log("[/api/links/[id]/wayback] Request started for link:", id)

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
    // Update status to indicate we're fetching from archive
    await prisma.link.update({
      where: { id },
      data: { fetchStatus: "FETCHING" },
    })

    // Use the original URL (not final URL) to check Wayback Machine
    const urlToFetch = link.finalUrl || link.url
    console.log("[/api/links/[id]/wayback] Fetching from Wayback Machine:", urlToFetch)

    const waybackResult = await fetchFromWayback(urlToFetch)

    if (!waybackResult.success) {
      // Restore previous status
      await prisma.link.update({
        where: { id },
        data: {
          fetchStatus: link.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
        },
      })

      return NextResponse.json({
        success: false,
        error: waybackResult.error || "Could not fetch from Wayback Machine",
      })
    }

    // Update link with archived content
    let updatedLink = await prisma.link.update({
      where: { id },
      data: {
        fetchStatus: "FETCHED",
        fetchError: null,
        title: waybackResult.title || link.title,
        description: waybackResult.excerpt || link.description,
        contentText: waybackResult.textContent,
        wordCount: waybackResult.wordCount,
        readingTimeMin: waybackResult.wordCount
          ? estimateReadingTime(waybackResult.wordCount)
          : null,
        // Keep paywall info but mark as successfully fetched via archive
        isPaywalled: link.isPaywalled,
        fetchedAt: new Date(),
      },
    })

    console.log(`[/api/links/[id]/wayback] Fetched archived content (${waybackResult.wordCount} words)`)

    // If we got good content, run AI analysis using BAML IngestLink
    if (waybackResult.rawHtml && waybackResult.title) {
      console.log("[/api/links/[id]/wayback] Running BAML IngestLink analysis...")

      await prisma.link.update({
        where: { id },
        data: { fetchStatus: "ANALYZING" },
      })

      try {
        const analysis = await b.IngestLink(
          urlToFetch,
          waybackResult.title,
          waybackResult.rawHtml
        )

        // Convert enums to strings for storage
        const linkTags = analysis.tags.map((t) => String(t))
        const contentTags = analysis.contentTags.map((t) => String(t))
        const metadataTags = analysis.metadataTags.map((t) => String(t))

        // Use first content tag as category if available
        const categoryName = contentTags[0] || "OTHER"

        // Ensure category exists
        const category = await prisma.category.upsert({
          where: { name: categoryName },
          create: {
            name: categoryName,
            slug: categoryName.toLowerCase().replace(/\s+/g, "-"),
          },
          update: {},
        })

        updatedLink = await prisma.link.update({
          where: { id },
          data: {
            fetchStatus: "COMPLETED",
            aiSummary: analysis.summary,
            aiCategory: categoryName,
            linkTags,
            contentTags,
            metadataTags,
            analyzedAt: new Date(),
            categories: {
              deleteMany: {},
              create: {
                categoryId: category.id,
                confidence: 1.0,
              },
            },
          },
          include: {
            categories: {
              include: {
                category: true,
              },
            },
          },
        })

        console.log("[/api/links/[id]/wayback] BAML analysis complete")
      } catch (analysisError) {
        console.error("[/api/links/[id]/wayback] BAML analysis failed:", analysisError)
        // Still mark as fetched even if analysis fails
        await prisma.link.update({
          where: { id },
          data: { fetchStatus: "FETCHED" },
        })
      }
    }

    console.log("[/api/links/[id]/wayback] Total time:", Date.now() - startTime, "ms")

    return NextResponse.json({
      success: true,
      link: updatedLink,
      archivedUrl: waybackResult.archivedUrl,
      timestamp: waybackResult.timestamp,
    })
  } catch (error) {
    console.error("[/api/links/[id]/wayback] Error:", error)

    // Restore previous status
    await prisma.link.update({
      where: { id },
      data: {
        fetchStatus: link.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
        fetchError: error instanceof Error ? error.message : "Unknown error",
      },
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Wayback fetch failed" },
      { status: 500 }
    )
  }
}
