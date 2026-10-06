import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { moveLinkToFeed } from "@/lib/sync-user"

const MESSAGES: Record<string, string> = {
  DUPLICATE: "This page is already in your feed.",
  EXCLUDED: "This link leads to a page the feed doesn't keep.",
  HIDDEN: "Moved, but its domain is hidden, so it won't show in the feed.",
}

// POST /api/links/[id]/move-to-feed - Make a link from a podcast episode's
// show notes a feed link of its own: fetch its page and analyze it
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await moveLinkToFeed(id, session.user.id)

  if (result.status === "NOT_FOUND") {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }
  if (result.status === "NOT_MOVABLE") {
    return NextResponse.json(
      { error: "Only a link from an episode's show notes can be moved to the feed." },
      { status: 400 }
    )
  }
  return NextResponse.json({
    success: result.status === "MOVED",
    ...result,
    message: MESSAGES[result.status] ?? (result.fetched ? null : "Moved, but its page couldn't be fetched."),
  })
}
