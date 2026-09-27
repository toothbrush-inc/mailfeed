-- check-new resume point when a run stops at its page cap
ALTER TABLE "User" ADD COLUMN "syncGapFrom" TIMESTAMP(3);
