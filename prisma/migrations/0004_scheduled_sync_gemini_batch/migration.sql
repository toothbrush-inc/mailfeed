-- Hourly worker lock + last outcome on User
ALTER TABLE "User" ADD COLUMN "scheduledSyncStartedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastScheduledSyncAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastScheduledSyncError" TEXT;

-- Per-user Gemini Batch API jobs (analysis + embeddings)
CREATE TABLE "GeminiBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "geminiName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "itemIds" TEXT[] NOT NULL,
    "model" TEXT,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GeminiBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeminiBatch_geminiName_key" ON "GeminiBatch"("geminiName");
CREATE INDEX "GeminiBatch_userId_status_idx" ON "GeminiBatch"("userId", "status");
CREATE INDEX "GeminiBatch_status_idx" ON "GeminiBatch"("status");

ALTER TABLE "GeminiBatch" ADD CONSTRAINT "GeminiBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
