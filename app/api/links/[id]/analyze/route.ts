import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id } = await params
  console.log("[/api/links/[id]/analyze] Request started for link:", id)

  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Fetch the link with its email content and raw HTML
  const link = await prisma.link.findUnique({
    where: { id },
    include: {
      email: {
        select: {
          rawContent: true,
        },
      },
    },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    // Update status to ANALYZING
    await prisma.link.update({
      where: { id },
      data: { fetchStatus: "ANALYZING" },
    })

    console.log("[/api/links/[id]/analyze] Calling BAML IngestLink...")
    const bamlStart = Date.now()

    // Call BAML IngestLink with url, title (as anchor text), and raw HTML or email content
    // Prefer rawHtml (stored from content fetch) over email rawContent
    const htmlContent = link.rawHtml || link.contentText || link.email?.rawContent || undefined
    const result = await b.IngestLink(
      link.url,
      link.title || link.url,
      htmlContent
    )

    console.log("[/api/links/[id]/analyze] BAML completed in", Date.now() - bamlStart, "ms")
    console.log("[/api/links/[id]/analyze] Result:", JSON.stringify(result, null, 2))

    // Map all tag types to string arrays
    const linkTags = result.tags?.map((tag) => String(tag)) || []
    const contentTags = result.contentTags?.map((tag) => String(tag)) || []
    const metadataTags = result.metadataTags?.map((tag) => String(tag)) || []

    // Primary category is the first content tag
    const aiCategory = contentTags[0] || null

    // Check for paywall indicators from metadataTags
    const isPaywalled =
      metadataTags.includes("PAYMENT_REQUIRED") ||
      metadataTags.includes("SUBSCRIPTION_REQUIRED") ||
      metadataTags.includes("LOGIN_REQUIRED")

    let paywallType: string | null = null
    if (metadataTags.includes("PAYMENT_REQUIRED")) {
      paywallType = "hard"
    } else if (metadataTags.includes("SUBSCRIPTION_REQUIRED")) {
      paywallType = "soft"
    } else if (metadataTags.includes("LOGIN_REQUIRED")) {
      paywallType = "registration"
    }

    // Update the link with analysis results
    const updatedLink = await prisma.link.update({
      where: { id },
      data: {
        fetchStatus: "COMPLETED",
        aiSummary: result.summary || null,
        aiCategory,
        linkTags,
        contentTags,
        metadataTags,
        isPaywalled,
        paywallType,
        analyzedAt: new Date(),
      },
      include: {
        email: {
          select: {
            gmailId: true,
            subject: true,
            receivedAt: true,
          },
        },
      },
    })

    console.log("[/api/links/[id]/analyze] Total time:", Date.now() - startTime, "ms")

    return NextResponse.json({
      success: true,
      link: updatedLink,
      bamlResult: {
        summary: result.summary,
        tags: result.tags,
        contentTags: result.contentTags,
        metadataTags: result.metadataTags,
        extractedLinks: result.links?.length || 0,
      },
    })
  } catch (error) {
    console.error("[/api/links/[id]/analyze] Error:", error)

    // Revert status on error
    await prisma.link.update({
      where: { id },
      data: { fetchStatus: "FETCHED" },
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    )
  }
}
