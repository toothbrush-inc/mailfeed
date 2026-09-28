import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { setLinkLiked } from "@/lib/link-likes"

async function handle(params: Promise<{ id: string }>, liked: boolean) {
  const { id } = await params
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Owner-scoped: another user's link is simply not found
  const link = await setLinkLiked(id, session.user.id, liked)
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, link })
}

// POST /api/links/[id]/like - Like link
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(params, true)
}

// DELETE /api/links/[id]/like - Unlike link
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(params, false)
}
