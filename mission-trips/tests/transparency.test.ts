import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { tripContextFor } from "@/server/context";
import { composeReportDraft, publicTripFinancials, reportFacts, type ReportFacts } from "@/server/services/transparency";
import { recordOfflineDonation } from "@/server/services/donations";
import { createExpense, createPledge } from "@/server/services/finance";
import { addTripMember, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";

beforeEach(resetDb);

const facts: ReportFacts = {
  tripName: "Honduras Build",
  destination: "La Ceiba, Honduras",
  startDate: new Date("2027-07-01T00:00:00Z"),
  endDate: new Date("2027-07-10T00:00:00Z"),
  completed: true,
  participants: 8,
  leaders: 2,
  giftCount: 42,
  givenCents: 1_850_000,
  refundsCents: 5_000,
  feesCents: 41_200,
  spentCents: 1_420_000,
  committedCents: 0,
  remainingCents: 388_800,
  spending: [
    { category: "TRAVEL", paidCents: 900_000 },
    { category: "LODGING", paidCents: 320_000 },
    { category: "PROJECT_MATERIALS", paidCents: 200_000 },
    { category: "FOOD", paidCents: 0 },
  ],
  publicUpdates: 3,
  asOf: new Date("2027-07-20T00:00:00Z"),
  currency: "usd",
};

describe("report drafts", () => {
  it("states only the recorded figures, largest spending first", () => {
    const d = composeReportDraft(facts);
    expect(d.title).toBe("Final report: Honduras Build");
    expect(d.narrative).toContain("A team of 10 people served in La Ceiba, Honduras");
    expect(d.narrative).toContain("42 gifts have been received, totaling $18,500.00 after $50.00 in refunds");
    expect(d.narrative).toContain("Payment processing fees came to $412.00");
    expect(d.narrative).toContain("So far $14,200.00 has been spent: airfare & travel $9,000.00, lodging $3,200.00, project materials $2,000.00.");
    expect(d.narrative).not.toContain("food");
    expect(d.narrative).toContain("$3,888.00 remains available.");
    expect(d.narrative).toContain("Individual gifts are not matched to specific expenses.");
  });

  it("is honest about shortfalls and about having nothing yet", () => {
    const short = composeReportDraft({ ...facts, completed: false, remainingCents: 10_000, committedCents: 60_000 });
    expect(short.title).toBe("Update: Honduras Build");
    expect(short.narrative).toContain("is preparing to serve");
    expect(short.narrative).toContain("Committed costs currently exceed the funds received by $500.00.");
    const empty = composeReportDraft({ ...facts, giftCount: 0, givenCents: 0, spentCents: 0, spending: [], remainingCents: 0 });
    expect(empty.narrative).toContain("no gifts have been recorded yet");
    expect(empty.narrative).toContain("No expenses have been paid yet.");
  });
});

describe("live public financials", () => {
  it("shows nothing until the church opts in, then aggregates only approved, received money", async () => {
    const o = await makeOrg();
    const { trip, fund } = await makeTrip(o.org.id);
    const admin = await tripContextFor(o.ctx, trip.id);
    await recordOfflineDonation(admin, { campaignId: fund.id, amount: "1000", donorName: "Very Private Donor", donorEmail: "private@example.test", method: "CHECK", receivedOn: "2027-01-01" });
    await createPledge(admin, { campaignId: fund.id, donorName: "Pledger Person", amount: "700" });
    await createExpense(admin, { category: "TRAVEL", description: "Flights", amount: "400", status: "PAID", incurredOn: "2027-01-02", paidOn: "2027-01-02" });
    const leader = await makeUser();
    await addTripMember(trip, leader, "LEADER");
    await createExpense(await tripCtxFor(leader, o.org.slug, trip.id), { category: "FOOD", description: "Unapproved", amount: "999", status: "PAID", incurredOn: "2027-01-02", paidOn: "2027-01-02" });

    expect(await publicTripFinancials(trip.id)).toBeNull();
    await db.trip.update({ where: { id: trip.id }, data: { showLiveFinancials: true } });
    const live = (await publicTripFinancials(trip.id))!;
    expect(live).toMatchObject({ giftCount: 1, givenCents: 100000, spentCents: 40000, remainingCents: 60000 });
    // Pending (unapproved) expense and pledge are not counted
    expect(live.spendingByCategory.find((c) => c.category === "FOOD")).toBeUndefined();
    const json = JSON.stringify(live);
    for (const secret of ["Very Private Donor", "private@example.test", "Pledger Person", "Flights", "Unapproved"]) expect(json).not.toContain(secret);

    // A suspended church's figures disappear
    await db.organization.update({ where: { id: o.org.id }, data: { status: "SUSPENDED" } });
    expect(await publicTripFinancials(trip.id)).toBeNull();
  });

  it("only administrators can turn live figures on", async () => {
    const o = await makeOrg();
    const { trip } = await makeTrip(o.org.id);
    const leader = await makeUser();
    await addTripMember(trip, leader, "LEADER");
    const { updateTrip } = await import("@/server/services/trips");
    const form = { name: trip.name, destination: trip.destination, startDate: "2027-06-10", endDate: "2027-06-20", budget: "0", fundraisingGoal: "0", defaultParticipantGoal: "0", showLiveFinancials: "on" };
    await updateTrip(await tripCtxFor(leader, o.org.slug, trip.id), form);
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).showLiveFinancials).toBe(false);
    await updateTrip(await tripContextFor(o.ctx, trip.id), form);
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).showLiveFinancials).toBe(true);
  });

  it("builds report facts from the trip's records", async () => {
    const o = await makeOrg();
    const { trip, fund } = await makeTrip(o.org.id);
    const admin = await tripContextFor(o.ctx, trip.id);
    await addTripMember(trip, await makeUser());
    await recordOfflineDonation(admin, { campaignId: fund.id, amount: "250", donorName: "D", method: "CASH", receivedOn: "2027-01-01" });
    const f = await reportFacts(trip.id, o.org.id);
    expect(f).toMatchObject({ participants: 1, giftCount: 1, givenCents: 25000, completed: false });
  });
});
