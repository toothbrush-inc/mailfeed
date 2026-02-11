import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { formatEmbeddingForPgVector, EMBEDDING_DIMENSIONS } from "./embeddings"

export interface SimilarLink {
  id: string
  url: string
  title: string | null
  aiSummary: string | null
  aiKeyPoints: string[]
  contentText: string | null
  aiCategory: string | null
  similarity: number
}

export interface SimilarEmail {
  id: string
  subject: string | null
  snippet: string | null
  receivedAt: Date
  similarity: number
}

export type SimilarContent =
  | ({ type: 'link' } & SimilarLink)
  | ({ type: 'email' } & SimilarEmail)

/**
 * Searches for links similar to the query embedding using pgvector.
 * Falls back gracefully if pgvector is not available.
 *
 * @param userId - The user's ID to scope the search
 * @param queryEmbedding - The 768-dimensional query embedding
 * @param limit - Maximum number of results to return
 * @param threshold - Minimum similarity score (0-1, higher = more similar)
 * @returns Array of similar links sorted by similarity
 */
export async function searchSimilarLinks(
  userId: string,
  queryEmbedding: number[],
  limit: number = 10,
  threshold: number = 0.3
): Promise<SimilarLink[]> {
  // Validate embedding dimensions
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, got ${queryEmbedding.length}`
    )
  }

  const embeddingStr = formatEmbeddingForPgVector(queryEmbedding)

  try {
    // Use raw SQL for pgvector cosine similarity search
    // The <=> operator computes cosine distance (1 - similarity)
    // We convert to similarity by doing 1 - distance
    const results = await prisma.$queryRaw<
      Array<{
        id: string
        url: string
        title: string | null
        aiSummary: string | null
        aiKeyPoints: string[]
        contentText: string | null
        aiCategory: string | null
        similarity: number
      }>
    >`
      SELECT
        id,
        url,
        title,
        "aiSummary",
        "aiKeyPoints",
        "contentText",
        "aiCategory",
        1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM "Link"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${embeddingStr}::vector) > ${threshold}
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `

    return results
  } catch (error) {
    // Check if this is a pgvector-related error
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      (error instanceof Error && error.message.includes("vector"))
    ) {
      console.warn(
        "[Vector Search] pgvector not available, falling back to text search"
      )
      return []
    }
    throw error
  }
}

/**
 * Checks if pgvector is available and working.
 */
export async function isPgVectorAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM pg_extension WHERE extname = 'vector'`
    return true
  } catch {
    return false
  }
}

/**
 * Text-based fallback search when vector search is not available.
 * Uses Prisma's contains for case-insensitive matching.
 */
export async function textSearchLinks(
  userId: string,
  searchTerm: string,
  limit: number = 10
): Promise<SimilarLink[]> {
  const results = await prisma.link.findMany({
    where: {
      userId,
      OR: [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { aiSummary: { contains: searchTerm, mode: "insensitive" } },
        { contentText: { contains: searchTerm, mode: "insensitive" } },
        { aiCategory: { contains: searchTerm, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      url: true,
      title: true,
      aiSummary: true,
      aiKeyPoints: true,
      contentText: true,
      aiCategory: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  })

  // Return with a fixed similarity score since this is text-based
  return results.map((link) => ({
    ...link,
    similarity: 0.5, // Default similarity for text matches
  }))
}

/**
 * Searches both links and emails using vector similarity.
 * Returns unified results sorted by similarity.
 *
 * @param userId - The user's ID to scope the search
 * @param queryEmbedding - The 768-dimensional query embedding
 * @param limit - Maximum number of results to return
 * @param threshold - Minimum similarity score (0-1, higher = more similar)
 * @returns Array of similar content (links and emails) sorted by similarity
 */
export async function searchSimilarContent(
  userId: string,
  queryEmbedding: number[],
  limit: number = 10,
  threshold: number = 0.3
): Promise<SimilarContent[]> {
  // Validate embedding dimensions
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, got ${queryEmbedding.length}`
    )
  }

  const embeddingStr = formatEmbeddingForPgVector(queryEmbedding)

  try {
    // Use UNION to search both links and emails
    const results = await prisma.$queryRaw<
      Array<{
        id: string
        type: 'link' | 'email'
        url: string | null
        title: string | null
        aiSummary: string | null
        aiKeyPoints: string[] | null
        contentText: string | null
        aiCategory: string | null
        subject: string | null
        snippet: string | null
        receivedAt: Date | null
        similarity: number
      }>
    >`
      SELECT
        id,
        'link' as type,
        url,
        title,
        "aiSummary",
        "aiKeyPoints",
        "contentText",
        "aiCategory",
        NULL as subject,
        NULL as snippet,
        NULL as "receivedAt",
        1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM "Link"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${embeddingStr}::vector) > ${threshold}

      UNION ALL

      SELECT
        id,
        'email' as type,
        NULL as url,
        NULL as title,
        NULL as "aiSummary",
        NULL as "aiKeyPoints",
        NULL as "contentText",
        NULL as "aiCategory",
        subject,
        snippet,
        "receivedAt",
        1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM "Email"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${embeddingStr}::vector) > ${threshold}

      ORDER BY similarity DESC
      LIMIT ${limit}
    `

    // Transform results into typed objects
    return results.map((row) => {
      if (row.type === 'email') {
        return {
          type: 'email' as const,
          id: row.id,
          subject: row.subject,
          snippet: row.snippet,
          receivedAt: row.receivedAt!,
          similarity: row.similarity,
        }
      } else {
        return {
          type: 'link' as const,
          id: row.id,
          url: row.url!,
          title: row.title,
          aiSummary: row.aiSummary,
          aiKeyPoints: row.aiKeyPoints || [],
          contentText: row.contentText,
          aiCategory: row.aiCategory,
          similarity: row.similarity,
        }
      }
    })
  } catch (error) {
    // Check if this is a pgvector-related error
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      (error instanceof Error && error.message.includes("vector"))
    ) {
      console.warn(
        "[Vector Search] pgvector not available, falling back to text search"
      )
      return []
    }
    throw error
  }
}

/**
 * Combined search that tries vector search first, then falls back to text search.
 */
export async function searchLinks(
  userId: string,
  queryEmbedding: number[] | null,
  searchTerm: string,
  limit: number = 10,
  threshold: number = 0.3
): Promise<SimilarLink[]> {
  // If we have an embedding, try vector search first
  if (queryEmbedding && queryEmbedding.length === EMBEDDING_DIMENSIONS) {
    const vectorResults = await searchSimilarLinks(
      userId,
      queryEmbedding,
      limit,
      threshold
    )

    if (vectorResults.length > 0) {
      return vectorResults
    }
  }

  // Fall back to text search
  return textSearchLinks(userId, searchTerm, limit)
}
