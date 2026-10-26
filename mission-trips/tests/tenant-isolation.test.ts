import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { tripContextFor } from "@/server/context";
import { createInvitation, acceptInvitation, setMemberRole, removeMember } from "@/server/services/orgs";
import { decideApplication, updateTrip, applyToTrip, addLeader } from "@/server/services/trips";
import { addTripMember, ctxFor, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";

beforeEach(resetDb);

async function expectCode(p: Promise<unknown>, code: AppError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe("tenant isolation", () => {
  it("a church admin cannot load another church's trip by ID", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { trip: bTrip } = await makeTrip(b.org.id);
    await expectCode(tripContextFor(a.ctx, bTrip.id), "NOT_FOUND");
  });

  it("a user cannot open a church they don't belong to", async () => {
    const a = await makeOrg();
    const outsider = await makeUser();
    await expectCode(ctxFor(outsider, a.org.slug), "NOT_FOUND");
  });

  it("an admin cannot decide applications on another church's trip member", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { trip: aTrip } = await makeTrip(a.org.id);
    const { trip: bTrip } = await makeTrip(b.org.id);
    const applicant = await makeUser();
    const bMember = await addTripMember(bTrip, applicant, "PARTICIPANT", "APPLIED");
    const aTripCtx = await tripContextFor(a.ctx, aTrip.id);
    await expectCode(decideApplication(aTripCtx, bMember.id, "APPROVED"), "NOT_FOUND");
    expect((await db.tripMember.findUniqueOrThrow({ where: { id: bMember.id } })).status).toBe("APPLIED");
  });

  it("an admin cannot change roles of another church's members", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const bAdminMembership = await db.membership.findFirstOrThrow({ where: { orgId: b.org.id } });
    await expectCode(setMemberRole(a.ctx, bAdminMembership.id, "MEMBER"), "NOT_FOUND");
    await expectCode(removeMember(a.ctx, bAdminMembership.id), "NOT_FOUND");
  });

  it("the database refuses to link a record to another church's trip", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { trip: bTrip } = await makeTrip(b.org.id);
    // A campaign claiming org A but pointing at org B's trip violates the composite foreign key.
    await expect(
      db.campaign.create({ data: { orgId: a.org.id, tripId: bTrip.id, kind: "PROJECT", slug: "sneaky", title: "x" } }),
    ).rejects.toThrow();
  });

  it("an admin cannot invite people to another church's trip", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { trip: bTrip } = await makeTrip(b.org.id);
    await expectCode(createInvitation(a.ctx, { email: "x@example.test", tripId: bTrip.id, tripRole: "PARTICIPANT" }), "NOT_FOUND");
  });
});

describe("roles within a church", () => {
  it("participants cannot manage the trip", async () => {
    const { org } = await makeOrg();
    const { trip } = await makeTrip(org.id);
    const p = await makeUser();
    await addTripMember(trip, p);
    const t = await tripCtxFor(p, org.slug, trip.id);
    await expectCode(
      updateTrip(t, { name: "Hacked", destination: "x", startDate: "2027-01-01", endDate: "2027-01-02", budget: "0", fundraisingGoal: "0", defaultParticipantGoal: "0" }),
      "FORBIDDEN",
    );
  });

  it("leaders can approve participants but cannot add leaders or invite admins", async () => {
    const { org } = await makeOrg();
    const { trip } = await makeTrip(org.id);
    const leader = await makeUser();
    await addTripMember(trip, leader, "LEADER");
    const applicant = await makeUser();
    const tm = await addTripMember(trip, applicant, "PARTICIPANT", "APPLIED");
    const t = await tripCtxFor(leader, org.slug, trip.id);

    await decideApplication(t, tm.id, "APPROVED");
    const campaign = await db.campaign.findFirst({ where: { tripMemberId: tm.id } });
    expect(campaign?.kind).toBe("PARTICIPANT");

    const someone = await makeUser();
    await db.membership.create({ data: { orgId: org.id, userId: someone.id } });
    await expectCode(addLeader(t, someone.id), "FORBIDDEN");
    await expectCode(createInvitation(t, { email: "z@example.test", tripId: trip.id, tripRole: "LEADER" }), "FORBIDDEN");
    await expectCode(createInvitation(t, { email: "z@example.test", orgRole: "ADMIN" }), "FORBIDDEN");
  });

  it("enforces the participant limit", async () => {
    const { org, ctx } = await makeOrg();
    const { trip } = await makeTrip(org.id, { participantLimit: 1 });
    await addTripMember(trip, await makeUser());
    const tm = await addTripMember(trip, await makeUser(), "PARTICIPANT", "APPLIED");
    const t = await tripContextFor(ctx, trip.id);
    await expectCode(decideApplication(t, tm.id, "APPROVED"), "INVALID");
    await decideApplication(t, tm.id, "WAITLISTED");
  });

  it("keeps at least one church admin", async () => {
    const { org, ctx } = await makeOrg();
    const m = await db.membership.findFirstOrThrow({ where: { orgId: org.id } });
    await expectCode(setMemberRole(ctx, m.id, "MEMBER"), "INVALID");
  });
});

describe("invitations and applications", () => {
  it("invitation works only for the invited email and only once", async () => {
    const { org, ctx } = await makeOrg();
    const { trip } = await makeTrip(org.id);
    const { token } = await createInvitation(ctx, { email: "Invitee@Example.test", tripId: trip.id, tripRole: "PARTICIPANT" });

    const wrong = await makeUser({ email: "someone-else@example.test" });
    await expectCode(acceptInvitation(wrong, token), "FORBIDDEN");

    const right = await makeUser({ email: "invitee@example.test", verified: false });
    expect(await acceptInvitation(right, token)).toBe(org.slug);
    const tm = await db.tripMember.findUniqueOrThrow({ where: { tripId_userId: { tripId: trip.id, userId: right.id } } });
    expect(tm.status).toBe("APPROVED");
    expect(await db.campaign.count({ where: { tripMemberId: tm.id } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: right.id } })).emailVerifiedAt).not.toBeNull();

    await expectCode(acceptInvitation(right, token), "INVALID");
  });

  it("applying requires an open trip with applications open, and is not duplicated", async () => {
    const { org } = await makeOrg();
    const { trip: closed } = await makeTrip(org.id, { applicationsOpen: false });
    const { trip: draft } = await makeTrip(org.id, { status: "DRAFT" });
    const { trip: open } = await makeTrip(org.id);
    const u = await makeUser();
    await expectCode(applyToTrip(u, org.slug, closed.id), "NOT_FOUND");
    await expectCode(applyToTrip(u, org.slug, draft.id), "NOT_FOUND");
    await applyToTrip(u, org.slug, open.id, "I'd love to serve.");
    await expectCode(applyToTrip(u, org.slug, open.id), "CONFLICT");
    // Wrong church slug for a real trip ID
    const other = await makeOrg();
    const u2 = await makeUser();
    await expectCode(applyToTrip(u2, other.org.slug, open.id), "NOT_FOUND");
  });
});
