import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  generateEmbedding,
  prepareTextForEmbedding,
  formatEmbeddingForPgVector,
} from "@/lib/embeddings"
import { isPgVectorAvailable } from "@/lib/vector-search"

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
        embeddingStatus: "PENDING",
      },
      select: {
        id: true,
        title: true,
        contentText: true,
        description: true,
        aiSummary: true,
      },
      take: limit + 1, // Fetch one extra to check if there are more
      orderBy: { createdAt: "desc" },
    })

    // Check if there are more links to process
    result.hasMore = links.length > limit
    const linksToProcess = links.slice(0, limit)

    for (const link of linksToProcess) {
      result.processed++

      // Prepare text for embedding
      const text = prepareTextForEmbedding(link)

      if (!text) {
        // Skip links without content
        await prisma.link.update({
          where: { id: link.id },
          data: {
            embeddingStatus: "SKIPPED",
            embeddingError: "No content available for embedding",
          },
        })
        result.skipped++
        continue
      }

      // Mark as processing
      await prisma.link.update({
        where: { id: link.id },
        data: { embeddingStatus: "PROCESSING" },
      })

      try {
        // Generate embedding
        const embedding = await generateEmbedding(text, "RETRIEVAL_DOCUMENT")
        const embeddingStr = formatEmbeddingForPgVector(embedding)

        // Store embedding using raw SQL (Prisma doesn't support vector type)
        await prisma.$executeRaw`
          UPDATE "Link"
          SET embedding = ${embeddingStr}::vector,
              "embeddingStatus" = 'COMPLETED',
              "embeddedAt" = NOW(),
              "embeddingError" = NULL
          WHERE id = ${link.id}
        `

        result.succeeded++
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error"
        await prisma.link.update({
          where: { id: link.id },
          data: {
            embeddingStatus: "FAILED",
            embeddingError: errorMessage,
          },
        })
        result.failed++
        result.errors.push(`Link ${link.id}: ${errorMessage}`)
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
