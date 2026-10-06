import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { rejectFoundLink } from "@/lib/media-lookup"

// DELETE /api/links/[id]/found - "Wrong one": remove a link the media
// lookup found (a video with its clip, a podcast episode, a book) and
// never bring it back for that post or page
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rejected = await rejectFoundLink(id, session.user.id)
  if (!rejected) {
    return NextResponse.json({ error: "Found link not found" }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
