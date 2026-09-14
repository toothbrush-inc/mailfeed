import { prisma } from "@/lib/prisma"
import { getGmailClient, AuthenticationError } from "@/lib/gmail"
import { getUserSettings } from "@/lib/user-settings"
import { syncLogger } from "@/lib/logger"
import { formatGmailDate, updateSyncCoverage } from "@/lib/sync-coverage"
import { makeSyncResults, fetchAndProcessPages } from "@/lib/sync-core"

// Background sync: "email yourself a link and it shows up" without opening
// the app. Off unless MAILFEED_AUTO_SYNC_INTERVAL_MINUTES is set, so the
// self-hosted default is unchanged. Each pass runs the same incremental
// check-new the sync button runs — and only that:
//
// - A user who never ran their initial sync is skipped. The first sync's
//   volume (how many pages of history) is a decision the user makes in the
//   app, not one a timer should make for them.
// - A user whose configured query no longer matches their synced state is
//   skipped; the app asks them to confirm a re-sync.
// - A user whose Gmail token is expired or revoked is skipped quietly —
//   they will be prompted to re-connect next time they open the app.

export type AutoSyncOutcome =
  | { status: "synced"; emailsProcessed: number; linksExtracted: number }
  | { status: "skipped"; reason: "no-user" | "never-synced" | "query-changed" | "auth" }

export async function runCheckNewSync(userId: string): Promise<AutoSyncOutcome> {
  const settings = await getUserSettings(userId)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hiddenDomains: true, syncQuery: true, syncNewestEmailDate: true },
  })
  if (!user) return { status: "skipped", reason: "no-user" }
  if (!user.syncNewestEmailDate) return { status: "skipped", reason: "never-synced" }
  if (user.syncQuery && user.syncQuery !== settings.email.query) {
    return { status: "skipped", reason: "query-changed" }
  }

  let gmail
  try {
    gmail = await getGmailClient(userId)
  } catch (error) {
    if (error instanceof AuthenticationError) return { status: "skipped", reason: "auth" }
    throw error
  }

  // Same shape as the route's check-new: overlap the window by a day and
  // fetch one page; dedupe against stored gmailIds handles the overlap.
  const afterDate = new Date(user.syncNewestEmailDate)
  afterDate.setDate(afterDate.getDate() - 1)
  const query = `${settings.email.query} after:${formatGmailDate(afterDate)}`

  const syncResults = makeSyncResults("check-new")
  const hiddenDomains = new Set(user.hiddenDomains || [])
  await fetchAndProcessPages(userId, query, 1, gmail, hiddenDomains, settings, syncResults)
  await updateSyncCoverage(userId)
  await prisma.user.update({ where: { id: userId }, data: { lastSyncAt: new Date() } })

  return {
    status: "synced",
    emailsProcessed: syncResults.emailsProcessed,
    linksExtracted: syncResults.linksExtracted,
  }
}

async function syncAllUsers(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { provider: "google" },
    select: { userId: true, scope: true },
  })

  for (const account of accounts) {
    if (!account.scope?.includes("gmail.readonly")) continue
    try {
      const outcome = await runCheckNewSync(account.userId)
      if (outcome.status === "synced" && outcome.emailsProcessed > 0) {
        syncLogger.info("[AutoSync] synced", { userId: account.userId, ...outcome })
      }
    } catch (error) {
      // One user's failure must not stop the others.
      syncLogger.error(`[AutoSync] failed for user ${account.userId}`, error)
    }
  }
}

const MIN_INTERVAL_MINUTES = 5
const STARTUP_DELAY_MS = 60_000

// Survives dev-mode module reloads, same pattern as the prisma singleton.
const globalForAutoSync = globalThis as unknown as { autoSyncStarted?: boolean }

export function startAutoSync(): void {
  if (globalForAutoSync.autoSyncStarted) return
  globalForAutoSync.autoSyncStarted = true

  const minutes = Number(process.env.MAILFEED_AUTO_SYNC_INTERVAL_MINUTES ?? "0")
  if (!Number.isFinite(minutes) || minutes <= 0) {
    syncLogger.info("[AutoSync] disabled (MAILFEED_AUTO_SYNC_INTERVAL_MINUTES not set)")
    return
  }
  const intervalMs = Math.max(minutes, MIN_INTERVAL_MINUTES) * 60_000

  let running = false
  const tick = async () => {
    if (running) return // a slow pass just skips the next beat, never overlaps
    running = true
    try {
      await syncAllUsers()
    } catch (error) {
      syncLogger.error("[AutoSync] pass failed", error)
    } finally {
      running = false
    }
  }

  syncLogger.info(`[AutoSync] every ${intervalMs / 60_000} min, first pass in 1 min`)
  setTimeout(tick, STARTUP_DELAY_MS)
  setInterval(tick, intervalMs)
}
