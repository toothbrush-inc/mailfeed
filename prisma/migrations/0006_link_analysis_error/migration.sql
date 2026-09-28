-- Why the last AI analysis of a link failed, and how many times it has
ALTER TABLE "Link" ADD COLUMN "analysisError" TEXT;
ALTER TABLE "Link" ADD COLUMN "analysisAttempts" INTEGER NOT NULL DEFAULT 0;
