import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type OrgContext, type TripContext } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import type { SessionUser } from "../auth/session";
import { zCheckbox, zDate, zMoney, zName, zOptionalText, zSlug, slugify } from "@/lib/validation";
import { Prisma, type TripStatus } from "@/generated/prisma/client";
import { createTripFundCampaign, ensureParticipantCampaign } from "./campaigns";

const tripFields = {
  name: zName("Trip name", 150),
  destination: zName("Destination", 150),
  summary: zOptionalText(5000),
  startDate: zDate("Start date"),
  endDate: zDate("End date"),
  budget: zMoney("Total budget"),
  fundraisingGoal: zMoney("Team fundraising goal"),
  defaultParticipantGoal: zMoney("Per-participant goal"),
  participantLimit: z.coerce.number().int().min(1, "Must be at least 1.").max(1000).optional(),
  applicationsOpen: zCheckbox,
};

export const createTripSchema = z
  .object({ ...tripFields, slug: zSlug.optional() })
  .refine((d) => d.endDate >= d.startDate, { message: "End date must be on or after the start date.", path: ["endDate"] });

export async function createTrip(ctx: OrgContext, input: z.input<typeof createTripSchema>) {
  assertPerm(ctx.isAdmin, "Only church administrators can create trips.");
  const d = createTripSchema.parse(input);
  const slug = d.slug ?? (slugify(`${d.name}-${d.startDate.getUTCFullYear()}`) || "trip");
  try {
    return await db.$transaction(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          orgId: ctx.org.id,
          name: d.name,
          slug,
          destination: d.destination,
          summary: d.summary ?? "",
          startDate: d.startDate,
          endDate: d.endDate,
          budgetCents: d.budget,
          fundraisingGoalCents: d.fundraisingGoal,
          defaultParticipantGoalCents: d.defaultParticipantGoal,
          participantLimit: d.participantLimit ?? null,
          applicationsOpen: d.applicationsOpen,
          status: "DRAFT",
        },
      });
      await createTripFundCampaign(tx, trip);
      await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "trip.created", entityType: "Trip", entityId: trip.id }, tx);
      return trip;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("Another trip already uses that web address. Change the trip name or address.");
    }
    throw e;
  }
}

export const updateTripSchema = z
  .object({ ...tripFields, leadersSeeFinances: zCheckbox, showLiveFinancials: zCheckbox })
  .refine((d) => d.endDate >= d.startDate, { message: "End date must be on or after the start date.", path: ["endDate"] });

export async function updateTrip(t: TripContext, input: z.input<typeof updateTripSchema>) {
  assertPerm(t.perms.manage);
  const d = updateTripSchema.parse(input);
  const trip = await db.trip.update({
    where: { id: t.trip.id },
    data: {
      name: d.name,
      destination: d.destination,
      summary: d.summary ?? "",
      startDate: d.startDate,
      endDate: d.endDate,
      budgetCents: d.budget,
      fundraisingGoalCents: d.fundraisingGoal,
      defaultParticipantGoalCents: d.defaultParticipantGoal,
      participantLimit: d.participantLimit ?? null,
      applicationsOpen: d.applicationsOpen,
      // Only church admins decide whether leaders see finances.
      ...(t.perms.isOrgAdmin ? { leadersSeeFinances: d.leadersSeeFinances, showLiveFinancials: d.showLiveFinancials } : {}),
    },
  });
  await db.campaign.updateMany({ where: { tripId: trip.id, kind: "TRIP" }, data: { goalCents: d.fundraisingGoal } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "trip.updated", entityType: "Trip", entityId: trip.id });
  return trip;
}

const STATUS_FLOW: Record<TripStatus, TripStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "CANCELLED", "DRAFT"],
  IN_PROGRESS: ["COMPLETED", "OPEN"],
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: ["DRAFT"],
};

export function allowedStatusChanges(from: TripStatus): TripStatus[] {
  return STATUS_FLOW[from];
}

export async function setTripStatus(t: TripContext, status: TripStatus) {
  assertPerm(t.perms.isOrgAdmin, "Only church administrators can change a trip's status.");
  if (!STATUS_FLOW[t.trip.status].includes(status)) {
    throw invalid(`A ${t.trip.status.toLowerCase()} trip can't move to ${status.toLowerCase()}.`);
  }
  await db.trip.update({ where: { id: t.trip.id }, data: { status } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "trip.status_changed", entityType: "Trip", entityId: t.trip.id, metadata: { from: t.trip.status, to: status } });
}

// ── Applications & membership ──

/** Anyone with an account can apply to an open trip; they join the church as a member. */
export async function applyToTrip(user: SessionUser, orgSlug: string, tripId: string, note?: string) {
  const trip = await db.trip.findFirst({
    where: { id: tripId, org: { slug: orgSlug, status: { not: "SUSPENDED" } }, status: "OPEN", applicationsOpen: true },
  });
  if (!trip) throw notFound("Trip");
  const cleanNote = z.string().trim().max(2000).optional().parse(note || undefined);
  const result = await db.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { orgId_userId: { orgId: trip.orgId, userId: user.id } },
      create: { orgId: trip.orgId, userId: user.id, role: "MEMBER" },
      update: {},
    });
    const existing = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
    if (existing && existing.status !== "WITHDRAWN") throw conflict("You've already applied to this trip.");
    const tm = existing
      ? await tx.tripMember.update({ where: { id: existing.id }, data: { status: "APPLIED", role: "PARTICIPANT", applicationNote: cleanNote ?? null } })
      : await tx.tripMember.create({
          data: { orgId: trip.orgId, tripId, userId: user.id, role: "PARTICIPANT", status: "APPLIED", applicationNote: cleanNote ?? null },
        });
    await audit({ orgId: trip.orgId, actorUserId: user.id, action: "trip.applied", entityType: "TripMember", entityId: tm.id }, tx);
    return tm;
  });
  const managers = await tripManagerUserIds(trip.id, trip.orgId);
  await notifyUsers({
    userIds: managers,
    orgId: trip.orgId,
    title: `New application for ${trip.name}`,
    body: `${user.name} applied to join ${trip.name}.`,
    href: `/o/${orgSlug}/trips/${trip.id}/team`,
    category: "account",
  });
  return result;
}

export async function decideApplication(t: TripContext, tripMemberId: string, decision: "APPROVED" | "WAITLISTED" | "DECLINED") {
  assertPerm(t.perms.manage);
  const tm = await db.$transaction(async (tx) => {
    const member = await tx.tripMember.findFirst({ where: { id: tripMemberId, tripId: t.trip.id, orgId: t.org.id } });
    if (!member) throw notFound("Participant");
    if (member.role === "LEADER") throw invalid("Use the leader controls to change a leader.");
    if (decision === "APPROVED" && member.status !== "APPROVED" && t.trip.participantLimit != null) {
      const approved = await tx.tripMember.count({ where: { tripId: t.trip.id, role: "PARTICIPANT", status: "APPROVED" } });
      if (approved >= t.trip.participantLimit) {
        throw invalid(`This trip is full (${t.trip.participantLimit} participants). Waitlist them or raise the limit.`);
      }
    }
    const updated = await tx.tripMember.update({
      where: { id: member.id },
      data: { status: decision, decidedAt: new Date(), decidedById: t.user.id },
    });
    if (decision === "APPROVED") await ensureParticipantCampaign(tx, member.id);
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "trip.application_decided", entityType: "TripMember", entityId: member.id, metadata: { decision } }, tx);
    return updated;
  });
  const message =
    decision === "APPROVED"
      ? `You've been approved for ${t.trip.name}. Your dashboard now shows your fundraising page, requirements and trip details.`
      : decision === "WAITLISTED"
        ? `You've been placed on the waitlist for ${t.trip.name}. A leader will reach out if a spot opens.`
        : `Your application for ${t.trip.name} was not approved this time. Please contact your trip leader with any questions.`;
  await notifyUsers({
    userIds: [tm.userId],
    orgId: t.org.id,
    title: `Update on your ${t.trip.name} application`,
    body: message,
    href: `/o/${t.org.slug}/trips/${t.trip.id}`,
    category: "account",
  });
  return tm;
}

/** Church admins add an existing church member as a trip leader. */
export async function addLeader(t: TripContext, userId: string) {
  assertPerm(t.perms.isOrgAdmin, "Only church administrators can assign trip leaders.");
  const membership = await db.membership.findUnique({ where: { orgId_userId: { orgId: t.org.id, userId } } });
  if (!membership) throw notFound("Member");
  const tm = await db.tripMember.upsert({
    where: { tripId_userId: { tripId: t.trip.id, userId } },
    create: { orgId: t.org.id, tripId: t.trip.id, userId, role: "LEADER", status: "APPROVED", decidedAt: new Date(), decidedById: t.user.id },
    update: { role: "LEADER", status: "APPROVED", decidedAt: new Date(), decidedById: t.user.id },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "trip.leader_added", entityType: "TripMember", entityId: tm.id });
  return tm;
}

export async function removeFromTrip(t: TripContext, tripMemberId: string) {
  const member = await db.tripMember.findFirst({ where: { id: tripMemberId, tripId: t.trip.id, orgId: t.org.id } });
  if (!member) throw notFound("Team member");
  const self = member.userId === t.user.id;
  // Leaders can be removed only by church admins; anyone can withdraw themselves.
  assertPerm(self || (member.role === "LEADER" ? t.perms.isOrgAdmin : t.perms.manage));
  await db.tripMember.update({ where: { id: member.id }, data: { status: "WITHDRAWN" } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "trip.member_withdrawn", entityType: "TripMember", entityId: member.id });
}

export async function tripManagerUserIds(tripId: string, orgId: string): Promise<string[]> {
  const [leaders, admins] = await Promise.all([
    db.tripMember.findMany({ where: { tripId, role: "LEADER", status: "APPROVED" }, select: { userId: true } }),
    db.membership.findMany({ where: { orgId, role: "ADMIN" }, select: { userId: true } }),
  ]);
  return [...new Set([...leaders, ...admins].map((r) => r.userId))];
}

// ── Itinerary ──

export const itinerarySchema = z.object({
  kind: z.enum(["TRAVEL", "LODGING", "ACTIVITY", "MEETING", "OTHER"]),
  title: zName("Title", 200),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time."),
  endsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  location: zOptionalText(300),
  notes: zOptionalText(3000),
});

/** Itinerary times are "local trip time" and stored as-is (as UTC wall-clock) to avoid timezone surprises. */
function wallClock(v: string): Date {
  return new Date(`${v}:00.000Z`);
}

export async function addItineraryItem(t: TripContext, input: z.input<typeof itinerarySchema>) {
  assertPerm(t.perms.manage);
  const d = itinerarySchema.parse(input);
  const startsAt = wallClock(d.startsAt);
  const endsAt = d.endsAt ? wallClock(d.endsAt) : null;
  if (endsAt && endsAt < startsAt) throw invalid("The end time must be after the start time.");
  return db.itineraryItem.create({
    data: { orgId: t.org.id, tripId: t.trip.id, kind: d.kind, title: d.title, startsAt, endsAt, location: d.location ?? null, notes: d.notes ?? null },
  });
}

export async function deleteItineraryItem(t: TripContext, itemId: string) {
  assertPerm(t.perms.manage);
  const res = await db.itineraryItem.deleteMany({ where: { id: itemId, tripId: t.trip.id, orgId: t.org.id } });
  if (res.count === 0) throw notFound("Itinerary item");
}
