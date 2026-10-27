import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { followerUserIds, teamUserIds } from "./followers";
import { isValidTimeZone, zonedLocalToInstant } from "@/lib/dates";
import { Prisma, type MilestoneKind, type TravelSegment, type TravelStatus } from "@/generated/prisma/client";

// The journey: travel segments a leader sets up (flights, transfers, lodging),
// their status over time, and arrival confirmations.
//
// Every status says where it came from: MANUAL (a leader reported it) or
// PROVIDER (a flight-data service). No position, route or arrival estimate is
// ever invented; an estimate is shown only when a provider or a leader gave one.
// There is no live location tracking.

// Order of progress. DELAYED sits with SCHEDULED: it's a pre-departure state.
const RANK: Record<TravelStatus, number> = {
  SCHEDULED: 0,
  DELAYED: 0,
  CHECK_IN: 1,
  BOARDING: 2,
  DEPARTED: 3,
  LANDED: 4,
  ARRIVED: 5,
  COMPLETED: 6,
  CANCELLED: 7,
};

/** Whether moving from one status to another goes forward (or repeats, e.g. a new delay estimate). */
export function isForward(from: TravelStatus, to: TravelStatus): boolean {
  if (from === "CANCELLED") return false;
  if (to === from) return to === "DELAYED"; // a new delay estimate; any other repeat is a duplicate
  if (to === "CANCELLED") return RANK[from] < RANK.DEPARTED;
  if (to === "DELAYED") return RANK[from] <= RANK.BOARDING;
  return RANK[to] >= RANK[from];
}

const FLIGHT_STATUSES: TravelStatus[] = ["SCHEDULED", "CHECK_IN", "BOARDING", "DEPARTED", "DELAYED", "LANDED", "ARRIVED", "COMPLETED", "CANCELLED"];
const GROUND_STATUSES: TravelStatus[] = ["SCHEDULED", "DELAYED", "DEPARTED", "ARRIVED", "COMPLETED", "CANCELLED"];
export function statusesFor(kind: TravelSegment["kind"]): TravelStatus[] {
  return kind === "FLIGHT" ? FLIGHT_STATUSES : kind === "GROUND" ? GROUND_STATUSES : ["SCHEDULED", "ARRIVED", "COMPLETED", "CANCELLED"];
}

const zLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a date and time.");
const zTz = z.string().refine(isValidTimeZone, "Choose a time zone.");

export const segmentSchema = z
  .object({
    kind: z.enum(["FLIGHT", "GROUND", "LODGING"]),
    leg: z.enum(["OUTBOUND", "IN_COUNTRY", "RETURN"]),
    title: z.string().trim().min(1, "Give this a short name, e.g. \"Atlanta to Lima\".").max(120),
    airline: z.string().trim().toUpperCase().max(3).regex(/^[A-Z0-9]{0,3}$/, "Use the airline's 2-letter code, e.g. DL.").optional().default(""),
    flightNumber: z.string().trim().toUpperCase().max(8).regex(/^\d{0,4}[A-Z]?$/, "Use just the number, e.g. 123.").optional().default(""),
    fromPlace: z.string().trim().min(1, "Where does it start?").max(120),
    toPlace: z.string().trim().min(1, "Where does it end?").max(120),
    departLocal: zLocal,
    departTz: zTz,
    arriveLocal: zLocal.optional().or(z.literal("").transform(() => undefined)),
    arriveTz: zTz,
    shareWithFollowers: z.boolean().default(true),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "FLIGHT" && (!d.airline || !d.flightNumber)) ctx.addIssue({ code: "custom", path: ["flightNumber"], message: "Flights need the airline code and flight number." });
  });

function toData(d: z.output<typeof segmentSchema>) {
  const departAt = zonedLocalToInstant(d.departLocal, d.departTz);
  const arriveAt = d.arriveLocal ? zonedLocalToInstant(d.arriveLocal, d.arriveTz) : null;
  if (!departAt) throw invalid("Check the departure time.");
  if (d.arriveLocal && !arriveAt) throw invalid("Check the arrival time.");
  if (arriveAt && arriveAt <= departAt) throw invalid("Arrival must be after departure (times are in each place's own time zone).");
  if (arriveAt && arriveAt.getTime() - departAt.getTime() > 3 * 86_400_000) throw invalid("That's more than three days apart. Check the dates and time zones.");
  return {
    kind: d.kind,
    leg: d.leg,
    title: d.title,
    airline: d.kind === "FLIGHT" ? d.airline : null,
    flightNumber: d.kind === "FLIGHT" ? `${d.airline} ${d.flightNumber}` : null,
    fromPlace: d.fromPlace,
    toPlace: d.toPlace,
    departTz: d.departTz,
    arriveTz: d.arriveTz,
    scheduledDepartAt: departAt,
    scheduledArriveAt: arriveAt,
    shareWithFollowers: d.shareWithFollowers,
    notes: d.notes || null,
  };
}

export async function createSegment(t: TripContext, input: z.input<typeof segmentSchema>) {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators can plan travel.");
  const data = toData(segmentSchema.parse(input));
  const seg = await db.travelSegment.create({ data: { ...data, orgId: t.org.id, tripId: t.trip.id, createdById: t.user.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "travel.segment_created", entityType: "TravelSegment", entityId: seg.id });
  return seg;
}

async function loadSegment(t: TripContext, segmentId: string) {
  const seg = await db.travelSegment.findFirst({ where: { id: segmentId, tripId: t.trip.id, orgId: t.org.id } });
  if (!seg) throw notFound("Travel");
  return seg;
}

export async function updateSegment(t: TripContext, segmentId: string, input: z.input<typeof segmentSchema>) {
  assertPerm(t.perms.manage);
  const seg = await loadSegment(t, segmentId);
  const data = toData(segmentSchema.parse(input));
  await db.travelSegment.update({ where: { id: seg.id }, data });
  await audit({
    orgId: t.org.id,
    actorUserId: t.user.id,
    action: "travel.segment_edited",
    entityType: "TravelSegment",
    entityId: seg.id,
    metadata: { before: { title: seg.title, flightNumber: seg.flightNumber, scheduledDepartAt: seg.scheduledDepartAt.toISOString(), scheduledArriveAt: seg.scheduledArriveAt?.toISOString() ?? null } },
  });
}

export async function deleteSegment(t: TripContext, segmentId: string) {
  assertPerm(t.perms.manage);
  const seg = await loadSegment(t, segmentId);
  await db.journeyMilestone.updateMany({ where: { segmentId: seg.id, tripId: t.trip.id }, data: { segmentId: null } });
  await db.travelSegment.delete({ where: { id: seg.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "travel.segment_deleted", entityType: "TravelSegment", entityId: seg.id, metadata: { title: seg.title } });
}

// ── Status updates ──

const LEG_WORD = { OUTBOUND: "outbound", IN_COUNTRY: "in-country", RETURN: "return" } as const;
const KIND_WORD = { FLIGHT: "flight", GROUND: "transfer", LODGING: "lodging" } as const;

/** Notification text: what happened, never where the team is. */
function statusMessage(seg: TravelSegment, status: TravelStatus, delayMinutes: number | null): string | null {
  const what = `The team's ${LEG_WORD[seg.leg]} ${KIND_WORD[seg.kind]}`;
  switch (status) {
    case "DEPARTED":
      return `${what} has departed.`;
    case "LANDED":
      return `${what} has landed.`;
    case "ARRIVED":
      return `${what} has arrived, confirmed by a trip leader.`;
    case "CANCELLED":
      return `${what} was cancelled. Trip leaders are working on new arrangements.`;
    case "DELAYED":
      return delayMinutes != null && delayMinutes >= 30 ? `${what} is delayed by about ${delayMinutes} minutes.` : null;
    default:
      return null;
  }
}

async function notifyTravel(t: { orgId: string; orgSlug: string; trip: { id: string; name: string; slug: string; donorsCanFollow: boolean; storyVisibility: "PUBLIC" | "SUPPORTERS" | "TEAM" } }, seg: TravelSegment, status: TravelStatus, delayMinutes: number | null) {
  const msg = statusMessage(seg, status, delayMinutes);
  if (!msg) return;
  const team = await teamUserIds(t.trip.id);
  const outsiders = seg.shareWithFollowers ? (await followerUserIds(t.trip)).filter((id) => !team.includes(id)) : [];
  // One notification per segment and status, however many times it's reported.
  const dedupePrefix = `travel:${seg.id}:${status}`;
  await notifyUsers({ userIds: team, orgId: t.orgId, title: `${t.trip.name}: travel update`, body: msg, href: `/o/${t.orgSlug}/trips/${t.trip.id}/journey`, category: "travel", dedupePrefix });
  await notifyUsers({ userIds: outsiders, orgId: t.orgId, title: `${t.trip.name}: travel update`, body: msg, href: `/t/${t.orgSlug}/${t.trip.slug}`, category: "travel", dedupePrefix });
}

export const manualStatusSchema = z.object({
  status: z.enum(["SCHEDULED", "CHECK_IN", "BOARDING", "DEPARTED", "DELAYED", "LANDED", "ARRIVED", "COMPLETED", "CANCELLED"]),
  delayMinutes: z.coerce.number().int().min(0).max(48 * 60).optional(),
  estimatedArriveLocal: zLocal.optional().or(z.literal("").transform(() => undefined)),
  note: z.string().trim().max(500).optional().default(""),
  correction: z.boolean().default(false),
});

/** A leader reports a status they've seen (at the airport, from the airline's app). */
export async function recordManualStatus(t: TripContext, segmentId: string, input: z.input<typeof manualStatusSchema>, now = new Date()) {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators can update travel.");
  const d = manualStatusSchema.parse(input);
  const seg = await loadSegment(t, segmentId);
  if (!statusesFor(seg.kind).includes(d.status)) throw invalid("That status doesn't apply here.");
  if (d.correction) {
    if (!d.note) throw invalid("Say what you're correcting, so the history makes sense.");
  } else if (!isForward(seg.status, d.status)) {
    throw conflict(`This is already marked "${d.status === seg.status ? d.status.toLowerCase() : seg.status.toLowerCase()}". To go back, use "Correct a mistake".`);
  }
  if (d.status === "DELAYED" && d.delayMinutes == null && !d.estimatedArriveLocal) throw invalid("Add how long the delay is, or the new arrival time.");
  const eta = d.estimatedArriveLocal ? zonedLocalToInstant(d.estimatedArriveLocal, seg.arriveTz) : null;
  if (d.estimatedArriveLocal && !eta) throw invalid("Check the new arrival time.");
  const res = await db.$transaction(async (tx) => {
    // Lock the row so two leaders tapping at once can't interleave.
    await tx.$queryRaw`SELECT id FROM "TravelSegment" WHERE id = ${seg.id} FOR UPDATE`;
    const current = await tx.travelSegment.findUniqueOrThrow({ where: { id: seg.id } });
    if (!d.correction && !isForward(current.status, d.status)) throw conflict("Someone else just updated this. Refresh to see the latest.");
    const update = await tx.travelStatusUpdate.create({
      data: { orgId: t.org.id, segmentId: seg.id, status: d.status, source: "MANUAL", observedAt: now, estimatedArriveAt: eta, delayMinutes: d.delayMinutes ?? null, note: d.note || null, recordedById: t.user.id },
    });
    await tx.travelSegment.update({
      where: { id: seg.id },
      data: {
        status: d.status,
        statusSource: "MANUAL",
        statusObservedAt: now,
        ...(eta ? { estimatedArriveAt: eta, estimateSource: "MANUAL" } : {}),
        ...(d.correction && d.status === "SCHEDULED" ? { estimatedArriveAt: null, estimateSource: null } : {}),
      },
    });
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: d.correction ? "travel.status_corrected" : "travel.status_reported", entityType: "TravelSegment", entityId: seg.id, metadata: { from: current.status, to: d.status, updateId: update.id } }, tx);
    return update;
  });
  if (!d.correction) await notifyTravel({ orgId: t.org.id, orgSlug: t.org.slug, trip: t.trip }, seg, d.status, d.delayMinutes ?? null);
  return res;
}

export type ProviderStatus = {
  provider: string;
  externalId: string; // unique per provider event; repeats are ignored
  status: TravelStatus;
  observedAt: Date; // when the provider says this happened
  estimatedArriveAt?: Date | null;
  delayMinutes?: number | null;
};

/**
 * Applies an update from a flight-data provider. Duplicates are ignored and
 * out-of-order updates are kept for the record but don't move the status
 * backwards or overwrite a newer one.
 */
export async function ingestProviderStatus(segmentId: string, orgId: string, u: ProviderStatus): Promise<"applied" | "duplicate" | "stale"> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TravelSegment" WHERE id = ${segmentId} AND "orgId" = ${orgId} FOR UPDATE`;
    const seg = await tx.travelSegment.findFirst({ where: { id: segmentId, orgId } });
    if (!seg) throw notFound("Travel");
    const dup = await tx.travelStatusUpdate.findFirst({ where: { segmentId, source: "PROVIDER", externalId: u.externalId } });
    if (dup) return "duplicate";
    const newer = seg.statusObservedAt != null && u.observedAt < seg.statusObservedAt;
    const stale = newer || !isForward(seg.status, u.status);
    try {
      await tx.travelStatusUpdate.create({
        data: { orgId, segmentId, status: u.status, source: "PROVIDER", provider: u.provider, externalId: u.externalId, observedAt: u.observedAt, estimatedArriveAt: u.estimatedArriveAt ?? null, delayMinutes: u.delayMinutes ?? null, applied: !stale },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
      throw e;
    }
    if (stale) return "stale";
    await tx.travelSegment.update({
      where: { id: seg.id },
      data: {
        status: u.status,
        statusSource: "PROVIDER",
        statusObservedAt: u.observedAt,
        ...(u.estimatedArriveAt ? { estimatedArriveAt: u.estimatedArriveAt, estimateSource: "PROVIDER" } : {}),
      },
    });
    return "applied";
  }).then(async (result) => {
    if (result === "applied") {
      const seg = await db.travelSegment.findUniqueOrThrow({ where: { id: segmentId }, include: { trip: { include: { org: true } } } });
      await notifyTravel({ orgId, orgSlug: seg.trip.org.slug, trip: seg.trip }, seg, u.status, u.delayMinutes ?? null);
    }
    return result;
  });
}

export async function tripSegments(tripId: string, orgId: string) {
  return db.travelSegment.findMany({
    where: { tripId, orgId },
    orderBy: [{ scheduledDepartAt: "asc" }],
    include: { updates: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
}

// ── Arrival confirmations ──

export const MILESTONE_LABEL: Record<MilestoneKind, string> = {
  LANDED: "Landed safely",
  ARRIVED_LODGING: "Arrived at lodging",
  REACHED_DESTINATION: "Reached the destination",
  DEPARTED_FOR_RETURN: "Departed for home",
  RETURNED_HOME: "Returned home",
  OTHER: "Update",
};

const MILESTONE_MESSAGE: Record<MilestoneKind, string> = {
  LANDED: "The team has landed safely.",
  ARRIVED_LODGING: "The team has arrived at their lodging.",
  REACHED_DESTINATION: "The team has reached their destination.",
  DEPARTED_FOR_RETURN: "The team has departed for home.",
  RETURNED_HOME: "The team has returned home.",
  OTHER: "A trip leader shared a journey update.",
};

export const milestoneSchema = z.object({
  kind: z.enum(["LANDED", "ARRIVED_LODGING", "REACHED_DESTINATION", "DEPARTED_FOR_RETURN", "RETURNED_HOME", "OTHER"]),
  label: z.string().trim().max(80).optional().default(""),
  segmentId: z.string().optional().or(z.literal("").transform(() => undefined)),
  occurredLocal: zLocal.optional().or(z.literal("").transform(() => undefined)),
  occurredTz: zTz.optional().or(z.literal("").transform(() => undefined)),
  followerNote: z.string().trim().max(500).optional().default(""),
  teamNote: z.string().trim().max(1000).optional().default(""),
  shareWithFollowers: z.boolean().default(true),
  notifyFollowers: z.boolean().default(true),
});

function occurredAt(d: { occurredLocal?: string; occurredTz?: string }, fallbackTz: string, now: Date) {
  if (!d.occurredLocal) return now;
  const at = zonedLocalToInstant(d.occurredLocal, d.occurredTz ?? fallbackTz);
  if (!at) throw invalid("Check the time.");
  if (at.getTime() > now.getTime() + 5 * 60_000) throw invalid("That time is in the future. Confirm milestones once they've happened.");
  return at;
}

/** A leader confirms the team reached a point in the journey. */
export async function confirmMilestone(t: TripContext, input: z.input<typeof milestoneSchema>, now = new Date()) {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators can confirm arrivals.");
  const d = milestoneSchema.parse(input);
  if (d.kind === "OTHER" && !d.label) throw invalid("Name this milestone.");
  const at = occurredAt(d, t.org.timezone, now);
  const seg = d.segmentId ? await loadSegment(t, d.segmentId) : null;
  // Two leaders tapping "arrived" at once shouldn't produce two confirmations and two emails.
  if (d.kind !== "OTHER") {
    const recent = await db.journeyMilestone.findFirst({
      where: { tripId: t.trip.id, kind: d.kind, retractedAt: null, segmentId: seg?.id ?? null, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } },
    });
    if (recent) throw conflict(`"${MILESTONE_LABEL[d.kind]}" was already confirmed a few minutes ago.`);
  }
  const m = await db.journeyMilestone.create({
    data: {
      orgId: t.org.id,
      tripId: t.trip.id,
      kind: d.kind,
      label: d.kind === "OTHER" ? d.label : null,
      segmentId: seg?.id ?? null,
      occurredAt: at,
      confirmedById: t.user.id,
      followerNote: d.followerNote,
      teamNote: d.teamNote,
      shareWithFollowers: d.shareWithFollowers,
      notifyFollowers: d.shareWithFollowers && d.notifyFollowers,
    },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "journey.milestone_confirmed", entityType: "JourneyMilestone", entityId: m.id, metadata: { kind: d.kind } });
  // Confirming arrival for a segment marks it arrived (by a person, not a provider).
  if (seg && (d.kind === "LANDED" || d.kind === "ARRIVED_LODGING" || d.kind === "REACHED_DESTINATION" || d.kind === "RETURNED_HOME") && isForward(seg.status, "ARRIVED")) {
    await db.$transaction(async (tx) => {
      await tx.travelStatusUpdate.create({ data: { orgId: t.org.id, segmentId: seg.id, status: "ARRIVED", source: "MANUAL", observedAt: at, recordedById: t.user.id, note: "Arrival confirmed" } });
      await tx.travelSegment.update({ where: { id: seg.id }, data: { status: "ARRIVED", statusSource: "MANUAL", statusObservedAt: at } });
    });
  }
  const team = (await teamUserIds(t.trip.id)).filter((id) => id !== t.user.id);
  const body = d.kind === "OTHER" ? `${MILESTONE_MESSAGE.OTHER} ${d.label}.` : MILESTONE_MESSAGE[d.kind];
  await notifyUsers({ userIds: team, orgId: t.org.id, title: `${t.trip.name}: ${MILESTONE_LABEL[d.kind]}`, body, href: `/o/${t.org.slug}/trips/${t.trip.id}/journey`, category: "travel", dedupePrefix: `milestone:${m.id}` });
  if (m.notifyFollowers) {
    const outsiders = (await followerUserIds(t.trip)).filter((id) => !team.includes(id) && id !== t.user.id);
    await notifyUsers({ userIds: outsiders, orgId: t.org.id, title: `${t.trip.name}: ${MILESTONE_LABEL[d.kind]}`, body, href: `/t/${t.org.slug}/${t.trip.slug}`, category: "travel", dedupePrefix: `milestone:${m.id}` });
  }
  return m;
}

export const milestoneEditSchema = z.object({
  occurredLocal: zLocal,
  occurredTz: zTz,
  followerNote: z.string().trim().max(500).optional().default(""),
  teamNote: z.string().trim().max(1000).optional().default(""),
  shareWithFollowers: z.boolean().default(true),
});

/** Corrects a milestone. The previous values stay in the activity log. */
export async function editMilestone(t: TripContext, milestoneId: string, input: z.input<typeof milestoneEditSchema>, now = new Date()) {
  assertPerm(t.perms.manage);
  const m = await db.journeyMilestone.findFirst({ where: { id: milestoneId, tripId: t.trip.id, orgId: t.org.id } });
  if (!m) throw notFound("Milestone");
  if (m.retractedAt) throw conflict("This milestone was withdrawn.");
  const d = milestoneEditSchema.parse(input);
  const at = occurredAt(d, t.org.timezone, now);
  await db.journeyMilestone.update({ where: { id: m.id }, data: { occurredAt: at, followerNote: d.followerNote, teamNote: d.teamNote, shareWithFollowers: d.shareWithFollowers, editedAt: now } });
  await audit({
    orgId: t.org.id,
    actorUserId: t.user.id,
    action: "journey.milestone_edited",
    entityType: "JourneyMilestone",
    entityId: m.id,
    metadata: { before: { occurredAt: m.occurredAt.toISOString(), followerNote: m.followerNote, teamNote: m.teamNote, shareWithFollowers: m.shareWithFollowers } },
  });
}

/** Withdraws a mistaken confirmation. It stays visible to leaders, struck through. */
export async function retractMilestone(t: TripContext, milestoneId: string, reason: string) {
  assertPerm(t.perms.manage);
  const m = await db.journeyMilestone.findFirst({ where: { id: milestoneId, tripId: t.trip.id, orgId: t.org.id } });
  if (!m) throw notFound("Milestone");
  if (m.retractedAt) return;
  if (!reason.trim()) throw invalid("Say why it's being withdrawn.");
  await db.journeyMilestone.update({ where: { id: m.id }, data: { retractedAt: new Date(), retractedById: t.user.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "journey.milestone_withdrawn", entityType: "JourneyMilestone", entityId: m.id, metadata: { reason: reason.trim().slice(0, 500) } });
}

export async function tripMilestones(tripId: string, orgId: string) {
  return db.journeyMilestone.findMany({ where: { tripId, orgId }, orderBy: { occurredAt: "desc" } });
}
