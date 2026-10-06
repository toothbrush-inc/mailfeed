import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserSettings } from "@/lib/user-settings"
import { rescanForMedia } from "@/lib/media-rescan"

// POST /api/media/rescan - Look through posts already synced for media
// links that weren't kept at the time. Does a few seconds of work per call:
// send back the returned cursor until `done` is true.
export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let cursor: string | null = null
  try {
    const body = await request.json()
    if (typeof body?.cursor === "string") cursor = body.cursor
  } catch {
    // No body: start from the beginning
  }

  const settings = await getUserSettings(session.user.id)
  const result = await rescanForMedia(session.user.id, cursor, settings)

  return NextResponse.json(result)
}
