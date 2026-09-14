import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getGmailClient, AuthenticationError } from "@/lib/gmail"
import { syncLogger } from "@/lib/logger"
import { getUserSettings } from "@/lib/user-settings"
import { formatGmailDate, updateSyncCoverage } from "@/lib/sync-coverage"
import {
  makeSyncResults,
  fetchAndProcessPages,
  type SyncMode,
  type SyncResults,
} from "@/lib/sync-core"
import type { ResolvedSettings } from "@/lib/settings"

export async function POST(request: Request) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const settings = await getUserSettings(userId)

  // Parse mode from query params
  const reqUrl = new URL(request.url)
  const mode = (reqUrl.searchParams.get("mode") || "check-new") as SyncMode

  const syncResults = makeSyncResults(mode)

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        hiddenDomains: true,
        syncQuery: true,
        syncNewestEmailDate: true,
        syncOldestEmailDate: true,
      },
    })
    const hiddenDomains = new Set(user?.hiddenDomains || [])

    const gmail = await getGmailClient(userId)

    // ───────────────────────────────────────
    // Mode dispatch
    // ───────────────────────────────────────

    if (mode === "check-new") {
      // 1. Query mismatch check
      if (user?.syncQuery && user.syncQuery !== settings.email.query) {
        syncResults.queryChanged = true
        return NextResponse.json(syncResults)
      }

      // 2. If never synced, fall through to initial
      if (!user?.syncNewestEmailDate) {
        return handleInitialSync(userId, settings, gmail, hiddenDomains, syncResults)
      }

      // 3. Build query with after: filter (subtract 1 day for overlap safety)
      const afterDate = new Date(user.syncNewestEmailDate)
      afterDate.setDate(afterDate.getDate() - 1)
      const query = `${settings.email.query} after:${formatGmailDate(afterDate)}`

      // check-new only fetches 1 page
      await fetchAndProcessPages(userId, query, 1, gmail, hiddenDomains, settings, syncResults)

      if (syncResults.emailsProcessed === 0) {
        syncResults.upToDate = true
      }

      // Update coverage
      await updateSyncCoverage(userId)

    } else if (mode === "load-more") {
      if (!user?.syncOldestEmailDate) {
        return NextResponse.json(
          { error: "Run initial sync first", mode },
          { status: 400 }
        )
      }

      // Build query with before: filter (add 1 day for overlap safety)
      const beforeDate = new Date(user.syncOldestEmailDate)
      beforeDate.setDate(beforeDate.getDate() + 1)
      const query = `${settings.email.query} before:${formatGmailDate(beforeDate)}`

      await fetchAndProcessPages(
        userId, query, settings.sync.maxPagesLoadMore, gmail, hiddenDomains, settings, syncResults
      )

      // Update coverage
      await updateSyncCoverage(userId)

    } else if (mode === "initial" || mode === "full-resync") {
      return handleInitialSync(userId, settings, gmail, hiddenDomains, syncResults)

    } else {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
    }

    // Finalize
    syncResults.emailsSynced = await prisma.email.count({ where: { userId } })

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { syncNewestEmailDate: true, syncOldestEmailDate: true },
    })
    syncResults.newestEmailDate = updatedUser?.syncNewestEmailDate?.toISOString() || null
    syncResults.oldestEmailDate = updatedUser?.syncOldestEmailDate?.toISOString() || null

    await prisma.user.update({
      where: { id: userId },
      data: { lastSyncAt: new Date() },
    })

    syncLogger.info("Completed", {
      mode,
      pagesProcessed: syncResults.pagesProcessed,
      emails: syncResults.emailsProcessed,
      links: syncResults.linksExtracted,
      hasMore: syncResults.hasMoreHistory,
    })

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

    syncLogger.error("Sync failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    )
  }
}

async function handleInitialSync(
  userId: string,
  settings: ResolvedSettings,
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  hiddenDomains: Set<string>,
  syncResults: SyncResults
) {
  // Clear sync state
  await prisma.user.update({
    where: { id: userId },
    data: {
      syncQuery: null,
      syncNewestEmailDate: null,
      syncOldestEmailDate: null,
    },
  })

  // Fetch with plain query (no date filter)
  await fetchAndProcessPages(
    userId, settings.email.query, settings.sync.maxPagesInitial, gmail, hiddenDomains, settings, syncResults
  )

  // Set sync state from processed emails
  const coverage = await updateSyncCoverage(userId)

  await prisma.user.update({
    where: { id: userId },
    data: {
      syncQuery: settings.email.query,
      lastSyncAt: new Date(),
    },
  })

  syncResults.emailsSynced = await prisma.email.count({ where: { userId } })
  syncResults.newestEmailDate = coverage.newestEmailDate?.toISOString() || null
  syncResults.oldestEmailDate = coverage.oldestEmailDate?.toISOString() || null

  syncLogger.info("Initial sync completed", {
    mode: syncResults.mode,
    pagesProcessed: syncResults.pagesProcessed,
    emails: syncResults.emailsProcessed,
    links: syncResults.linksExtracted,
    hasMore: syncResults.hasMoreHistory,
  })

  return NextResponse.json(syncResults)
}
