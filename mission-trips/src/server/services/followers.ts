import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { tripPermissions, type FeedViewer } from "../permissions";
import type { SessionUser } from "../auth/session";
import type { Organization, Trip } from "@/generated/prisma/client";

// Followers are supporters outside the team who may see a trip's published
// stories and shared journey milestones. They're approved by a leader, or,
// when the trip allows it, qualify by having given to the trip.

export const PUBLIC_TRIP_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED"] as const;

export function tripIsPublic(trip: Pick<Trip, "status">, org: Pick<Organization, "status">) {
  return org.status === "ACTIVE" && (PUBLIC_TRIP_STATUSES as readonly string[]).includes(trip.status);
}

const RECEIVED = ["SUCCEEDED", "PARTIALLY_REFUNDED"] as const;

/** Users with a received gift to this trip (by account, or by a verified email address). */
async function donorUserIds(tripId: string): Promise<string[]> {
  const gifts = await db.donation.findMany({
    where: { tripId, status: { in: [...RECEIVED] } },
    select: { donorUserId: true, donorEmail: true },
  });
  const ids = new Set(gifts.map((g) => g.donorUserId).filter((x): x is string => !!x));
  const emails = [...new Set(gifts.map((g) => g.donorEmail?.toLowerCase()).filter((x): x is string => !!x))];
  if (emails.length) {
    const users = await db.user.findMany({ where: { email: { in: emails }, emailVerifiedAt: { not: null } }, select: { id: true } });
    for (const u of users) ids.add(u.id);
  }
  return [...ids];
}

async function isDonor(user: SessionUser, tripId: string) {
  const n = await db.donation.count({
    where: {
      tripId,
      status: { in: [...RECEIVED] },
      OR: [{ donorUserId: user.id }, ...(user.emailVerifiedAt ? [{ donorEmail: user.email }] : [])],
    },
  });
  return n > 0;
}

/** Works out how a (possibly signed-out) visitor relates to a trip's journal. */
export async function feedViewerFor(user: SessionUser | null, trip: Trip & { org: Organization }): Promise<FeedViewer> {
  if (trip.org.status === "SUSPENDED") return "NONE";
  if (user) {
    const membership = await db.membership.findUnique({ where: { orgId_userId: { orgId: trip.orgId, userId: user.id } } });
    if (membership) {
      const tm = await db.tripMember.findUnique({ where: { tripId_userId: { tripId: trip.id, userId: user.id } } });
      const perms = tripPermissions({
        orgRole: membership.role,
        tripStatus: trip.status,
        leadersSeeFinances: trip.leadersSeeFinances,
        membership: tm ? { role: tm.role, status: tm.status } : null,
      });
      if (perms.manage) return "MANAGER";
      if (perms.viewTeam) return "TEAM";
    }
  }
  if (!tripIsPublic(trip, trip.org)) return "NONE";
  if (user) {
    const f = await db.tripFollower.findUnique({ where: { tripId_userId: { tripId: trip.id, userId: user.id } } });
    if (f?.status === "APPROVED") return "FOLLOWER";
    if (f?.status !== "REVOKED" && trip.donorsCanFollow && (await isDonor(user, trip.id))) return "FOLLOWER";
  }
  return "PUBLIC";
}

/** Everyone outside the team who should hear about new stories and milestones. */
export async function followerUserIds(trip: Pick<Trip, "id" | "donorsCanFollow" | "storyVisibility">): Promise<string[]> {
  if (trip.storyVisibility === "TEAM") return [];
  const rows = await db.tripFollower.findMany({ where: { tripId: trip.id }, select: { userId: true, status: true } });
  const approved = rows.filter((r) => r.status === "APPROVED").map((r) => r.userId);
  const revoked = new Set(rows.filter((r) => r.status === "REVOKED").map((r) => r.userId));
  const donors = trip.donorsCanFollow ? (await donorUserIds(trip.id)).filter((id) => !revoked.has(id)) : [];
  return [...new Set([...approved, ...donors])];
}

export async function teamUserIds(tripId: string): Promise<string[]> {
  const team = await db.tripMember.findMany({ where: { tripId, status: "APPROVED" }, select: { userId: true } });
  return team.map((m) => m.userId);
}

/** A signed-in supporter asks to follow a trip. Leaders decide. */
export async function requestToFollow(user: SessionUser, tripId: string) {
  const trip = await db.trip.findUnique({ where: { id: tripId }, include: { org: true } });
  if (!trip || !tripIsPublic(trip, trip.org) || trip.storyVisibility === "TEAM") throw notFound("Trip");
  const viewer = await feedViewerFor(user, trip);
  if (viewer !== "PUBLIC") return { status: viewer === "FOLLOWER" ? "APPROVED" : "TEAM" } as const;
  const existing = await db.tripFollower.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
  // A revoked follower can't re-request; that would undo a leader's decision.
  if (existing) return { status: existing.status } as const;
  await db.tripFollower.create({ data: { orgId: trip.orgId, tripId, userId: user.id, status: "REQUESTED" } });
  await audit({ orgId: trip.orgId, actorUserId: user.id, action: "follower.requested", entityType: "Trip", entityId: trip.id });
  const managers = await db.tripMember.findMany({ where: { tripId, status: "APPROVED", role: "LEADER" }, select: { userId: true } });
  const admins = await db.membership.findMany({ where: { orgId: trip.orgId, role: "ADMIN" }, select: { userId: true } });
  await notifyUsers({
    userIds: [...managers, ...admins].map((m) => m.userId),
    orgId: trip.orgId,
    title: `${trip.name}: someone asked to follow`,
    body: `${user.name} asked to follow ${trip.name}'s stories and journey. Approve or decline in the trip's settings.`,
    href: `/o/${trip.org.slug}/trips/${trip.id}/settings#followers`,
    category: "stories",
    dedupePrefix: `follow-request:${trip.id}:${user.id}`,
  });
  return { status: "REQUESTED" } as const;
}

export async function decideFollower(t: TripContext, followerId: string, decision: "APPROVED" | "REVOKED") {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators can manage followers.");
  const f = await db.tripFollower.findFirst({ where: { id: followerId, tripId: t.trip.id, orgId: t.org.id } });
  if (!f) throw notFound("Follower");
  if (f.status === decision) return f;
  const updated = await db.tripFollower.update({ where: { id: f.id }, data: { status: decision, decidedAt: new Date(), decidedById: t.user.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: decision === "APPROVED" ? "follower.approved" : "follower.revoked", entityType: "TripFollower", entityId: f.id, metadata: { userId: f.userId } });
  if (decision === "APPROVED") {
    await notifyUsers({
      userIds: [f.userId],
      orgId: t.org.id,
      title: `You're following ${t.trip.name}`,
      body: `You'll see the team's stories and journey on the trip page.`,
      href: `/t/${t.org.slug}/${t.trip.slug}`,
      category: "stories",
      dedupePrefix: `follow-approved:${f.id}`,
    });
  }
  return updated;
}

/** Revokes a donor's automatic access (they have no follower row yet). */
export async function revokeUser(t: TripContext, userId: string) {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators can manage followers.");
  const row = await db.tripFollower.upsert({
    where: { tripId_userId: { tripId: t.trip.id, userId } },
    create: { orgId: t.org.id, tripId: t.trip.id, userId, status: "REVOKED", decidedAt: new Date(), decidedById: t.user.id },
    update: { status: "REVOKED", decidedAt: new Date(), decidedById: t.user.id },
  });
  if (row.orgId !== t.org.id) throw invalid("That person isn't connected to this trip.");
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "follower.revoked", entityType: "TripFollower", entityId: row.id, metadata: { userId } });
}

/** Followers list for leaders: explicit rows plus donors who qualify automatically. */
export async function tripFollowers(t: TripContext) {
  assertPerm(t.perms.manage);
  const rows = await db.tripFollower.findMany({
    where: { tripId: t.trip.id, orgId: t.org.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const explicit = new Set(rows.map((r) => r.userId));
  const donorIds = t.trip.donorsCanFollow ? (await donorUserIds(t.trip.id)).filter((id) => !explicit.has(id)) : [];
  const donors = donorIds.length ? await db.user.findMany({ where: { id: { in: donorIds } }, select: { id: true, name: true, email: true } }) : [];
  return { rows, donors };
}
