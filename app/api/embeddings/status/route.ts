import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isPgVectorAvailable } from "@/lib/vector-search"
import { getUserSettings } from "@/lib/user-settings"
import { isAiConfigured } from "@/lib/ai-provider"

interface StatusCounts {
  total: number
  embedded: number
  pending: number
  processing: number
  failed: number
  skipped: number
  coverage: number
}

interface EmbeddingStatus {
  pgvectorAvailable: boolean
  geminiConfigured: boolean
  links: StatusCounts
  emails: StatusCounts
}

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const [pgvectorAvailable, settings] = await Promise.all([
      isPgVectorAvailable(),
      getUserSettings(session.user.id),
    ])

    // Get counts for links
    const [linkTotal, linkStatusCounts] = await Promise.all([
      prisma.link.count({
        where: { userId: session.user.id },
      }),
      prisma.link.groupBy({
        by: ["embeddingStatus"],
        where: { userId: session.user.id },
        _count: true,
      }),
    ])

    // Parse link status counts
    const linkCounts: Record<string, number> = {}
    for (const item of linkStatusCounts) {
      linkCounts[item.embeddingStatus || "PENDING"] = item._count
    }

    const linkEmbedded = linkCounts["COMPLETED"] || 0
    const linkPending = linkCounts["PENDING"] || 0
    const linkProcessing = linkCounts["PROCESSING"] || 0
    const linkFailed = linkCounts["FAILED"] || 0
    const linkSkipped = linkCounts["SKIPPED"] || 0

    // Calculate link coverage
    const linkEligibleTotal = linkTotal - linkSkipped
    const linkCoverage = linkEligibleTotal > 0 ? linkEmbedded / linkEligibleTotal : 0

    // Get counts for emails
    const [emailTotal, emailStatusCounts] = await Promise.all([
      prisma.email.count({
        where: { userId: session.user.id },
      }),
      prisma.email.groupBy({
        by: ["embeddingStatus"],
        where: { userId: session.user.id },
        _count: true,
      }),
    ])

    // Parse email status counts
    const emailCounts: Record<string, number> = {}
    for (const item of emailStatusCounts) {
      emailCounts[item.embeddingStatus || "PENDING"] = item._count
    }

    const emailEmbedded = emailCounts["COMPLETED"] || 0
    const emailPending = emailCounts["PENDING"] || 0
    const emailProcessing = emailCounts["PROCESSING"] || 0
    const emailFailed = emailCounts["FAILED"] || 0
    const emailSkipped = emailCounts["SKIPPED"] || 0

    // Calculate email coverage
    const emailEligibleTotal = emailTotal - emailSkipped
    const emailCoverage = emailEligibleTotal > 0 ? emailEmbedded / emailEligibleTotal : 0

    const status: EmbeddingStatus = {
      pgvectorAvailable,
      geminiConfigured: isAiConfigured(settings),
      links: {
        total: linkTotal,
        embedded: linkEmbedded,
        pending: linkPending,
        processing: linkProcessing,
        failed: linkFailed,
        skipped: linkSkipped,
        coverage: Math.round(linkCoverage * 100) / 100,
      },
      emails: {
        total: emailTotal,
        embedded: emailEmbedded,
        pending: emailPending,
        processing: emailProcessing,
        failed: emailFailed,
        skipped: emailSkipped,
        coverage: Math.round(emailCoverage * 100) / 100,
      },
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
