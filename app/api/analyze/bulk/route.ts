import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { getUserSettings } from "@/lib/user-settings"
import { isAiConfigured, getMissingEnvVarMessage } from "@/lib/ai-provider"
import { analyzeLink } from "@/lib/analysis"
import { FEATURE_FLAGS } from "@/lib/flags"
import type { FetchStatus } from "@prisma/client"

interface BulkAnalyzeResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  hasMore: boolean
  errors: string[]
}

export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!FEATURE_FLAGS.enableAnalysis) {
    return NextResponse.json(
      { error: "Analysis feature is globally disabled", code: "ANALYSIS_GLOBALLY_DISABLED" },
      { status: 404 }
    )
  }

  const settings = await getUserSettings(session.user.id)

  if (!isAiConfigured(settings)) {
    return NextResponse.json(
      { error: getMissingEnvVarMessage(settings), code: "AI_NOT_CONFIGURED" },
      { status: 503 }
    )
  }

  if (!settings.analysis.enabled) {
    return NextResponse.json(
      { error: "Content analysis is disabled in settings", code: "ANALYSIS_DISABLED" },
      { status: 403 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)
  const reanalyze = searchParams.get("reanalyze") === "true"

  const result: BulkAnalyzeResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    hasMore: false,
    errors: [],
  }

  try {
    const statuses: FetchStatus[] = ["FETCHED"]
    if (reanalyze) statuses.push("COMPLETED")

    const links = await prisma.link.findMany({
      where: {
        userId: session.user.id,
        fetchStatus: { in: statuses },
      },
      select: { id: true },
      take: limit + 1,
      orderBy: { createdAt: "desc" },
    })

    result.hasMore = links.length > limit
    const linksToProcess = links.slice(0, limit)

    if (linksToProcess.length === 0) {
      return NextResponse.json(result)
    }

    result.processed = linksToProcess.length

    // Process each link
    // Note: We process sequentially to avoid hitting rate limits too hard,
    // though analyzeLink handles individual errors gracefully.
    for (const link of linksToProcess) {
      const analysisResult = await analyzeLink(link.id, settings)

      if (analysisResult.success) {
        result.succeeded++
      } else {
        result.failed++
        result.errors.push(`Link ${link.id}: ${analysisResult.error}`)
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("[/api/analyze/bulk] Error:", error)
    return NextResponse.json(
      { error: "Failed to run bulk analysis" },
      { status: 500 }
    )
  }
}
