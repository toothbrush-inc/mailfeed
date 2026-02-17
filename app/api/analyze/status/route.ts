import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserSettings } from "@/lib/user-settings"
import { isAiConfigured } from "@/lib/ai-provider"

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const [settings, statusCounts] = await Promise.all([
      getUserSettings(session.user.id),
      prisma.link.groupBy({
        by: ["fetchStatus"],
        where: { userId: session.user.id },
        _count: true,
      }),
    ])

    const counts: Record<string, number> = {}
    let total = 0
    for (const item of statusCounts) {
      counts[item.fetchStatus] = item._count
      total += item._count
    }

    const analyzed = counts["COMPLETED"] || 0
    const needsAnalysis = counts["FETCHED"] || 0
    const analyzing = counts["ANALYZING"] || 0
    const failed = (counts["FAILED"] || 0) + (counts["PAYWALL_DETECTED"] || 0)
    const notReady = (counts["PENDING"] || 0) + (counts["FETCHING"] || 0)

    const eligible = total - failed - notReady
    const coverage = eligible > 0 ? Math.round((analyzed / eligible) * 100) / 100 : 0

    return NextResponse.json({
      total,
      analyzed,
      needsAnalysis,
      analyzing,
      failed,
      notReady,
      aiConfigured: isAiConfigured(settings),
      coverage,
    })
  } catch (error) {
    console.error("[/api/analyze/status] Error:", error)
    return NextResponse.json(
      { error: "Failed to get analysis status" },
      { status: 500 }
    )
  }
}
