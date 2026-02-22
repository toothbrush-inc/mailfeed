import { prisma } from "@/lib/prisma"

/**
 * Format a Date for Gmail's date search operators (after:/before:).
 * Gmail uses day-granularity: YYYY/MM/DD
 */
export function formatGmailDate(date: Date): string {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * Query the Email table for min/max receivedAt and count,
 * then update syncNewestEmailDate and syncOldestEmailDate on the User.
 */
export async function updateSyncCoverage(userId: string) {
  const result = await prisma.email.aggregate({
    where: { userId },
    _min: { receivedAt: true },
    _max: { receivedAt: true },
    _count: true,
  })

  const newestEmailDate = result._max.receivedAt
  const oldestEmailDate = result._min.receivedAt
  const emailCount = result._count

  await prisma.user.update({
    where: { id: userId },
    data: {
      syncNewestEmailDate: newestEmailDate,
      syncOldestEmailDate: oldestEmailDate,
    },
  })

  return { newestEmailDate, oldestEmailDate, emailCount }
}
