-- When a link was shared: its email's receivedAt, or when it was added when it
-- came from no email. The feed sorted by the email's date, which put links
-- without an email above every emailed link.
ALTER TABLE "Link" ADD COLUMN "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Link" SET "sharedAt" = "createdAt";
UPDATE "Link" l SET "sharedAt" = e."receivedAt" FROM "Email" e WHERE e."id" = l."emailId";

CREATE INDEX "Link_userId_sharedAt_idx" ON "Link"("userId", "sharedAt");
