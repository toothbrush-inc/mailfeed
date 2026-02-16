import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseRawHtml } from "@/lib/html-parser"
import { estimateReadingTime } from "@/lib/content-fetcher"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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

  let body: { attemptId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.attemptId) {
    return NextResponse.json({ error: "attemptId is required" }, { status: 400 })
  }

  // Load the fetch attempt with its rawHtml
  const attempt = await prisma.fetchAttempt.findUnique({
    where: { id: body.attemptId },
  })

  if (!attempt) {
    return NextResponse.json({ error: "Fetch attempt not found" }, { status: 404 })
  }

  if (attempt.linkId !== id) {
    return NextResponse.json({ error: "Attempt does not belong to this link" }, { status: 400 })
  }

  if (!attempt.success) {
    return NextResponse.json({ error: "Cannot promote a failed attempt" }, { status: 400 })
  }

  if (!attempt.rawHtml) {
    return NextResponse.json({ error: "Attempt has no rawHtml to promote" }, { status: 400 })
  }

  try {
    // Parse the attempt's raw HTML
    const parsed = parseRawHtml(attempt.rawHtml, link.finalUrl || link.url)

    // Clear embedding vector via raw SQL (Prisma doesn't support vector type)
    await prisma.$executeRaw`
      UPDATE "Link"
      SET embedding = NULL,
          "embeddingStatus" = 'PENDING',
          "embeddedAt" = NULL,
          "embeddingError" = NULL
      WHERE id = ${id}
    `

    // Single atomic update: clear analysis fields + set new content
    const updatedLink = await prisma.link.update({
      where: { id },
      data: {
        // Clear analysis fields
        aiSummary: null,
        aiKeyPoints: [],
        aiCategory: null,
        aiTags: [],
        linkTags: [],
        contentTags: [],
        metadataTags: [],
        worthinessScore: null,
        uniquenessScore: null,
        isHighlighted: false,
        highlightReason: null,
        analyzedAt: null,
        categories: { deleteMany: {} },

        // Set new content from parsed attempt
        title: parsed.title,
        description: parsed.description,
        imageUrl: parsed.imageUrl,
        contentText: parsed.contentText,
        contentHtml: parsed.contentHtml,
        rawHtml: attempt.rawHtml,
        wordCount: parsed.wordCount,
        readingTimeMin: parsed.wordCount > 0
          ? estimateReadingTime(parsed.wordCount)
          : null,
        contentSource: attempt.fetcherId,
        fetchStatus: "FETCHED",
        fetchError: null,
        fetchedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, link: updatedLink })
  } catch (error) {
    console.error("[/api/links/[id]/promote-attempt] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to promote attempt" },
      { status: 500 }
    )
  }
}
