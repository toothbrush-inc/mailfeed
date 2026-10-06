import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isMediaType } from "@/lib/media"
import { listMedia } from "@/lib/media-list"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys } from "@/lib/user-keys"
import { countPendingLookups, lookupUnavailableReason } from "@/lib/media-lookup"

// GET /api/media - Videos, podcasts, books and games among the user's links
export async function GET(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const searchParams = request.nextUrl.searchParams
  const typeParam = searchParams.get("type")

  const [user, settings, aiKeys, pendingLookups] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { hiddenDomains: true } }),
    getUserSettings(userId),
    getUserAiKeys(userId),
    countPendingLookups(userId),
  ])

  const result = await listMedia(userId, {
    type: isMediaType(typeParam) ? typeParam : null,
    search: searchParams.get("search"),
    page: parseInt(searchParams.get("page") || "1") || 1,
    limit: parseInt(searchParams.get("limit") || "30") || 30,
    hiddenDomains: user?.hiddenDomains || [],
  })

  return NextResponse.json({
    ...result,
    // Posts and pages that point at a video, podcast episode or book they don't link
    lookups: {
      pending: pendingLookups,
      unavailable: lookupUnavailableReason(settings, aiKeys),
    },
  })
}
