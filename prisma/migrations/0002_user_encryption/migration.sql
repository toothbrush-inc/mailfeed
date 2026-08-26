-- Envelope encryption: wrapped per-user DEK + encrypted BYOK API keys.
ALTER TABLE "User" ADD COLUMN "dekWrapped" TEXT;
ALTER TABLE "User" ADD COLUMN "apiKeysEnc" TEXT;
