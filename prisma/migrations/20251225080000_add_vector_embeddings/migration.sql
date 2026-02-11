-- ============================================================================
-- pgvector Extension Migration for RAG
-- ============================================================================
-- Prerequisites:
--   1. Install pgvector extension on your PostgreSQL server:
--      - macOS (Homebrew): brew install pgvector
--      - Ubuntu/Debian: apt install postgresql-16-pgvector
--      - Docker: Use ankane/pgvector image
--   2. Run this migration after pgvector is installed
-- ============================================================================

-- Enable pgvector extension (requires superuser or extension installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (768 dimensions for Gemini gemini-embedding-001)
ALTER TABLE "Link" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- Add embedding tracking fields (if not already added via Prisma)
ALTER TABLE "Link" ADD COLUMN IF NOT EXISTS "embeddingStatus" TEXT DEFAULT 'PENDING';
ALTER TABLE "Link" ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);
ALTER TABLE "Link" ADD COLUMN IF NOT EXISTS "embeddingError" TEXT;

-- Create HNSW index for fast similarity search
-- HNSW is preferred over IVFFlat as it works with empty tables and has better recall
CREATE INDEX IF NOT EXISTS "Link_embedding_idx" ON "Link"
USING hnsw ("embedding" vector_cosine_ops);

-- Index for finding links needing embeddings
CREATE INDEX IF NOT EXISTS "Link_embeddingStatus_idx" ON "Link"("embeddingStatus");
