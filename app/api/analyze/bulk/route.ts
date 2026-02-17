import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { getUserSettings } from "@/lib/user-settings"
import { isAiConfigured, getMissingEnvVarMessage } from "@/lib/ai-provider"
import { buildClientRegistry } from "@/lib/baml-registry"
import type { LinkInput } from "@/baml_client"
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

  const settings = await getUserSettings(session.user.id)

  if (!isAiConfigured(settings)) {
    return NextResponse.json(
      { error: getMissingEnvVarMessage(settings), code: "AI_NOT_CONFIGURED" },
      { status: 503 }
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
      select: {
        id: true,
        url: true,
        title: true,
        rawHtml: true,
        contentText: true,
      },
      take: limit + 1,
      orderBy: { createdAt: "desc" },
    })

    result.hasMore = links.length > limit
    const linksToProcess = links.slice(0, limit)

    if (linksToProcess.length === 0) {
      return NextResponse.json(result)
    }

    // Mark all as ANALYZING
    const linkIds = linksToProcess.map((l) => l.id)
    await prisma.link.updateMany({
      where: { id: { in: linkIds } },
      data: { fetchStatus: "ANALYZING" },
    })

    // Build BAML inputs
    const bamlInputs: LinkInput[] = linksToProcess.map((link) => ({
      id: link.id,
      url: link.url,
      anchorText: link.title || link.url,
      rawHtml: link.rawHtml || link.contentText || null,
    }))

    result.processed = linksToProcess.length

    try {
      const clientRegistry = buildClientRegistry(settings)
      const bamlResults = await b.BulkIngestLinks(bamlInputs, { clientRegistry })

      // Index results by ID for lookup
      const resultMap = new Map(bamlResults.map((r) => [r.id, r.analysis]))

      // Process each link's results
      for (const link of linksToProcess) {
        const analysis = resultMap.get(link.id)

        if (!analysis) {
          // LLM didn't return a result for this link — revert
          await prisma.link.update({
            where: { id: link.id },
            data: { fetchStatus: "FETCHED" },
          })
          result.failed++
          result.errors.push(`Link ${link.id}: No analysis returned`)
          continue
        }

        try {
          const linkTags = analysis.tags?.map((tag) => String(tag)) || []
          const contentTags = analysis.contentTags?.map((tag) => String(tag)) || []
          const metadataTags = analysis.metadataTags?.map((tag) => String(tag)) || []
          const aiCategory = contentTags[0] || null

          const isPaywalled =
            metadataTags.includes("PAYMENT_REQUIRED") ||
            metadataTags.includes("SUBSCRIPTION_REQUIRED") ||
            metadataTags.includes("LOGIN_REQUIRED")

          let paywallType: string | null = null
          if (metadataTags.includes("PAYMENT_REQUIRED")) {
            paywallType = "hard"
          } else if (metadataTags.includes("SUBSCRIPTION_REQUIRED")) {
            paywallType = "soft"
          } else if (metadataTags.includes("LOGIN_REQUIRED")) {
            paywallType = "registration"
          }

          await prisma.link.update({
            where: { id: link.id },
            data: {
              fetchStatus: "COMPLETED",
              aiSummary: analysis.summary || null,
              aiCategory,
              linkTags,
              contentTags,
              metadataTags,
              isPaywalled,
              paywallType,
              analyzedAt: new Date(),
            },
          })
          result.succeeded++
        } catch (dbError) {
          await prisma.link.update({
            where: { id: link.id },
            data: { fetchStatus: "FETCHED" },
          })
          result.failed++
          result.errors.push(
            `Link ${link.id}: ${dbError instanceof Error ? dbError.message : "DB update failed"}`
          )
        }
      }
    } catch (bamlError) {
      // Entire BAML call failed — revert all links
      console.error("[/api/analyze/bulk] BAML error:", bamlError)
      await prisma.link.updateMany({
        where: { id: { in: linkIds } },
        data: { fetchStatus: "FETCHED" },
      })
      result.failed = linksToProcess.length
      result.errors.push(
        `Bulk analysis failed: ${bamlError instanceof Error ? bamlError.message : "Unknown error"}`
      )
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
