-- Add embedding columns to Email table (matching Link table pattern)
ALTER TABLE "Email" ADD COLUMN IF NOT EXISTS "embeddingStatus" TEXT DEFAULT 'PENDING';
ALTER TABLE "Email" ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);
ALTER TABLE "Email" ADD COLUMN IF NOT EXISTS "embeddingError" TEXT;

-- Add index for embedding status queries
CREATE INDEX IF NOT EXISTS "Email_embeddingStatus_idx" ON "Email"("embeddingStatus");
