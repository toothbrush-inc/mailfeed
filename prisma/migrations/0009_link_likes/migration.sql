-- Links the user liked (explicit action only; independent of read state)
ALTER TABLE "Link" ADD COLUMN "isLiked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Link" ADD COLUMN "likedAt" TIMESTAMP(3);

CREATE INDEX "Link_userId_isLiked_idx" ON "Link"("userId", "isLiked");
