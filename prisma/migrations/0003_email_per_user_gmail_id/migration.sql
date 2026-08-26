-- Gmail message IDs are per-mailbox, not globally unique. Scope uniqueness
-- to the owning user so two accounts can never share (or collide on) a row.
DROP INDEX IF EXISTS "Email_gmailId_key";
CREATE UNIQUE INDEX "Email_userId_gmailId_key" ON "Email"("userId", "gmailId");
