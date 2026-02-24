-- ============================================================================
-- MailFeed: Squashed initial migration
-- ============================================================================

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE "FetchStatus" AS ENUM ('PENDING', 'FETCHING', 'FETCHED', 'ANALYZING', 'COMPLETED', 'FAILED', 'PAYWALL_DETECTED');
CREATE TYPE "EmailTag" AS ENUM ('ARTICLE_LINK', 'REMINDER', 'MEETING_INFO', 'TODO', 'OTHER');

-- ============================================================================
-- NextAuth.js tables
-- ============================================================================

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "hiddenDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncAt" TIMESTAMP(3),
    "syncQuery" TEXT,
    "syncNewestEmailDate" TIMESTAMP(3),
    "syncOldestEmailDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- ============================================================================
-- Application tables
-- ============================================================================

CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "rawContent" TEXT,
    "tags" "EmailTag"[],
    "ingestedAt" TIMESTAMP(3),
    "embeddingStatus" TEXT DEFAULT 'PENDING',
    "embeddedAt" TIMESTAMP(3),
    "embeddingError" TEXT,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailId" TEXT,
    "parentLinkId" TEXT,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "domain" TEXT,
    "finalUrl" TEXT,
    "finalUrlHash" TEXT,
    "finalDomain" TEXT,
    "wasRedirected" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "contentText" TEXT,
    "contentHtml" TEXT,
    "rawHtml" TEXT,
    "summary" TEXT,
    "readingTimeMin" INTEGER,
    "wordCount" INTEGER,
    "aiSummary" TEXT,
    "aiKeyPoints" TEXT[],
    "aiCategory" TEXT,
    "aiTags" TEXT[],
    "linkTags" TEXT[],
    "contentTags" TEXT[],
    "metadataTags" TEXT[],
    "worthinessScore" DOUBLE PRECISION,
    "uniquenessScore" DOUBLE PRECISION,
    "isHighlighted" BOOLEAN NOT NULL DEFAULT false,
    "highlightReason" TEXT,
    "fetchStatus" "FetchStatus" NOT NULL DEFAULT 'PENDING',
    "fetchError" TEXT,
    "contentSource" TEXT,
    "archivedUrl" TEXT,
    "isPaywalled" BOOLEAN NOT NULL DEFAULT false,
    "paywallType" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "embeddingStatus" TEXT DEFAULT 'PENDING',
    "embeddedAt" TIMESTAMP(3),
    "embeddingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LinkCategory" (
    "linkId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "LinkCategory_pkey" PRIMARY KEY ("linkId", "categoryId")
);

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

CREATE TABLE "LinkReport" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkReport_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Unique constraints
-- ============================================================================

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE UNIQUE INDEX "Email_gmailId_key" ON "Email"("gmailId");
CREATE UNIQUE INDEX "Link_userId_urlHash_key" ON "Link"("userId", "urlHash");
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- ============================================================================
-- Indexes
-- ============================================================================

-- Account
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- Session
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- Email
CREATE INDEX "Email_userId_idx" ON "Email"("userId");
CREATE INDEX "Email_gmailId_idx" ON "Email"("gmailId");
CREATE INDEX "Email_receivedAt_idx" ON "Email"("receivedAt");
CREATE INDEX "Email_embeddingStatus_idx" ON "Email"("embeddingStatus");

-- Link
CREATE INDEX "Link_userId_idx" ON "Link"("userId");
CREATE INDEX "Link_emailId_idx" ON "Link"("emailId");
CREATE INDEX "Link_parentLinkId_idx" ON "Link"("parentLinkId");
CREATE INDEX "Link_fetchStatus_idx" ON "Link"("fetchStatus");
CREATE INDEX "Link_aiCategory_idx" ON "Link"("aiCategory");
CREATE INDEX "Link_isHighlighted_idx" ON "Link"("isHighlighted");
CREATE INDEX "Link_isRead_idx" ON "Link"("isRead");
CREATE INDEX "Link_createdAt_idx" ON "Link"("createdAt");
CREATE INDEX "Link_worthinessScore_idx" ON "Link"("worthinessScore");
CREATE INDEX "Link_finalUrlHash_idx" ON "Link"("finalUrlHash");
CREATE INDEX "Link_embeddingStatus_idx" ON "Link"("embeddingStatus");

-- Category
CREATE INDEX "Category_slug_idx" ON "Category"("slug");

-- FetchAttempt
CREATE INDEX "FetchAttempt_linkId_idx" ON "FetchAttempt"("linkId");
CREATE INDEX "FetchAttempt_linkId_createdAt_idx" ON "FetchAttempt"("linkId", "createdAt");
CREATE INDEX "FetchAttempt_operationId_idx" ON "FetchAttempt"("operationId");

-- LinkReport
CREATE INDEX "LinkReport_linkId_idx" ON "LinkReport"("linkId");
CREATE INDEX "LinkReport_userId_idx" ON "LinkReport"("userId");
CREATE INDEX "LinkReport_createdAt_idx" ON "LinkReport"("createdAt");

-- ============================================================================
-- Foreign keys
-- ============================================================================

ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Email" ADD CONSTRAINT "Email_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Link" ADD CONSTRAINT "Link_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Link" ADD CONSTRAINT "Link_parentLinkId_fkey" FOREIGN KEY ("parentLinkId") REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LinkCategory" ADD CONSTRAINT "LinkCategory_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkCategory" ADD CONSTRAINT "LinkCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FetchAttempt" ADD CONSTRAINT "FetchAttempt_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkReport" ADD CONSTRAINT "LinkReport_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkReport" ADD CONSTRAINT "LinkReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- pgvector: embedding columns and indexes (not managed by Prisma)
-- ============================================================================

ALTER TABLE "Link" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
ALTER TABLE "Email" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

CREATE INDEX IF NOT EXISTS "Link_embedding_idx" ON "Link" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "Email_embedding_idx" ON "Email" USING hnsw ("embedding" vector_cosine_ops);
