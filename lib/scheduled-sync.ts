import { prisma } from "@/lib/prisma"
import {
  runSyncForUser,
  retryInterruptedFetches,
  retryTransientFetchFailures,
  AuthenticationError,
} from "@/lib/sync-user"
import { submitPendingAiForUser, reapPendingBatches, recoverInterruptedAnalysis } from "@/lib/gemini-batch"
import { getUserSettings } from "@/lib/user-settings"
import { createLogger } from "@/lib/logger"

const log = createLogger("ScheduledSync")

const LOCK_STALE_MS = 2 * 60 * 60 * 1000

function userConcurrency(): number {
  const n = Number(process.env.MAILFEED_USER_CONCURRENCY)
  return Number.isFinite(n) && n > 0 ? n : 3
}

function syncIntervalMs(): number {
  const n = Number(process.env.MAILFEED_SYNC_INTERVAL_MS)
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000
}

function reapIntervalMs(): number {
  const n = Number(process.env.MAILFEED_REAP_INTERVAL_MS)
  return Number.isFinite(n) && n > 0 ? n : 2 * 60 * 1000
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item !== undefined) await fn(item)
    }
  })
  await Promise.all(workers)
}

export async function listEligibleUserIds(): Promise<string[]> {
  const accounts = await prisma.account.findMany({
    where: { provider: "google", refresh_token: { not: null } },
    select: { userId: true },
  })
  const unique = [...new Set(accounts.map((a) => a.userId))]
  const eligible: string[] = []
  for (const userId of unique) {
    const settings = await getUserSettings(userId)
    if (settings.sync.scheduled) eligible.push(userId)
  }
  return eligible
}

async function acquireLock(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { scheduledSyncStartedAt: true },
  })
  const started = user?.scheduledSyncStartedAt
  if (started && Date.now() - started.getTime() < LOCK_STALE_MS) {
    return false
  }
  if (started) {
    log.warn("Taking over stale scheduled-sync lock", {
      userId,
      ageMs: Date.now() - started.getTime(),
    })
  }
  await prisma.user.update({
    where: { id: userId },
    data: { scheduledSyncStartedAt: new Date(), lastScheduledSyncError: null },
  })
  return true
}

async function releaseLock(userId: string, error?: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      scheduledSyncStartedAt: null,
      lastScheduledSyncAt: error ? undefined : new Date(),
      lastScheduledSyncError: error ?? null,
    },
  })
}

/**
 * Run fn while holding the user's scheduled-sync lock, so one-off scripts
 * don't fetch the same links as a worker pass. False if the lock is held.
 */
export async function withSyncLock(userId: string, fn: () => Promise<void>): Promise<boolean> {
  if (!(await acquireLock(userId))) return false
  try {
    await fn()
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { scheduledSyncStartedAt: null } })
  }
  return true
}

export async function syncOneUser(userId: string): Promise<void> {
  const locked = await acquireLock(userId)
  if (!locked) {
    log.info("Skipping user — sync already running", { userId })
    return
  }

  try {
    const settings = await getUserSettings(userId)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { syncNewestEmailDate: true },
    })
    const mode = user?.syncNewestEmailDate ? "check-new" : "initial"
    const result = await runSyncForUser(userId, mode, {
      triggerAi: false,
      maxPagesOverride: settings.sync.maxPagesScheduled,
    })

    if (result.queryChanged) {
      log.info("Skipping scheduled sync — email query changed; user must re-sync in the app", { userId })
      await releaseLock(userId)
      return
    }

    log.info("Scheduled sync finished", {
      userId,
      mode: result.mode,
      emails: result.emailsProcessed,
      linksFetched: result.linksFetched,
      upToDate: result.upToDate,
    })

    await retryInterruptedFetches(userId, { triggerAi: false })
    await retryTransientFetchFailures(userId, { triggerAi: false })
    await recoverInterruptedAnalysis(userId)
    await submitPendingAiForUser(userId)
    await releaseLock(userId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof AuthenticationError) {
      log.warn("Gmail auth failed; user needs to reconnect", { userId, code: error.code })
    } else {
      log.error("Scheduled sync failed", error, { userId })
    }
    await releaseLock(userId, message)
  }
}

export async function tick(opts: { sync: boolean }): Promise<void> {
  const reaped = await reapPendingBatches()
  if (reaped > 0) log.info("Reaped in-flight Gemini batches", { count: reaped })

  if (!opts.sync) return

  const users = await listEligibleUserIds()
  log.info("Hourly sync starting", { users: users.length })
  await mapPool(users, userConcurrency(), syncOneUser)
  log.info("Hourly sync finished")
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runWorkerLoop(opts?: { once?: boolean }): Promise<void> {
  if (opts?.once) {
    await tick({ sync: true })
    return
  }

  log.info("Worker loop started", {
    syncIntervalMs: syncIntervalMs(),
    reapIntervalMs: reapIntervalMs(),
  })

  let lastSync = 0
  while (true) {
    const doSync = Date.now() - lastSync >= syncIntervalMs()
    try {
      await tick({ sync: doSync })
      if (doSync) lastSync = Date.now()
    } catch (error) {
      log.error("Tick failed", error)
    }
    await sleep(reapIntervalMs())
  }
}
