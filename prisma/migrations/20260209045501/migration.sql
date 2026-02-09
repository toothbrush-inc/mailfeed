/*
  Warnings:

  - You are about to drop the column `embedding` on the `Link` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EmailTag" AS ENUM ('ARTICLE_LINK', 'REMINDER', 'MEETING_INFO', 'TODO', 'OTHER');

-- DropIndex
DROP INDEX "Link_embedding_idx";

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "ingestedAt" TIMESTAMP(3),
ADD COLUMN     "tags" "EmailTag"[];

-- AlterTable
ALTER TABLE "Link" DROP COLUMN "embedding",
ADD COLUMN     "archivedUrl" TEXT,
ADD COLUMN     "contentHtml" TEXT,
ADD COLUMN     "contentSource" TEXT,
ADD COLUMN     "contentTags" TEXT[],
ADD COLUMN     "finalDomain" TEXT,
ADD COLUMN     "finalUrl" TEXT,
ADD COLUMN     "finalUrlHash" TEXT,
ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkTags" TEXT[],
ADD COLUMN     "metadataTags" TEXT[],
ADD COLUMN     "parentLinkId" TEXT,
ADD COLUMN     "rawHtml" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "wasRedirected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hiddenDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "oldestSyncPageToken" TEXT,
ADD COLUMN     "syncPageToken" TEXT;

-- CreateTable
CREATE TABLE "LinkReport" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkReport_linkId_idx" ON "LinkReport"("linkId");

-- CreateIndex
CREATE INDEX "LinkReport_userId_idx" ON "LinkReport"("userId");

-- CreateIndex
CREATE INDEX "LinkReport_createdAt_idx" ON "LinkReport"("createdAt");

-- CreateIndex
CREATE INDEX "Link_parentLinkId_idx" ON "Link"("parentLinkId");

-- CreateIndex
CREATE INDEX "Link_isRead_idx" ON "Link"("isRead");

-- CreateIndex
CREATE INDEX "Link_worthinessScore_idx" ON "Link"("worthinessScore");

-- CreateIndex
CREATE INDEX "Link_finalUrlHash_idx" ON "Link"("finalUrlHash");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_parentLinkId_fkey" FOREIGN KEY ("parentLinkId") REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkReport" ADD CONSTRAINT "LinkReport_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkReport" ADD CONSTRAINT "LinkReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
