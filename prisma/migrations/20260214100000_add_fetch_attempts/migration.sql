-- CreateTable
CREATE TABLE "FetchAttempt" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fetcherId" TEXT NOT NULL,
    "fetcherName" TEXT,
    "trigger" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "rawHtml" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FetchAttempt_linkId_idx" ON "FetchAttempt"("linkId");

-- CreateIndex
CREATE INDEX "FetchAttempt_linkId_createdAt_idx" ON "FetchAttempt"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "FetchAttempt_operationId_idx" ON "FetchAttempt"("operationId");

-- AddForeignKey
ALTER TABLE "FetchAttempt" ADD CONSTRAINT "FetchAttempt_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
