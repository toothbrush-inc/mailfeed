import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  generateEmbedding,
  formatEmbeddingForPgVector,
} from "@/lib/embeddings"
import { isPgVectorAvailable } from "@/lib/vector-search"
import { getUserSettings } from "@/lib/user-settings"
import { isAiConfigured, getMissingEnvVarMessage } from "@/lib/ai-provider"

interface GenerateResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  hasMore: boolean
  errors: string[]
}

/**
 * Prepares email text for embedding by combining subject and content.
 */
function prepareEmailForEmbedding(email: {
  subject?: string | null
  rawContent?: string | null
  snippet?: string | null
}): string | null {
  const parts: string[] = []

  if (email.subject) {
    parts.push(email.subject)
  }

  // Prefer rawContent, fall back to snippet
  const content = email.rawContent || email.snippet
  if (content) {
    // Truncate if too long (roughly 2048 tokens = 8000 chars)
    const truncated = content.length > 8000 ? content.slice(0, 8000) : content
    parts.push(truncated)
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join("\n\n")
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
    // Find emails that need embeddings
    const emails = await prisma.email.findMany({
      where: {
        userId: session.user.id,
        embeddingStatus: { in: retry ? ["PENDING", "FAILED"] : ["PENDING"] },
      },
      select: {
        id: true,
        subject: true,
        rawContent: true,
        snippet: true,
      },
      take: limit + 1, // Fetch one extra to check if there are more
      orderBy: { receivedAt: "desc" },
    })

    // Check if there are more emails to process
    result.hasMore = emails.length > limit
    const emailsToProcess = emails.slice(0, limit)

    for (const email of emailsToProcess) {
      result.processed++

      // Prepare text for embedding
      const text = prepareEmailForEmbedding(email)

      if (!text) {
        // Skip emails without content
        await prisma.email.update({
          where: { id: email.id },
          data: {
            embeddingStatus: "SKIPPED",
            embeddingError: "No content available for embedding",
          },
        })
        result.skipped++
        continue
      }

      // Mark as processing
      await prisma.email.update({
        where: { id: email.id },
        data: { embeddingStatus: "PROCESSING" },
      })

      try {
        // Generate embedding
        const embedding = await generateEmbedding(text, "RETRIEVAL_DOCUMENT", settings)
        const embeddingStr = formatEmbeddingForPgVector(embedding)

        // Store embedding using raw SQL (Prisma doesn't support vector type)
        await prisma.$executeRaw`
          UPDATE "Email"
          SET embedding = ${embeddingStr}::vector,
              "embeddingStatus" = 'COMPLETED',
              "embeddedAt" = NOW(),
              "embeddingError" = NULL
          WHERE id = ${email.id}
        `

        result.succeeded++
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error"
        await prisma.email.update({
          where: { id: email.id },
          data: {
            embeddingStatus: "FAILED",
            embeddingError: errorMessage,
          },
        })
        result.failed++
        result.errors.push(`Email ${email.id}: ${errorMessage}`)
      }

      // Rate limiting
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("[/api/embeddings/generate-emails] Error:", error)
    return NextResponse.json(
      { error: "Failed to generate embeddings" },
      { status: 500 }
    )
  }
}
