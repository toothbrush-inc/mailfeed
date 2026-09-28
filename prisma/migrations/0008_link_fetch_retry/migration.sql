-- Automatic retries of temporary fetch failures, counted on the link so a
-- retry that records no FetchAttempt (crash, thrown error) still counts
ALTER TABLE "Link" ADD COLUMN "fetchRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Link" ADD COLUMN "lastFetchRetryAt" TIMESTAMP(3);
