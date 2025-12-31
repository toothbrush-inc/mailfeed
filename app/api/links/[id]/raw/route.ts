import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const link = await prisma.link.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        finalUrl: true,
        title: true,
        contentText: true,
        rawHtml: true,
        fetchStatus: true,
        fetchedAt: true,
        userId: true,
      },
    })

    if (!link) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 })
    }

    if (link.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    return NextResponse.json({
      id: link.id,
      url: link.url,
      finalUrl: link.finalUrl,
      title: link.title,
      contentText: link.contentText,
      rawHtml: link.rawHtml,
      fetchStatus: link.fetchStatus,
      fetchedAt: link.fetchedAt,
      contentLength: link.contentText?.length || 0,
      rawHtmlLength: link.rawHtml?.length || 0,
    })
  } catch (error) {
    console.error("[/api/links/[id]/raw] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
