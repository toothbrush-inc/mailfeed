import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { lookUpMedia } from "@/lib/media-lookup"

// POST /api/links/[id]/lookup - Look now for what a post or page points at
// without linking it (a video, a podcast episode, books), replacing what
// an earlier lookup found
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await lookUpMedia(id, session.user.id, { force: true })

  if (result.status === "UNAVAILABLE") {
    return NextResponse.json({ success: false, error: result.note, ...result }, { status: 409 })
  }
  if (result.status === "BUSY") {
    return NextResponse.json(
      { success: false, error: "A lookup for this link is already running.", ...result },
      { status: 409 }
    )
  }
  return NextResponse.json({ success: true, ...result })
}
