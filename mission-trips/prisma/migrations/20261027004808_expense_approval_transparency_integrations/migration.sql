-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('CSV_EXPORT', 'PLANNING_CENTER', 'TITHELY', 'SUBSPLASH', 'QUICKBOOKS');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "RecordOwner" AS ENUM ('SENT', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('IMPORT', 'EXPORT');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExpenseStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ExpenseStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "requestedStatus" "ExpenseStatus",
ADD COLUMN     "reviewNote" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "showLiveFinancials" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "credentialsEncrypted" TEXT,
    "settings" JSONB,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "owner" "RecordOwner" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "recordsTotal" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_orgId_provider_key" ON "Integration"("orgId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLink_orgId_provider_entityType_externalId_key" ON "ExternalLink"("orgId", "provider", "entityType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLink_orgId_provider_entityType_entityId_key" ON "ExternalLink"("orgId", "provider", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "SyncRun_orgId_startedAt_idx" ON "SyncRun"("orgId", "startedAt");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Expenses recorded before approvals existed were accepted when entered.
-- Record that faithfully: approved by the person who entered them, at that time.
UPDATE "Expense" SET "approvedById" = "createdById", "approvedAt" = "createdAt"
WHERE "status" IN ('COMMITTED', 'PAID', 'VOID') AND "approvedAt" IS NULL;
