import { GoogleGenAI } from "@google/genai"
import { prisma } from "@/lib/prisma"
import { DEFAULT_SETTINGS, type ResolvedSettings } from "@/lib/settings"

function getGenAI(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured")
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

// Default values (still exported for backwards compatibility with vector-search, etc.)
export const EMBEDDING_DIMENSIONS = DEFAULT_SETTINGS.ai.embeddingDimensions
export const EMBEDDING_MODEL = DEFAULT_SETTINGS.ai.embeddingModel

export function getEmbeddingDimensions(settings?: ResolvedSettings): number {
  return settings?.ai.embeddingDimensions ?? EMBEDDING_DIMENSIONS
}

// Maximum characters to embed (roughly 2048 tokens)
const MAX_CONTENT_LENGTH = 8000

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"

interface LinkData {
  title?: string | null
  contentText?: string | null
  description?: string | null
  aiSummary?: string | null
}

/**
 * Prepares text content for embedding by combining title and content.
 * Truncates to stay within token limits.
 */
export function prepareTextForEmbedding(link: LinkData): string | null {
  const parts: string[] = []

  // Add title if present
  if (link.title) {
    parts.push(link.title)
  }

  // Prefer contentText, fall back to description or aiSummary
  const content = link.contentText || link.description || link.aiSummary
  if (content) {
    parts.push(content)
  }

  if (parts.length === 0) {
    return null
  }

  let text = parts.join("\n\n")

  // Truncate if too long
  if (text.length > MAX_CONTENT_LENGTH) {
    text = text.slice(0, MAX_CONTENT_LENGTH)
  }

  return text
}

/**
 * Generates an embedding for the given text using Gemini gemini-embedding-001.
 *
 * @param text - The text to embed
 * @param taskType - RETRIEVAL_DOCUMENT for indexing, RETRIEVAL_QUERY for searching
 * @returns A 768-dimensional embedding vector
 */
export async function generateEmbedding(
  text: string,
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
  settings?: ResolvedSettings
): Promise<number[]> {
  const model = settings?.ai.embeddingModel ?? EMBEDDING_MODEL
  const dimensions = settings?.ai.embeddingDimensions ?? EMBEDDING_DIMENSIONS

  const result = await getGenAI().models.embedContent({
    model,
    contents: text,
    config: {
      taskType,
      outputDimensionality: dimensions,
    },
  })

  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error("No embedding returned from Gemini")
  }

  const embedding = result.embeddings[0]
  if (!embedding.values || embedding.values.length !== dimensions) {
    throw new Error(`Invalid embedding dimensions: expected ${dimensions}, got ${embedding.values?.length}`)
  }

  return embedding.values
}

/**
 * Generates embeddings for multiple texts in batch.
 * Includes rate limiting to avoid API limits.
 *
 * @param texts - Array of texts to embed
 * @param taskType - RETRIEVAL_DOCUMENT for indexing, RETRIEVAL_QUERY for searching
 * @param delayMs - Delay between requests in milliseconds
 * @returns Array of embeddings (null for any that failed)
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
  delayMs: number = 100
): Promise<(number[] | null)[]> {
  const embeddings: (number[] | null)[] = []

  for (let i = 0; i < texts.length; i++) {
    try {
      const embedding = await generateEmbedding(texts[i], taskType)
      embeddings.push(embedding)
    } catch (error) {
      console.error(`[Embeddings] Failed to embed text ${i + 1}/${texts.length}:`, error)
      embeddings.push(null)
    }

    // Rate limiting between requests
    if (i < texts.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  return embeddings
}

/**
 * Formats an embedding vector for pgvector storage.
 * Returns a string like "[0.1, 0.2, ...]" that can be cast to vector type.
 */
export function formatEmbeddingForPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * Parses a pgvector string back to a number array.
 */
export function parseEmbeddingFromPgVector(pgVector: string): number[] {
  // pgvector returns format: [0.1,0.2,...]
  const cleaned = pgVector.replace(/[\[\]]/g, "")
  return cleaned.split(",").map(Number)
}

/**
 * Generates and stores an embedding for a single link.
 * Updates the Link record in the database.
 */
export async function generateAndStoreEmbedding(
  linkId: string,
  settings: ResolvedSettings,
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<{ success: boolean; error?: string }> {
  try {
    const link = await prisma.link.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        title: true,
        contentText: true,
        description: true,
        aiSummary: true,
      },
    })

    if (!link) {
      return { success: false, error: "Link not found" }
    }

    const text = prepareTextForEmbedding(link)
    if (!text) {
      await prisma.link.update({
        where: { id: linkId },
        data: {
          embeddingStatus: "SKIPPED",
          embeddingError: "No content available for embedding",
        },
      })
      return { success: false, error: "No content to embed" }
    }

    await prisma.link.update({
      where: { id: linkId },
      data: { embeddingStatus: "PROCESSING" },
    })

    try {
      const embedding = await generateEmbedding(text, taskType, settings)
      const embeddingStr = formatEmbeddingForPgVector(embedding)

      await prisma.$executeRaw`
        UPDATE "Link"
        SET embedding = ${embeddingStr}::vector,
            "embeddingStatus" = 'COMPLETED',
            "embeddedAt" = NOW(),
            "embeddingError" = NULL
        WHERE id = ${linkId}
      `

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      await prisma.link.update({
        where: { id: linkId },
        data: {
          embeddingStatus: "FAILED",
          embeddingError: errorMessage,
        },
      })
      return { success: false, error: errorMessage }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error(`[Embeddings] Error embedding link ${linkId}:`, msg)
    return { success: false, error: msg }
  }
}
