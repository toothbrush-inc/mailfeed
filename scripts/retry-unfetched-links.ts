/**
 * One-off backfill: run the worker's fetch recovery over every user's
 * existing links, without the worker's per-run caps or 3-day window.
 *
 * - links left in PENDING/FETCHING/ANALYZING by an interrupted run
 * - failed links whose last failure was temporary (timeout, 5xx, network,
 *   429) and that have been fetched fewer than 4 times
 *
 * Blocked, gone, unreadable and paywalled links are left alone. The dry run
 * also prints failed links by reason.
 *
 *   npx tsx scripts/retry-unfetched-links.ts           # dry run
 *   npx tsx scripts/retry-unfetched-links.ts --apply   # fetch, then submit AI
 */
import "dotenv/config"
import { basePrisma as prisma } from "@/lib/prisma"
import {
  findTransientFetchRetries,
  retryInterruptedFetches,
  retryTransientFetchFailures,
} from "@/lib/sync-user"
import { recoverInterruptedAnalysis, submitPendingAiForUser } from "@/lib/gemini-batch"
import { classifyFetchError, primaryFetchError, type FailureKind } from "@/lib/link-buckets"

const apply = process.argv.includes("--apply")
const DAY_MS = 24 * 60 * 60 * 1000

async function report(userId: string, totals: Record<string, number>) {
  const add = (key: string, n: number) => (totals[key] = (totals[key] || 0) + n)
  const stale = { lt: new Date(Date.now() - DAY_MS) }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hiddenDomains: true } })
  const hidden = user?.hiddenDomains || []
  const visible = hidden.length > 0 ? { OR: [{ domain: null }, { domain: { notIn: hidden } }] } : {}

  add("interrupted fetch, top-level (retry)", await prisma.link.count({
    where: { userId, fetchStatus: { in: ["PENDING", "FETCHING"] }, updatedAt: stale, parentLinkId: null, ...visible },
  }))
  add("interrupted fetch, nested (set FAILED)", await prisma.link.count({
    where: { userId, fetchStatus: { in: ["PENDING", "FETCHING"] }, updatedAt: stale, parentLinkId: { not: null }, ...visible },
  }))
  add("interrupted analysis (requeue, unless in a running batch)", await prisma.link.count({
    where: { userId, fetchStatus: "ANALYZING", updatedAt: stale },
  }))

  const failed = await prisma.link.findMany({
    where: { userId, fetchStatus: "FAILED", parentLinkId: null },
    select: {
      fetchError: true,
      fetchAttempts: {
        orderBy: { createdAt: "desc" },
        select: { operationId: true, fetcherName: true, fetcherId: true, sequence: true, success: true, error: true },
      },
    },
  })
  for (const link of failed) {
    const kind: FailureKind = classifyFetchError(primaryFetchError(link.fetchError, link.fetchAttempts).error)
    add(`failed, top-level: ${kind}`, 1)
  }
  const due = await findTransientFetchRetries(userId, { recentOnly: false, limit: Infinity })
  add("failed, temporary and due for retry", due.length)
}

async function backfill(userId: string) {
  // Each call handles up to 50; handled links are no longer stale, so this ends
  while ((await retryInterruptedFetches(userId, { triggerAi: false })) > 0) {}
  await recoverInterruptedAnalysis(userId)
  await retryTransientFetchFailures(userId, { triggerAi: false, recentOnly: false, limit: Infinity })
  await submitPendingAiForUser(userId)
}

async function main() {
  const users = await prisma.user.findMany({ where: { links: { some: {} } }, select: { id: true } })

  const before: Record<string, number> = {}
  for (const { id } of users) await report(id, before)
  console.log(`\n${users.length} users with links. ${apply ? "Before" : "Dry run"}:`)
  console.table(before)

  if (!apply) {
    console.log("Run with --apply to fetch these and submit analysis.")
    return
  }

  for (const { id } of users) {
    console.log(`\nBackfilling user ${id}`)
    await backfill(id)
  }

  const after: Record<string, number> = {}
  for (const { id } of users) await report(id, after)
  console.log("\nAfter:")
  console.table(after)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
