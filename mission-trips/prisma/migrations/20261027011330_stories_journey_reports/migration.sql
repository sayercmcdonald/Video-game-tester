-- CreateEnum
CREATE TYPE "StoryVisibility" AS ENUM ('PUBLIC', 'SUPPORTERS', 'TEAM');

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'RETURNED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StoryAudience" AS ENUM ('TEAM', 'FOLLOWERS');

-- CreateEnum
CREATE TYPE "StoryCategory" AS ENUM ('SERVICE', 'WORSHIP', 'COMMUNITY', 'TEAM', 'TRAVEL', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "FollowerStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('FLIGHT', 'GROUND', 'LODGING');

-- CreateEnum
CREATE TYPE "SegmentLeg" AS ENUM ('OUTBOUND', 'IN_COUNTRY', 'RETURN');

-- CreateEnum
CREATE TYPE "TravelStatus" AS ENUM ('SCHEDULED', 'CHECK_IN', 'BOARDING', 'DEPARTED', 'DELAYED', 'LANDED', 'ARRIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StatusSource" AS ENUM ('MANUAL', 'PROVIDER');

-- CreateEnum
CREATE TYPE "MilestoneKind" AS ENUM ('LANDED', 'ARRIVED_LODGING', 'REACHED_DESTINATION', 'DEPARTED_FOR_RETURN', 'RETURNED_HOME', 'OTHER');

-- CreateEnum
CREATE TYPE "MissionReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED');

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "emailReports" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailStories" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailTravel" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "donorsCanFollow" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "storiesRequireApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "storyVisibility" "StoryVisibility" NOT NULL DEFAULT 'SUPPORTERS';

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "postedAsTeam" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL DEFAULT '',
    "category" "StoryCategory",
    "audience" "StoryAudience" NOT NULL DEFAULT 'FOLLOWERS',
    "status" "StoryStatus" NOT NULL DEFAULT 'DRAFT',
    "showsVulnerablePeople" BOOLEAN NOT NULL DEFAULT false,
    "consentConfirmedById" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryMedia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT NOT NULL DEFAULT '',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripFollower" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "FollowerStatus" NOT NULL DEFAULT 'REQUESTED',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripFollower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelSegment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" "SegmentKind" NOT NULL,
    "leg" "SegmentLeg" NOT NULL DEFAULT 'OUTBOUND',
    "title" TEXT NOT NULL,
    "airline" TEXT,
    "flightNumber" TEXT,
    "fromPlace" TEXT NOT NULL,
    "toPlace" TEXT NOT NULL,
    "departTz" TEXT NOT NULL,
    "arriveTz" TEXT NOT NULL,
    "scheduledDepartAt" TIMESTAMP(3) NOT NULL,
    "scheduledArriveAt" TIMESTAMP(3),
    "status" "TravelStatus" NOT NULL DEFAULT 'SCHEDULED',
    "statusSource" "StatusSource",
    "statusObservedAt" TIMESTAMP(3),
    "estimatedArriveAt" TIMESTAMP(3),
    "estimateSource" "StatusSource",
    "shareWithFollowers" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelStatusUpdate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "status" "TravelStatus" NOT NULL,
    "source" "StatusSource" NOT NULL,
    "provider" TEXT,
    "externalId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "estimatedArriveAt" TIMESTAMP(3),
    "delayMinutes" INTEGER,
    "note" TEXT,
    "recordedById" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelStatusUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyMilestone" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" "MilestoneKind" NOT NULL,
    "label" TEXT,
    "segmentId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "followerNote" TEXT NOT NULL DEFAULT '',
    "teamNote" TEXT NOT NULL DEFAULT '',
    "shareWithFollowers" BOOLEAN NOT NULL DEFAULT true,
    "notifyFollowers" BOOLEAN NOT NULL DEFAULT true,
    "editedAt" TIMESTAMP(3),
    "retractedAt" TIMESTAMP(3),
    "retractedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "status" "MissionReportStatus" NOT NULL DEFAULT 'DRAFT',
    "overview" TEXT NOT NULL DEFAULT '',
    "teamSummary" TEXT NOT NULL DEFAULT '',
    "closing" TEXT NOT NULL DEFAULT '',
    "fundsDisposition" TEXT NOT NULL DEFAULT '',
    "storyIds" TEXT[],
    "financials" JSONB,
    "preparedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Story_tripId_status_publishedAt_idx" ON "Story"("tripId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "Story_authorId_idx" ON "Story"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Story_id_orgId_key" ON "Story"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryMedia_storageKey_key" ON "StoryMedia"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "StoryMedia_thumbKey_key" ON "StoryMedia"("thumbKey");

-- CreateIndex
CREATE INDEX "StoryMedia_storyId_position_idx" ON "StoryMedia"("storyId", "position");

-- CreateIndex
CREATE INDEX "TripFollower_userId_idx" ON "TripFollower"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TripFollower_tripId_userId_key" ON "TripFollower"("tripId", "userId");

-- CreateIndex
CREATE INDEX "TravelSegment_tripId_scheduledDepartAt_idx" ON "TravelSegment"("tripId", "scheduledDepartAt");

-- CreateIndex
CREATE UNIQUE INDEX "TravelSegment_id_orgId_key" ON "TravelSegment"("id", "orgId");

-- CreateIndex
CREATE INDEX "TravelStatusUpdate_segmentId_observedAt_idx" ON "TravelStatusUpdate"("segmentId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TravelStatusUpdate_segmentId_source_externalId_key" ON "TravelStatusUpdate"("segmentId", "source", "externalId");

-- CreateIndex
CREATE INDEX "JourneyMilestone_tripId_occurredAt_idx" ON "JourneyMilestone"("tripId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MissionReport_tripId_key" ON "MissionReport"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionReport_tripId_orgId_key" ON "MissionReport"("tripId", "orgId");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_tripId_orgId_fkey" FOREIGN KEY ("tripId", "orgId") REFERENCES "Trip"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryMedia" ADD CONSTRAINT "StoryMedia_storyId_orgId_fkey" FOREIGN KEY ("storyId", "orgId") REFERENCES "Story"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripFollower" ADD CONSTRAINT "TripFollower_tripId_orgId_fkey" FOREIGN KEY ("tripId", "orgId") REFERENCES "Trip"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripFollower" ADD CONSTRAINT "TripFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelSegment" ADD CONSTRAINT "TravelSegment_tripId_orgId_fkey" FOREIGN KEY ("tripId", "orgId") REFERENCES "Trip"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelStatusUpdate" ADD CONSTRAINT "TravelStatusUpdate_segmentId_orgId_fkey" FOREIGN KEY ("segmentId", "orgId") REFERENCES "TravelSegment"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyMilestone" ADD CONSTRAINT "JourneyMilestone_tripId_orgId_fkey" FOREIGN KEY ("tripId", "orgId") REFERENCES "Trip"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionReport" ADD CONSTRAINT "MissionReport_tripId_orgId_fkey" FOREIGN KEY ("tripId", "orgId") REFERENCES "Trip"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

