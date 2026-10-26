-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN     "mediaId" TEXT;

-- AlterTable
ALTER TABLE "LinkClick" ADD COLUMN     "mediaId" TEXT;

-- CreateIndex
CREATE INDEX "DmLog_automationId_mediaId_idx" ON "DmLog"("automationId", "mediaId");

-- CreateIndex
CREATE INDEX "LinkClick_automationId_mediaId_idx" ON "LinkClick"("automationId", "mediaId");
