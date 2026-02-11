import { GoogleGenAI } from "@google/genai"

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

// Gemini embedding model - requesting 768 dimensions (compatible with pgvector HNSW indexes)
export const EMBEDDING_DIMENSIONS = 768
export const EMBEDDING_MODEL = "gemini-embedding-001"

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
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<number[]> {
  const result = await genAI.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  })

  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error("No embedding returned from Gemini")
  }

  const embedding = result.embeddings[0]
  if (!embedding.values || embedding.values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Invalid embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, got ${embedding.values?.length}`)
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
