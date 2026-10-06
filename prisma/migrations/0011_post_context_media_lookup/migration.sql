-- Social post context (quoted post, attached video), how a nested link was
-- found, books a page mentions, and the media lookup that finds the public
-- video, podcast episode or book a post or page points at without linking it
ALTER TABLE "Link" ADD COLUMN "postContext" JSONB;
ALTER TABLE "Link" ADD COLUMN "foundVia" TEXT;
ALTER TABLE "Link" ADD COLUMN "foundRole" TEXT;
ALTER TABLE "Link" ADD COLUMN "mentionedBooks" JSONB;
ALTER TABLE "Link" ADD COLUMN "lookupStatus" TEXT;
ALTER TABLE "Link" ADD COLUMN "lookupAt" TIMESTAMP(3);
ALTER TABLE "Link" ADD COLUMN "lookupNote" TEXT;
ALTER TABLE "Link" ADD COLUMN "lookupRejected" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Link_userId_lookupStatus_idx" ON "Link"("userId", "lookupStatus");

-- Google searches run by a grounded AI call, billed per search on top of tokens
ALTER TABLE "AiUsage" ADD COLUMN "searchRequests" INTEGER NOT NULL DEFAULT 0;
