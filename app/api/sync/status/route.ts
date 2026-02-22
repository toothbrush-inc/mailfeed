import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { updateSyncCoverage } from "@/lib/sync-coverage"
import { getUserSettings } from "@/lib/user-settings"

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      lastSyncAt: true,
      syncQuery: true,
      syncNewestEmailDate: true,
      syncOldestEmailDate: true,
    },
  })

  const emailCount = await prisma.email.count({
    where: { userId },
  })

  // Backfill: if coverage dates are missing but emails exist, compute them
  let newestEmailDate = user?.syncNewestEmailDate
  let oldestEmailDate = user?.syncOldestEmailDate
  if (!newestEmailDate && emailCount > 0) {
    const coverage = await updateSyncCoverage(userId)
    newestEmailDate = coverage.newestEmailDate
    oldestEmailDate = coverage.oldestEmailDate
  }

  const settings = await getUserSettings(userId)
  const currentQuery = settings.email.query
  const queryMismatch = user?.syncQuery != null && user.syncQuery !== currentQuery

  return NextResponse.json({
    hasSynced: emailCount > 0,
    emailCount,
    lastSyncAt: user?.lastSyncAt,
    hasMoreHistory: oldestEmailDate != null,
    newestEmailDate: newestEmailDate?.toISOString() || null,
    oldestEmailDate: oldestEmailDate?.toISOString() || null,
    syncQuery: user?.syncQuery || null,
    currentQuery,
    queryMismatch,
  })
}
