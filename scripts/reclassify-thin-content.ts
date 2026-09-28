/**
 * One-off: mark fetched or analyzed links with too little text as
 * "Not enough content" (PAYWALL_DETECTED / insufficient_content), the same
 * check analysis now runs before every call. Clears the AI fields of links
 * that were already analyzed from that text.
 *
 *   npx tsx scripts/reclassify-thin-content.ts           # dry run
 *   npx tsx scripts/reclassify-thin-content.ts --apply   # write changes
 */
import "dotenv/config"
import { basePrisma as prisma } from "@/lib/prisma"
import {
  analyzableText,
  analyzableWordCount,
  markInsufficientContent,
  MIN_ANALYZABLE_WORDS,
} from "@/lib/analysis"

const apply = process.argv.includes("--apply")
const PAGE = 500

async function main() {
  let cursor: string | undefined
  let checked = 0
  const thinByUser = new Map<string, string[]>()
  const byStatus: Record<string, number> = {}

  for (;;) {
    const links = await prisma.link.findMany({
      where: { fetchStatus: { in: ["FETCHED", "COMPLETED"] } },
      select: { id: true, userId: true, fetchStatus: true, contentText: true, rawHtml: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (links.length === 0) break
    cursor = links[links.length - 1].id
    checked += links.length

    for (const link of links) {
      if (analyzableWordCount(analyzableText(link)) >= MIN_ANALYZABLE_WORDS) continue
      const ids = thinByUser.get(link.userId) ?? []
      ids.push(link.id)
      thinByUser.set(link.userId, ids)
      byStatus[link.fetchStatus] = (byStatus[link.fetchStatus] ?? 0) + 1
    }
  }

  const total = [...thinByUser.values()].reduce((n, ids) => n + ids.length, 0)
  console.log(`Checked ${checked} links; ${total} have under ${MIN_ANALYZABLE_WORDS} words`, byStatus)

  if (!apply) {
    console.log("Dry run. Re-run with --apply to mark them as not enough content.")
    return
  }
  for (const [userId, ids] of thinByUser) {
    await markInsufficientContent(userId, ids)
  }
  console.log(`Marked ${total} links as not enough content.`)
}

main().finally(() => prisma.$disconnect())
