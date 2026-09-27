-- Unsynced range left when check-new stops at its page cap
ALTER TABLE "User" ADD COLUMN "syncGapFrom" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "syncGapUntil" TIMESTAMP(3);
