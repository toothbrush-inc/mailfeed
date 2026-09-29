import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys } from "@/lib/user-keys"
import { isAiConfigured, getMissingEnvVarMessage } from "@/lib/ai-provider"
import { buildClientRegistry } from "@/lib/baml-registry"
import { withBamlUsage } from "@/lib/ai-usage"
import {
  fieldsFromLinkAnalysis,
  recordAnalysisFailure,
  markInsufficientContent,
  analyzableWordCount,
  analyzableText,
  MIN_ANALYZABLE_WORDS,
} from "@/lib/analysis"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id } = await params
  console.log("[/api/links/[id]/analyze] Request started for link:", id)

  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [settings, aiKeys] = await Promise.all([
    getUserSettings(session.user.id),
    getUserAiKeys(session.user.id),
  ])

  if (!isAiConfigured(settings, aiKeys)) {
    return NextResponse.json(
      { error: getMissingEnvVarMessage(settings), code: "AI_NOT_CONFIGURED" },
      { status: 503 }
    )
  }

  // Scope by user before including email body so another mailbox is never decrypted.
  const link = await prisma.link.findFirst({
    where: { id, userId: session.user.id },
    include: {
      email: {
        where: { userId: session.user.id },
        select: {
          rawContent: true,
        },
      },
    },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  const words = analyzableWordCount(analyzableText(link))
  if (words < MIN_ANALYZABLE_WORDS) {
    await markInsufficientContent(session.user.id, [id])
    return NextResponse.json(
      { error: `Not enough content to analyze (${words} words)`, code: "INSUFFICIENT_CONTENT" },
      { status: 422 }
    )
  }

  try {
    // Update status to ANALYZING
    await prisma.link.update({
      where: { id },
      data: { fetchStatus: "ANALYZING" },
    })

    console.log("[/api/links/[id]/analyze] Calling BAML IngestLink...")
    const bamlStart = Date.now()

    // Call BAML IngestLink with url, title (as anchor text), and raw HTML or email content
    // Prefer rawHtml (stored from content fetch) over email rawContent
    const htmlContent = link.rawHtml || link.contentText || link.email?.rawContent || undefined
    const clientRegistry = buildClientRegistry(settings, aiKeys)
    const result = await withBamlUsage({ userId: session.user.id, kind: "ANALYZE_LINK", linkId: id }, (collector) =>
      b.IngestLink(link.url, link.title || link.url, htmlContent, { clientRegistry, collector })
    )

    console.log("[/api/links/[id]/analyze] BAML completed in", Date.now() - bamlStart, "ms")
    console.log("[/api/links/[id]/analyze] Result:", JSON.stringify(result, null, 2))

    // Update the link with analysis results
    const updatedLink = await prisma.link.update({
      where: { id },
      data: fieldsFromLinkAnalysis(result),
      include: {
        email: {
          where: { userId: session.user.id },
          select: {
            gmailId: true,
            subject: true,
            receivedAt: true,
          },
        },
      },
    })

    console.log("[/api/links/[id]/analyze] Total time:", Date.now() - startTime, "ms")

    return NextResponse.json({
      success: true,
      link: updatedLink,
      bamlResult: {
        summary: result.summary,
        keyPoints: result.keyPoints,
        tags: result.tags,
        contentTags: result.contentTags,
        metadataTags: result.metadataTags,
        extractedLinks: result.links?.length || 0,
      },
    })
  } catch (error) {
    console.error("[/api/links/[id]/analyze] Error:", error)

    // Revert status on error and keep the reason for the Digest
    const message = error instanceof Error ? error.message : "Analysis failed"
    await recordAnalysisFailure(session.user.id, [id], message)

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
