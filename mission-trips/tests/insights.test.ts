import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { tripContextFor } from "@/server/context";
import { budgetOverruns, fundraisingPace, tripAlerts, visibleAlerts, fundraisingDeadline } from "@/server/services/insights";
import { createRequirement, reminderPreview, sendRequirementReminders, submitRequirement } from "@/server/services/requirements";
import { createExpense, setBudgetLines } from "@/server/services/finance";
import { recordOfflineDonation } from "@/server/services/donations";
import { ensureParticipantCampaign } from "@/server/services/campaigns";
import { addTripMember, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";

beforeEach(resetDb);

const day = 86_400_000;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("fundraising pace", () => {
  const base = { goalCents: 240000, windowStart: d("2027-01-01"), deadline: d("2027-05-01") };

  it("doesn't judge too early or without a goal", () => {
    expect(fundraisingPace({ ...base, raisedCents: 0, now: d("2027-01-10") }).status).toBe("too_early");
    expect(fundraisingPace({ ...base, goalCents: 0, raisedCents: 0, now: d("2027-04-01") }).status).toBe("no_goal");
  });

  it("flags someone well behind an even pace, with the expected amount", () => {
    const r = fundraisingPace({ ...base, raisedCents: 50000, now: d("2027-03-01") }); // ~49% of the window elapsed
    expect(r.status).toBe("behind");
    if (r.status === "behind") {
      expect(r.elapsedShare).toBeCloseTo(0.49, 1);
      expect(r.expectedCents).toBeGreaterThan(110000);
    }
  });

  it("tolerates being a little behind and recognizes reaching the goal", () => {
    expect(fundraisingPace({ ...base, raisedCents: 100000, now: d("2027-03-01") }).status).toBe("on_track"); // within 15 points
    expect(fundraisingPace({ ...base, raisedCents: 240000, now: d("2027-06-01") }).status).toBe("on_track");
  });

  it("reports the shortfall once the deadline has passed", () => {
    expect(fundraisingPace({ ...base, raisedCents: 200000, now: d("2027-05-02") })).toEqual({ status: "missed", shortCents: 40000 });
  });

  it("puts the fundraising deadline two weeks before departure", () => {
    expect(fundraisingDeadline(d("2027-06-15")).toISOString().slice(0, 10)).toBe("2027-06-01");
  });
});

describe("budget overruns", () => {
  it("counts paid plus committed against the plan, and ignores unbudgeted categories", () => {
    const r = budgetOverruns([
      { category: "LODGING", budgetCents: 300000, committedCents: 200000, paidCents: 150000 },
      { category: "FOOD", budgetCents: 100000, committedCents: 0, paidCents: 90000 },
      { category: "OTHER", budgetCents: 0, committedCents: 5000, paidCents: 0 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ category: "LODGING", overCents: 50000, usedCents: 350000 });
  });
});

describe("trip alerts", () => {
  async function setup() {
    const o = await makeOrg();
    const { trip, fund } = await makeTrip(o.org.id);
    // Departure in 20 days, trip set up 100 days ago.
    const now = new Date();
    await db.trip.update({ where: { id: trip.id }, data: { startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 20)), endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30)) } });
    const admin = await tripContextFor(o.ctx, trip.id);
    const leaderUser = await makeUser({ name: "Lee Leader" });
    await addTripMember(trip, leaderUser, "LEADER");
    const pUser = await makeUser({ name: "Pat Behind" });
    const tm = await addTripMember(trip, pUser);
    await db.tripMember.update({ where: { id: tm.id }, data: { decidedAt: new Date(Date.now() - 100 * day) } });
    await db.$transaction((tx) => ensureParticipantCampaign(tx, tm.id));
    return { ...o, trip, fund, admin, leaderUser, pUser, tm };
  }

  it("explains overdue items, departure risk and fundraising that's behind", async () => {
    const s = await setup();
    const yesterday = new Date(Date.now() - day).toISOString().slice(0, 10);
    await createRequirement(s.admin, { kind: "TASK", title: "Passport copy", isRequired: "on", dueDate: yesterday });
    const alerts = await tripAlerts(s.trip.id, s.org.id);
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["overdue", "departure", "fundraising_behind"]));
    const overdue = alerts.find((a) => a.kind === "overdue")!;
    expect(overdue.title).toBe("Passport copy is overdue for 1 person");
    expect(overdue.detail).toContain("Pat Behind");
    const pace = alerts.find((a) => a.kind === "fundraising_behind")!;
    expect(pace.detail).toMatch(/Received \$0\.00 of \$2,500\.00/);
    // Most urgent first
    expect(alerts[0].severity).toBe("urgent");
  });

  it("flags budget overruns, committed spending beyond funds, and pending approvals", async () => {
    const s = await setup();
    await recordOfflineDonation(s.admin, { campaignId: s.fund.id, amount: "500", donorName: "D", method: "CHECK", receivedOn: "2027-01-01" });
    const fd = new FormData();
    fd.set("budget_LODGING", "300");
    await setBudgetLines(s.admin, fd);
    await createExpense(s.admin, { category: "LODGING", description: "Guesthouse", amount: "800", status: "COMMITTED", incurredOn: "2027-01-02" });
    const leader = await tripCtxFor(s.leaderUser, s.org.slug, s.trip.id);
    await createExpense(leader, { category: "FOOD", description: "Groceries", amount: "60", status: "PAID", incurredOn: "2027-01-02", paidOn: "2027-01-02" });

    const alerts = await tripAlerts(s.trip.id, s.org.id);
    const budget = alerts.find((a) => a.kind === "budget_over")!;
    expect(budget.title).toBe("Lodging is over budget by $500.00");
    const shortfall = alerts.find((a) => a.kind === "shortfall")!;
    expect(shortfall.title).toBe("Committed spending exceeds funds by $300.00");
    expect(alerts.find((a) => a.kind === "expense_approvals")?.detail).toMatch(/\$60\.00/);

    // Leaders see finance alerts (church default) but not approval alerts; with finances hidden they see neither.
    const leaderView = visibleAlerts(alerts, leader.perms).map((a) => a.kind);
    expect(leaderView).toContain("budget_over");
    expect(leaderView).not.toContain("expense_approvals");
    await db.trip.update({ where: { id: s.trip.id }, data: { leadersSeeFinances: false } });
    const restricted = await tripCtxFor(s.leaderUser, s.org.slug, s.trip.id);
    const hidden = visibleAlerts(alerts, restricted.perms).map((a) => a.kind);
    expect(hidden).not.toContain("budget_over");
    expect(hidden).not.toContain("shortfall");
    expect(hidden).toContain("fundraising_behind");
  });

  it("raises nothing for completed or cancelled trips", async () => {
    const s = await setup();
    await db.trip.update({ where: { id: s.trip.id }, data: { status: "COMPLETED" } });
    expect(await tripAlerts(s.trip.id, s.org.id)).toEqual([]);
  });
});

describe("reviewed reminders", () => {
  it("previews exactly who will be reminded, sends once per day, and is leader-only", async () => {
    const o = await makeOrg();
    const { trip } = await makeTrip(o.org.id);
    const admin = await tripContextFor(o.ctx, trip.id);
    const done = await makeUser({ name: "Done Dana" });
    const notDone = await makeUser({ name: "Late Lou" });
    await addTripMember(trip, done);
    await addTripMember(trip, notDone);
    const req = await createRequirement(admin, { kind: "TASK", title: "Orientation", isRequired: "on" });
    await submitRequirement(await tripCtxFor(done, o.org.slug, trip.id), req.id, new FormData());

    const preview = await reminderPreview(admin);
    expect(preview).toEqual([{ userId: notDone.id, name: "Late Lou", outstanding: ["Orientation"] }]);

    expect(await sendRequirementReminders(admin)).toBe(1);
    await sendRequirementReminders(admin);
    expect(await db.notification.count({ where: { userId: notDone.id, title: { startsWith: "Reminder from" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: done.id, title: { startsWith: "Reminder from" } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "requirement.reminders_sent" } })).toBe(2);

    const participant = await tripCtxFor(notDone, o.org.slug, trip.id);
    await expect(reminderPreview(participant)).rejects.toThrow();
  });
});
