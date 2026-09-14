import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { runSyncForUser, AuthenticationError, type SyncMode } from "@/lib/sync-user"
import { syncLogger } from "@/lib/logger"

export async function POST(request: Request) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const reqUrl = new URL(request.url)
  const mode = (reqUrl.searchParams.get("mode") || "check-new") as SyncMode

  try {
    const syncResults = await runSyncForUser(session.user.id, mode)
    return NextResponse.json(syncResults)
  } catch (error) {
    if (error instanceof AuthenticationError) {
      syncLogger.error("Authentication failed", error)
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          requiresReauth: true,
        },
        { status: 401 }
      )
    }

    if (error instanceof Error && error.message === "Run initial sync first") {
      return NextResponse.json({ error: error.message, mode }, { status: 400 })
    }

    if (error instanceof Error && error.message.startsWith("Unknown mode:")) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    syncLogger.error("Sync failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    )
  }
}
