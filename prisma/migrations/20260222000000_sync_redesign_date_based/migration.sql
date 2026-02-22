-- AlterTable: Drop old sync page tokens and add date-based sync fields
ALTER TABLE "User" DROP COLUMN IF EXISTS "syncPageToken";
ALTER TABLE "User" DROP COLUMN IF EXISTS "oldestSyncPageToken";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "syncQuery" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "syncNewestEmailDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "syncOldestEmailDate" TIMESTAMP(3);
