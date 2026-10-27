import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { tripContextFor } from "@/server/context";
import { zonedLocalToInstant, instantToZonedLocal } from "@/lib/dates";
import { confirmMilestone, createSegment, editMilestone, ingestProviderStatus, isForward, recordManualStatus, retractMilestone } from "@/server/services/journey";
import { addTripMember, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";

beforeEach(resetDb);

async function expectError(p: Promise<unknown>, code: AppError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function setup() {
  const o = await makeOrg();
  const { trip } = await makeTrip(o.org.id, { status: "IN_PROGRESS" });
  const leaderUser = await makeUser();
  await addTripMember(trip, leaderUser, "LEADER");
  const pUser = await makeUser();
  await addTripMember(trip, pUser);
  const follower = await makeUser();
  await db.tripFollower.create({ data: { orgId: o.org.id, tripId: trip.id, userId: follower.id, status: "APPROVED" } });
  return {
    ...o,
    trip,
    leaderUser,
    pUser,
    follower,
    adminT: await tripContextFor(o.ctx, trip.id),
    leader: await tripCtxFor(leaderUser, o.org.slug, trip.id),
    participant: await tripCtxFor(pUser, o.org.slug, trip.id),
  };
}

const flight = {
  kind: "FLIGHT" as const,
  leg: "OUTBOUND" as const,
  title: "Atlanta to Guatemala City",
  airline: "dl",
  flightNumber: "123",
  fromPlace: "ATL",
  toPlace: "GUA",
  departLocal: "2027-06-10T08:00",
  departTz: "America/New_York",
  arriveLocal: "2027-06-10T09:45",
  arriveTz: "America/Guatemala",
};

describe("time zones", () => {
  it("converts local times in each place to the right instant", () => {
    expect(zonedLocalToInstant("2027-06-10T08:00", "America/New_York")!.toISOString()).toBe("2027-06-10T12:00:00.000Z");
    expect(zonedLocalToInstant("2027-06-10T09:45", "America/Guatemala")!.toISOString()).toBe("2027-06-10T15:45:00.000Z");
    expect(zonedLocalToInstant("2027-01-10T08:00", "America/New_York")!.toISOString()).toBe("2027-01-10T13:00:00.000Z");
    expect(instantToZonedLocal(new Date("2027-06-10T15:45:00Z"), "America/Guatemala")).toBe("2027-06-10T09:45");
    expect(zonedLocalToInstant("2027-06-10T08:00", "Not/AZone")).toBeNull();
  });
});

describe("travel segments", () => {
  it("stores flights with time zones; participants can't plan travel", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, flight);
    expect(seg.flightNumber).toBe("DL 123");
    expect(seg.scheduledDepartAt.toISOString()).toBe("2027-06-10T12:00:00.000Z");
    expect(seg.scheduledArriveAt!.toISOString()).toBe("2027-06-10T15:45:00.000Z");
    await expectError(createSegment(s.participant, flight), "FORBIDDEN");
  });

  it("rejects arrival before departure once time zones are applied", async () => {
    const s = await setup();
    // 09:45 in Guatemala is after 08:00 in New York... but 07:30 there is before it.
    await expectError(createSegment(s.leader, { ...flight, arriveLocal: "2027-06-10T07:30" }), "INVALID");
    await expect(createSegment(s.leader, { ...flight, flightNumber: "" })).rejects.toThrow();
  });
});

describe("travel status", () => {
  it("orders statuses and refuses to go backwards", () => {
    expect(isForward("SCHEDULED", "DEPARTED")).toBe(true);
    expect(isForward("LANDED", "DEPARTED")).toBe(false);
    expect(isForward("DEPARTED", "DEPARTED")).toBe(false);
    expect(isForward("DELAYED", "DELAYED")).toBe(true);
    expect(isForward("DEPARTED", "CANCELLED")).toBe(false);
    expect(isForward("CANCELLED", "SCHEDULED")).toBe(false);
  });

  it("records manual statuses as manual and corrections with a reason", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, flight);
    await recordManualStatus(s.leader, seg.id, { status: "DEPARTED" });
    let row = await db.travelSegment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(row.status).toBe("DEPARTED");
    expect(row.statusSource).toBe("MANUAL");
    await expectError(recordManualStatus(s.leader, seg.id, { status: "DEPARTED" }), "CONFLICT");
    await expectError(recordManualStatus(s.leader, seg.id, { status: "SCHEDULED" }), "CONFLICT");
    await expectError(recordManualStatus(s.leader, seg.id, { status: "SCHEDULED", correction: true }), "INVALID");
    await recordManualStatus(s.leader, seg.id, { status: "SCHEDULED", correction: true, note: "Tapped the wrong flight" });
    row = await db.travelSegment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(row.status).toBe("SCHEDULED");
    expect(await db.travelStatusUpdate.count({ where: { segmentId: seg.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { entityId: seg.id, action: "travel.status_corrected" } })).toBe(1);
    await expectError(recordManualStatus(s.participant, seg.id, { status: "DEPARTED" }), "FORBIDDEN");
  });

  it("requires a delay length and only notifies for significant delays", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, flight);
    await expectError(recordManualStatus(s.leader, seg.id, { status: "DELAYED" }), "INVALID");
    await recordManualStatus(s.leader, seg.id, { status: "DELAYED", delayMinutes: 10 });
    expect(await db.notification.count({ where: { userId: s.follower.id } })).toBe(0);
    await recordManualStatus(s.leader, seg.id, { status: "DELAYED", delayMinutes: 75 });
    const n = await db.notification.findMany({ where: { userId: s.follower.id } });
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain("75 minutes");
    expect(n[0].body).not.toMatch(/ATL|GUA|Atlanta|Guatemala/);
  });

  it("de-duplicates and orders provider updates; notifies once", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, flight);
    const t0 = new Date("2027-06-10T12:05:00Z");
    const departed = { provider: "test", externalId: "e1", status: "DEPARTED" as const, observedAt: t0 };
    expect(await ingestProviderStatus(seg.id, s.org.id, departed)).toBe("applied");
    expect(await ingestProviderStatus(seg.id, s.org.id, departed)).toBe("duplicate");
    // A later report of the same thing under a new id: kept, but no second notification.
    expect(await ingestProviderStatus(seg.id, s.org.id, { ...departed, externalId: "e1b" })).toBe("stale");
    const landed = { provider: "test", externalId: "e3", status: "LANDED" as const, observedAt: new Date("2027-06-10T15:40:00Z") };
    expect(await ingestProviderStatus(seg.id, s.org.id, landed)).toBe("applied");
    // An older "boarding" event arriving late doesn't move the status back.
    expect(await ingestProviderStatus(seg.id, s.org.id, { provider: "test", externalId: "e0", status: "BOARDING", observedAt: new Date("2027-06-10T11:30:00Z") })).toBe("stale");
    const row = await db.travelSegment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(row.status).toBe("LANDED");
    expect(row.statusSource).toBe("PROVIDER");
    const notes = await db.notification.findMany({ where: { userId: s.follower.id }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.body)).toEqual(["The team's outbound flight has departed.", "The team's outbound flight has landed."]);
    expect(await db.emailOutbox.count({ where: { to: s.follower.email } })).toBe(2);
  });

  it("can't update another church's segment", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, flight);
    const other = await makeOrg();
    const { trip: t2 } = await makeTrip(other.org.id);
    const otherT = await tripContextFor(other.ctx, t2.id);
    await expectError(recordManualStatus(otherT, seg.id, { status: "DEPARTED" }), "NOT_FOUND");
    await expectError(ingestProviderStatus(seg.id, other.org.id, { provider: "x", externalId: "1", status: "DEPARTED", observedAt: new Date() }), "NOT_FOUND");
  });

  it("keeps unshared segments' updates from followers", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, { ...flight, shareWithFollowers: false });
    await recordManualStatus(s.leader, seg.id, { status: "DEPARTED" });
    expect(await db.notification.count({ where: { userId: s.follower.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: s.pUser.id } })).toBe(1);
  });
});

describe("arrival confirmations", () => {
  it("records who confirmed and when, marks the segment arrived, and notifies without notes or places", async () => {
    const s = await setup();
    const seg = await createSegment(s.leader, flight);
    const m = await confirmMilestone(s.leader, { kind: "LANDED", segmentId: seg.id, followerNote: "Smooth flight", teamNote: "Van at door 4, driver Luis" });
    expect(m.confirmedById).toBe(s.leaderUser.id);
    const row = await db.travelSegment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(row.status).toBe("ARRIVED");
    expect(row.statusSource).toBe("MANUAL");
    const n = await db.notification.findFirstOrThrow({ where: { userId: s.follower.id } });
    expect(n.body).toBe("The team has landed safely.");
    expect(n.body).not.toContain("door 4");
  });

  it("prevents a double confirmation from two leaders", async () => {
    const s = await setup();
    await confirmMilestone(s.leader, { kind: "ARRIVED_LODGING" });
    await expectError(confirmMilestone(s.adminT, { kind: "ARRIVED_LODGING" }), "CONFLICT");
    expect(await db.notification.count({ where: { userId: s.follower.id } })).toBe(1);
  });

  it("refuses future times and lets participants only read", async () => {
    const s = await setup();
    const now = new Date("2027-06-10T15:00:00Z");
    await expectError(confirmMilestone(s.leader, { kind: "LANDED", occurredLocal: "2027-06-10T23:00", occurredTz: "UTC" }, now), "INVALID");
    await expectError(confirmMilestone(s.participant, { kind: "LANDED" }), "FORBIDDEN");
  });

  it("can stay team-only", async () => {
    const s = await setup();
    await confirmMilestone(s.leader, { kind: "REACHED_DESTINATION", shareWithFollowers: false });
    expect(await db.notification.count({ where: { userId: s.follower.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: s.pUser.id } })).toBe(1);
  });

  it("keeps the history when a milestone is corrected or withdrawn", async () => {
    const s = await setup();
    const now = new Date("2027-06-12T18:00:00Z");
    const m = await confirmMilestone(s.leader, { kind: "ARRIVED_LODGING" }, now);
    await editMilestone(s.leader, m.id, { occurredLocal: "2027-06-12T11:30", occurredTz: "America/Guatemala", followerNote: "Settled in" }, now);
    const edited = await db.journeyMilestone.findUniqueOrThrow({ where: { id: m.id } });
    expect(edited.occurredAt.toISOString()).toBe("2027-06-12T17:30:00.000Z");
    expect(edited.editedAt).not.toBeNull();
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "journey.milestone_edited" } });
    expect((log.metadata as { before: { occurredAt: string } }).before.occurredAt).toBe(now.toISOString());
    await expectError(retractMilestone(s.leader, m.id, " "), "INVALID");
    await retractMilestone(s.leader, m.id, "Wrong trip");
    expect((await db.journeyMilestone.findUniqueOrThrow({ where: { id: m.id } })).retractedAt).not.toBeNull();
  });
});
