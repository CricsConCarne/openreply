-- N-1 data-preserving rename: InstagramAccount -> SocialAccount.
-- Every statement is an in-place ALTER/RENAME so existing rows and their
-- foreign-key edges survive untouched. No table is dropped or recreated.

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- RenameTable
ALTER TABLE "InstagramAccount" RENAME TO "SocialAccount";

-- RenameColumn: instagramId -> externalId (values preserved in place)
ALTER TABLE "SocialAccount" RENAME COLUMN "instagramId" TO "externalId";

-- AddColumn: platform. DEFAULT 'INSTAGRAM' backfills every existing row so they
-- read back as INSTAGRAM, matching the N-1 origin of the data.
ALTER TABLE "SocialAccount" ADD COLUMN "platform" "SocialPlatform" NOT NULL DEFAULT 'INSTAGRAM';

-- RenamePrimaryKey
ALTER TABLE "SocialAccount" RENAME CONSTRAINT "InstagramAccount_pkey" TO "SocialAccount_pkey";

-- RenameForeignKey (workspace)
ALTER TABLE "SocialAccount" RENAME CONSTRAINT "InstagramAccount_workspaceId_fkey" TO "SocialAccount_workspaceId_fkey";

-- RenameIndex (workspace lookup)
ALTER INDEX "InstagramAccount_workspaceId_idx" RENAME TO "SocialAccount_workspaceId_idx";

-- Replace the single-column unique (instagramId) with the compound
-- unique (platform, externalId). The DROP removes only the old index object;
-- the underlying externalId values are untouched.
DROP INDEX "InstagramAccount_instagramId_key";
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");

-- Automation FK: instagramAccountId -> socialAccountId
ALTER TABLE "Automation" RENAME COLUMN "instagramAccountId" TO "socialAccountId";
ALTER INDEX "Automation_instagramAccountId_idx" RENAME TO "Automation_socialAccountId_idx";
ALTER TABLE "Automation" RENAME CONSTRAINT "Automation_instagramAccountId_fkey" TO "Automation_socialAccountId_fkey";

-- DmLog FK: instagramAccountId -> socialAccountId
ALTER TABLE "DmLog" RENAME COLUMN "instagramAccountId" TO "socialAccountId";
ALTER INDEX "DmLog_instagramAccountId_idx" RENAME TO "DmLog_socialAccountId_idx";
ALTER TABLE "DmLog" RENAME CONSTRAINT "DmLog_instagramAccountId_fkey" TO "DmLog_socialAccountId_fkey";

-- LinkClick FK: instagramAccountId -> socialAccountId
ALTER TABLE "LinkClick" RENAME COLUMN "instagramAccountId" TO "socialAccountId";
ALTER INDEX "LinkClick_instagramAccountId_idx" RENAME TO "LinkClick_socialAccountId_idx";
ALTER TABLE "LinkClick" RENAME CONSTRAINT "LinkClick_instagramAccountId_fkey" TO "LinkClick_socialAccountId_fkey";

-- FollowerSnapshot FK: instagramAccountId -> socialAccountId
ALTER TABLE "FollowerSnapshot" RENAME COLUMN "instagramAccountId" TO "socialAccountId";
ALTER INDEX "FollowerSnapshot_instagramAccountId_date_key" RENAME TO "FollowerSnapshot_socialAccountId_date_key";
ALTER INDEX "FollowerSnapshot_instagramAccountId_date_idx" RENAME TO "FollowerSnapshot_socialAccountId_date_idx";
ALTER TABLE "FollowerSnapshot" RENAME CONSTRAINT "FollowerSnapshot_instagramAccountId_fkey" TO "FollowerSnapshot_socialAccountId_fkey";

-- ProcessedComment: bare string column (no FK), rename column + its index
ALTER TABLE "ProcessedComment" RENAME COLUMN "instagramAccountId" TO "socialAccountId";
ALTER INDEX "ProcessedComment_instagramAccountId_idx" RENAME TO "ProcessedComment_socialAccountId_idx";
