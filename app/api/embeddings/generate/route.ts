import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  generateAndStoreEmbedding,
} from "@/lib/embeddings"
import { isPgVectorAvailable } from "@/lib/vector-search"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys, resolveGeminiKey } from "@/lib/user-keys"

interface GenerateResult {
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

  const [settings, aiKeys] = await Promise.all([
    getUserSettings(session.user.id),
    getUserAiKeys(session.user.id),
  ])

  // Chat and embeddings run on Gemini regardless of the selected analysis
  // client, so gate on the Gemini key specifically.
  const geminiKey = resolveGeminiKey(aiKeys)
  if (!geminiKey) {
    return NextResponse.json(
      { error: "Embeddings need a Gemini API key. Add yours in Settings → AI.", code: "AI_NOT_CONFIGURED" },
      { status: 503 }
    )
  }

  if (!settings.embeddings.enabled) {
    return NextResponse.json(
      { error: "Embeddings are disabled in settings", code: "EMBEDDINGS_DISABLED" },
      { status: 403 }
    )
  }

  // Check if pgvector is available
  const pgvectorAvailable = await isPgVectorAvailable()
  if (!pgvectorAvailable) {
    return NextResponse.json(
      {
        error: "pgvector extension not installed",
        message:
          "Please install pgvector in PostgreSQL. See prisma/migrations/20250111000000_add_vector_embeddings/migration.sql for instructions.",
      },
      { status: 503 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100)
  const delayMs = parseInt(searchParams.get("delay") || "100")
  const retry = searchParams.get("retry") === "true"

  const result: GenerateResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    hasMore: false,
    errors: [],
  }

  try {
    // Find links that need embeddings
    const links = await prisma.link.findMany({
      where: {
        userId: session.user.id,
        embeddingStatus: { in: retry ? ["PENDING", "FAILED"] : ["PENDING"] },
      },
      select: { id: true },
      take: limit + 1, // Fetch one extra to check if there are more
      orderBy: { createdAt: "desc" },
    })

    // Check if there are more links to process
    result.hasMore = links.length > limit
    const linksToProcess = links.slice(0, limit)

    for (const link of linksToProcess) {
      result.processed++

      const embeddingResult = await generateAndStoreEmbedding(link.id, settings, "RETRIEVAL_DOCUMENT", aiKeys)

      if (embeddingResult.success) {
        result.succeeded++
      } else {
        if (embeddingResult.error === "No content to embed") {
          result.skipped++
        } else {
          result.failed++
          result.errors.push(`Link ${link.id}: ${embeddingResult.error}`)
        }
      }

      // Rate limiting
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("[/api/embeddings/generate] Error:", error)
    return NextResponse.json(
      { error: "Failed to generate embeddings" },
      { status: 500 }
    )
  }
}
