import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { searchesThisMonth } from "@/lib/ai-usage"
import { searchRateFor } from "@/lib/ai-pricing"
import { BAML_CLIENTS } from "@/lib/ai-provider"

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 365

function validTimeZone(tz: string | null): string {
  if (!tz) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return "UTC"
  }
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const params = request.nextUrl.searchParams
  const days = Math.min(Math.max(parseInt(params.get("days") || "30") || 30, 1), MAX_DAYS)
  const timeZone = validTimeZone(params.get("tz"))
  const now = new Date()
  const since = new Date(now.getTime() - days * DAY_MS)
  const where = { userId, createdAt: { gte: since } }

  const [first, byKind, links, unpriced, searchesMonth, daily] = await Promise.all([
    prisma.aiUsage.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.aiUsage.groupBy({
      by: ["kind"],
      where,
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, searchRequests: true, costUsd: true },
    }),
    prisma.aiUsage.groupBy({ by: ["linkId"], where: { ...where, kind: "ANALYZE_LINK", linkId: { not: null } } }),
    prisma.aiUsage.count({ where: { ...where, costUsd: null } }),
    searchesThisMonth(userId),
    prisma.$queryRaw<Array<{ date: string; cost: number; calls: number }>>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date,
        COALESCE(SUM("costUsd"), 0)::float AS cost,
        COUNT(*)::int AS calls
      FROM "AiUsage"
      WHERE "userId" = ${userId} AND "createdAt" >= ${since}
      GROUP BY 1`,
  ])

  // One entry per local day in the window, zero-filled.
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone })
  const byDate = new Map(daily.map((d) => [d.date, d]))
  const dates = new Set<string>()
  for (let t = since.getTime(); t <= now.getTime(); t += DAY_MS) dates.add(dayKey.format(new Date(t)))
  dates.add(dayKey.format(now))

  const kinds = byKind.map((k) => ({
    kind: k.kind,
    calls: k._count,
    inputTokens: k._sum.inputTokens ?? 0,
    outputTokens: k._sum.outputTokens ?? 0,
    searches: k._sum.searchRequests ?? 0,
    costUsd: k._sum.costUsd ?? 0,
  }))
  // Searches only run on Gemini (the video lookup's search step)
  const searchRate = searchRateFor(BAML_CLIENTS.find((c) => c.name === "CustomGemini")?.model ?? "")
  const totalUsd = kinds.reduce((n, k) => n + k.costUsd, 0)
  const analysisUsd = kinds.find((k) => k.kind === "ANALYZE_LINK")?.costUsd ?? 0

  return NextResponse.json({
    days,
    since: since.toISOString(),
    timeZone,
    trackingSince: first?.createdAt.toISOString() ?? null,
    totalUsd,
    unpricedCalls: unpriced,
    analyzedLinks: links.length,
    costPerLinkUsd: links.length ? analysisUsd / links.length : null,
    byKind: kinds,
    // Google searches run by AI calls: free up to a monthly allowance, then billed each
    search: {
      inWindow: kinds.reduce((n, k) => n + k.searches, 0),
      thisMonth: searchesMonth,
      freePerMonth: searchRate?.freePerMonth ?? null,
      usdPerThousand: searchRate?.perThousand ?? null,
    },
    daily: [...dates].sort().map((date) => ({
      date,
      costUsd: byDate.get(date)?.cost ?? 0,
      calls: byDate.get(date)?.calls ?? 0,
    })),
  })
}
