import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isPgVectorAvailable } from "@/lib/vector-search"

interface EmbeddingStatus {
  pgvectorAvailable: boolean
  total: number
  embedded: number
  pending: number
  processing: number
  failed: number
  skipped: number
  coverage: number
}

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const pgvectorAvailable = await isPgVectorAvailable()

    // Get counts for each status
    const [total, statusCounts] = await Promise.all([
      prisma.link.count({
        where: { userId: session.user.id },
      }),
      prisma.link.groupBy({
        by: ["embeddingStatus"],
        where: { userId: session.user.id },
        _count: true,
      }),
    ])

    // Parse status counts
    const counts: Record<string, number> = {}
    for (const item of statusCounts) {
      counts[item.embeddingStatus || "PENDING"] = item._count
    }

    const embedded = counts["COMPLETED"] || 0
    const pending = counts["PENDING"] || 0
    const processing = counts["PROCESSING"] || 0
    const failed = counts["FAILED"] || 0
    const skipped = counts["SKIPPED"] || 0

    // Calculate coverage (completed / (total - skipped))
    const eligibleTotal = total - skipped
    const coverage = eligibleTotal > 0 ? embedded / eligibleTotal : 0

    const status: EmbeddingStatus = {
      pgvectorAvailable,
      total,
      embedded,
      pending,
      processing,
      failed,
      skipped,
      coverage: Math.round(coverage * 100) / 100,
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error("[/api/embeddings/status] Error:", error)
    return NextResponse.json(
      { error: "Failed to get embedding status" },
      { status: 500 }
    )
  }
}
