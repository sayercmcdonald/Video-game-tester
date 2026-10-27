import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { tripContextFor } from "@/server/context";
import { createRequirement, submitRequirement, reviewSubmission, tripReadiness, parseFormFieldLines, deleteRequirement } from "@/server/services/requirements";
import { createExpense, markExpensePaid, voidExpense, financialSummary, publishFinancialReport, setBudgetLines, createPledge } from "@/server/services/finance";
import { createPost, approvePost, tripPosts } from "@/server/services/posts";
import { updateOwnProfile, getProfile } from "@/server/services/profiles";
import { authorizeDownload } from "@/server/services/documents";
import { recordOfflineDonation } from "@/server/services/donations";
import { ledgerTotals } from "@/server/services/ledger";
import { sendDeadlineReminders } from "@/server/jobs";
import { validateUpload } from "@/server/storage";
import { addTripMember, ctxFor, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";

beforeEach(resetDb);

const pdf = (name = "doc.pdf") => new File([Buffer.from("%PDF-1.4\n%x\n%%EOF")], name, { type: "application/pdf" });

async function setup() {
  const o = await makeOrg();
  const { trip, fund } = await makeTrip(o.org.id);
  const admin = await tripContextFor(o.ctx, trip.id);
  const leaderUser = await makeUser({ name: "Lee Leader" });
  await addTripMember(trip, leaderUser, "LEADER");
  const leader = await tripCtxFor(leaderUser, o.org.slug, trip.id);
  const pUser = await makeUser({ name: "Pat Participant" });
  const tm = await addTripMember(trip, pUser);
  const participant = await tripCtxFor(pUser, o.org.slug, trip.id);
  return { ...o, trip, fund, adminT: admin, leader, leaderUser, participant, pUser, tm };
}

describe("requirements", () => {
  it("parses leader-written form questions", () => {
    expect(parseFormFieldLines("Allergies? [yes/no]\nDescribe (optional)\n\n")).toEqual([
      { key: "q1", label: "Allergies?", type: "yesno", required: true },
      { key: "q2", label: "Describe", type: "text", required: false },
    ]);
  });

  it("runs the upload → review → approve cycle and updates readiness", async () => {
    const s = await setup();
    const req = await createRequirement(s.leader, { kind: "UPLOAD", title: "Passport", needsReview: "on", isRequired: "on" });
    const fd = new FormData();
    fd.set("file", pdf("passport.pdf"));
    const sub = await submitRequirement(s.participant, req.id, fd);
    expect(sub.status).toBe("SUBMITTED");
    let r = await tripReadiness(s.trip.id, s.org.id);
    expect(r.rows[0].percent).toBe(0);

    await expect(reviewSubmission(s.leader, sub.id, "CHANGES_REQUESTED")).rejects.toThrow(/what needs to change/);
    await reviewSubmission(s.leader, sub.id, "CHANGES_REQUESTED", "Photo is blurry");
    const fd2 = new FormData();
    fd2.set("file", pdf("passport2.pdf"));
    await submitRequirement(s.participant, req.id, fd2);
    await reviewSubmission(s.leader, sub.id, "APPROVED");
    r = await tripReadiness(s.trip.id, s.org.id);
    expect(r.rows[0].percent).toBe(100);
    // Approved items are locked
    await expect(submitRequirement(s.participant, req.id, fd2)).rejects.toThrow(/already complete/);
  });

  it("requires the waiver signature to match the participant's name", async () => {
    const s = await setup();
    const req = await createRequirement(s.adminT, { kind: "WAIVER", title: "Waiver", waiverText: "I agree.", isRequired: "on" });
    const bad = new FormData();
    bad.set("agree", "on");
    bad.set("signedName", "Someone Else");
    await expect(submitRequirement(s.participant, req.id, bad)).rejects.toThrow(/full name/);
    const noAgree = new FormData();
    noAgree.set("signedName", "Pat Participant");
    await expect(submitRequirement(s.participant, req.id, noAgree)).rejects.toThrow(/Check the box/);
    const good = new FormData();
    good.set("agree", "on");
    good.set("signedName", "  pat   participant ");
    const sub = await submitRequirement(s.participant, req.id, good);
    expect(sub.status).toBe("APPROVED"); // waivers don't need review by default
    expect(await db.auditLog.count({ where: { action: "waiver.signed" } })).toBe(1);
  });

  it("validates required form answers", async () => {
    const s = await setup();
    const req = await createRequirement(s.adminT, { kind: "FORM", title: "Health", formQuestions: "Allergies? [yes/no]\nNotes (optional)", needsReview: "on", isRequired: "on" });
    await expect(submitRequirement(s.participant, req.id, new FormData())).rejects.toThrow(/Please answer: Allergies/);
    const fd = new FormData();
    fd.set("q1", "maybe");
    await expect(submitRequirement(s.participant, req.id, fd)).rejects.toThrow(/yes or no/);
    fd.set("q1", "no");
    const sub = await submitRequirement(s.participant, req.id, fd);
    expect(sub.formAnswers).toEqual({ q1: "no", q2: "" });
  });

  it("only managers create or review requirements, and submitted ones can't be deleted", async () => {
    const s = await setup();
    await expect(createRequirement(s.participant, { kind: "TASK", title: "x", isRequired: "on" })).rejects.toBeInstanceOf(AppError);
    const req = await createRequirement(s.adminT, { kind: "TASK", title: "Orientation", isRequired: "on" });
    await submitRequirement(s.participant, req.id, new FormData());
    await expect(deleteRequirement(s.adminT, req.id)).rejects.toThrow(/Mark it as not required/);
  });
});

describe("expenses, ledger and reports", () => {
  it("records paid expenses in the ledger and reverses them when voided", async () => {
    const s = await setup();
    await recordOfflineDonation(s.adminT, { campaignId: s.fund.id, amount: "1000", donorName: "D", method: "CHECK", receivedOn: "2027-01-01" });
    const committed = await createExpense(s.adminT, { category: "LODGING", description: "Hotel", amount: "400", status: "COMMITTED", incurredOn: "2027-02-01" });
    let sum = await financialSummary(s.trip.id, s.org.id);
    expect(sum.totals.expenses).toBe(0);
    expect(sum.committedCents).toBe(40000);

    await markExpensePaid(s.adminT, committed.id, "2027-02-02");
    sum = await financialSummary(s.trip.id, s.org.id);
    expect(sum.totals.expenses).toBe(40000);
    expect(sum.totals.balance).toBe(60000);
    await expect(markExpensePaid(s.adminT, committed.id, "2027-02-02")).rejects.toThrow(/Only approved, unpaid/);

    await voidExpense(s.adminT, committed.id, "Booked twice");
    sum = await financialSummary(s.trip.id, s.org.id);
    expect(sum.totals.expenses).toBe(0);
    expect(sum.totals.balance).toBe(100000);
    // History is preserved
    expect(await db.ledgerEntry.count({ where: { expenseId: committed.id } })).toBe(2);
  });

  it("holds leaders' expenses for administrator approval before they count", async () => {
    const s = await setup();
    const paid = await createExpense(s.leader, { category: "FOOD", description: "Team dinner", amount: "120", status: "PAID", incurredOn: "2027-02-01", paidOn: "2027-02-01" });
    const booked = await createExpense(s.leader, { category: "LODGING", description: "Guesthouse", amount: "900", status: "COMMITTED", incurredOn: "2027-02-01" });
    expect(paid.status).toBe("PENDING_APPROVAL");
    let sum = await financialSummary(s.trip.id, s.org.id);
    expect(sum).toMatchObject({ committedCents: 0, paidCents: 0, pendingApprovalCents: 102000, pendingApprovalCount: 2 });
    expect(sum.totals.expenses).toBe(0);
    expect(await db.ledgerEntry.count({ where: { expenseId: paid.id } })).toBe(0);
    // Admins were asked to review
    expect(await db.notification.count({ where: { userId: s.admin.id, title: { startsWith: "Expense to approve" } } })).toBe(2);

    // Leaders can't approve, pay, or void approved expenses
    const { reviewExpense } = await import("@/server/services/finance");
    await expect(reviewExpense(s.leader, paid.id, "APPROVE")).rejects.toThrow(/administrators/);
    await expect(reviewExpense(s.adminT, booked.id, "REJECT")).rejects.toThrow(/Say why/);

    await reviewExpense(s.adminT, paid.id, "APPROVE");
    await reviewExpense(s.adminT, booked.id, "REJECT", "Use the church's existing booking");
    await expect(reviewExpense(s.adminT, paid.id, "APPROVE")).rejects.toThrow(/isn't waiting/);
    sum = await financialSummary(s.trip.id, s.org.id);
    expect(sum).toMatchObject({ paidCents: 12000, committedCents: 0, pendingApprovalCents: 0 });
    expect(sum.totals.expenses).toBe(12000);
    expect((await db.expense.findUniqueOrThrow({ where: { id: paid.id } })).approvedById).toBe(s.admin.id);
    expect(await db.auditLog.count({ where: { action: { in: ["expense.submitted", "expense.approved", "expense.rejected"] } } })).toBe(4);

    await expect(voidExpense(s.leader, paid.id, "mistake")).rejects.toThrow(/administrators can void/);
    const leaderCommitted = await createExpense(s.leader, { category: "FOOD", description: "Snacks", amount: "20", status: "COMMITTED", incurredOn: "2027-02-01" });
    await voidExpense(s.leader, leaderCommitted.id, "Withdrawn by submitter"); // own pending submission
    await reviewExpense(s.adminT, (await createExpense(s.leader, { category: "FOOD", description: "Water", amount: "15", status: "COMMITTED", incurredOn: "2027-02-01" })).id, "APPROVE");
    const approvedCommitted = await db.expense.findFirstOrThrow({ where: { description: "Water" } });
    await expect(markExpensePaid(s.leader, approvedCommitted.id, "2027-02-03")).rejects.toThrow(/administrators can mark/);
  });

  it("approval races apply only once", async () => {
    const s = await setup();
    const e = await createExpense(s.leader, { category: "FOOD", description: "Lunch", amount: "50", status: "PAID", incurredOn: "2027-02-01", paidOn: "2027-02-01" });
    const { reviewExpense } = await import("@/server/services/finance");
    const results = await Promise.allSettled([reviewExpense(s.adminT, e.id, "APPROVE"), reviewExpense(s.adminT, e.id, "APPROVE")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.ledgerEntry.count({ where: { expenseId: e.id } })).toBe(1);
  });

  it("requires a paid date for paid expenses and blocks participants", async () => {
    const s = await setup();
    await expect(createExpense(s.leader, { category: "FOOD", description: "x", amount: "10", status: "PAID", incurredOn: "2027-01-01" })).rejects.toThrow();
    await expect(createExpense(s.participant, { category: "FOOD", description: "x", amount: "10", status: "COMMITTED", incurredOn: "2027-01-01" })).rejects.toBeInstanceOf(AppError);
  });

  it("hides finances from leaders when the church turns that off", async () => {
    const s = await setup();
    await db.trip.update({ where: { id: s.trip.id }, data: { leadersSeeFinances: false } });
    const leader = await tripCtxFor(s.leaderUser, s.org.slug, s.trip.id);
    await expect(createExpense(leader, { category: "FOOD", description: "x", amount: "10", status: "COMMITTED", incurredOn: "2027-01-01" })).rejects.toBeInstanceOf(AppError);
  });

  it("sets the trip budget from category lines", async () => {
    const s = await setup();
    const fd = new FormData();
    fd.set("budget_TRAVEL", "5,000");
    fd.set("budget_FOOD", "750.50");
    await setBudgetLines(s.adminT, fd);
    const t = await db.trip.findUniqueOrThrow({ where: { id: s.trip.id } });
    expect(t.budgetCents).toBe(575050);
    const bad = new FormData();
    bad.set("budget_FOOD", "abc");
    await expect(setBudgetLines(s.adminT, bad)).rejects.toThrow(/valid amount/);
  });

  it("publishes donor reports with totals only, by admins only", async () => {
    const s = await setup();
    await recordOfflineDonation(s.adminT, { campaignId: s.fund.id, amount: "250", donorName: "Very Private Donor", method: "CASH", receivedOn: "2027-01-01" });
    await expect(publishFinancialReport(s.leader, { title: "Update" })).rejects.toThrow(/administrators/);
    const report = await publishFinancialReport(s.adminT, { title: "Update", narrative: "Thanks!" });
    const json = JSON.stringify(report.snapshot);
    expect(json).not.toContain("Very Private Donor");
    expect(json).not.toContain("Pat Participant");
    expect(report.snapshot).toMatchObject({ raisedCents: 25000, giftCount: 1 });
  });

  it("never counts pledges as money raised", async () => {
    const s = await setup();
    const campaign = await db.campaign.create({ data: { orgId: s.org.id, tripId: s.trip.id, tripMemberId: s.tm.id, kind: "PARTICIPANT", slug: "pat", title: "Pat" } });
    await createPledge(s.participant, { campaignId: campaign.id, donorName: "Uncle", amount: "500" });
    expect((await ledgerTotals({ tripId: s.trip.id })).raised).toBe(0);
    expect((await financialSummary(s.trip.id, s.org.id)).pledgesOpenCents).toBe(50000);
    // A participant can't add pledges to someone else's page
    await expect(createPledge(s.participant, { campaignId: s.fund.id, donorName: "X", amount: "5" })).rejects.toBeInstanceOf(AppError);
  });
});

describe("updates", () => {
  it("publishes team posts immediately and holds leaders' public posts for admin approval", async () => {
    const s = await setup();
    const team = await createPost(s.leader, { title: "Packing", body: "Bring sunscreen", audience: "TEAM" });
    expect(team.status).toBe("PUBLISHED");
    const pub = await createPost(s.leader, { title: "Hello donors", body: "Thanks", audience: "PUBLIC" });
    expect(pub.status).toBe("PENDING_APPROVAL");
    expect((await tripPosts(s.participant)).map((p) => p.id)).not.toContain(pub.id);
    await expect(approvePost(s.leader, pub.id)).rejects.toThrow(/administrators/);
    await approvePost(s.adminT, pub.id);
    expect((await tripPosts(s.participant)).map((p) => p.id)).toContain(pub.id);
    await expect(createPost(s.participant, { title: "x", body: "y", audience: "TEAM" })).rejects.toBeInstanceOf(AppError);
    // The team was notified about the team post
    expect(await db.notification.count({ where: { userId: s.pUser.id, title: { contains: "Packing" } } })).toBe(1);
  });
});

describe("private profiles", () => {
  it("encrypts medical details at rest and limits who can read them", async () => {
    const s = await setup();
    const pCtx = await ctxFor(s.pUser, s.org.slug);
    await updateOwnProfile(pCtx, { emergencyContactName: "Mom", allergies: "Peanuts", medicalNotes: "Asthma inhaler" });
    const raw = await db.personProfile.findFirstOrThrow({ where: { userId: s.pUser.id } });
    expect(raw.sensitiveEncrypted).not.toContain("Peanuts");

    const leaderOrgCtx = await ctxFor(s.leaderUser, s.org.slug);
    const asLeader = await getProfile(leaderOrgCtx, s.pUser.id);
    expect(asLeader.sensitive.allergies).toBe("Peanuts");
    expect(await db.auditLog.count({ where: { action: "profile.viewed", actorUserId: s.leaderUser.id } })).toBe(1);

    // Another participant on the same trip can't see it
    const other = await makeUser();
    await addTripMember(s.trip, other);
    await expect(getProfile(await ctxFor(other, s.org.slug), s.pUser.id)).rejects.toBeInstanceOf(AppError);
    // A leader of a different trip in the same church can't either
    const { trip: trip2 } = await makeTrip(s.org.id);
    const otherLeader = await makeUser();
    await addTripMember(trip2, otherLeader, "LEADER");
    await expect(getProfile(await ctxFor(otherLeader, s.org.slug), s.pUser.id)).rejects.toBeInstanceOf(AppError);
  });
});

describe("file access", () => {
  it("lets only the owner, trip managers and admins open a participant's file", async () => {
    const s = await setup();
    const req = await createRequirement(s.adminT, { kind: "UPLOAD", title: "Passport", needsReview: "on", isRequired: "on" });
    const fd = new FormData();
    fd.set("file", pdf());
    const sub = await submitRequirement(s.participant, req.id, fd);
    const docId = sub.documentId!;
    expect(await authorizeDownload(s.pUser, docId)).not.toBeNull();
    expect(await authorizeDownload(s.leaderUser, docId)).not.toBeNull();
    expect(await authorizeDownload(s.admin, docId)).not.toBeNull();
    const teammate = await makeUser();
    await addTripMember(s.trip, teammate);
    expect(await authorizeDownload(teammate, docId)).toBeNull();
    const otherOrg = await makeOrg();
    expect(await authorizeDownload(otherOrg.admin, docId)).toBeNull();
  });

  it("rejects disguised and oversized files", async () => {
    await expect(validateUpload(new File([Buffer.from("MZ executable")], "x.pdf", { type: "application/pdf" }))).rejects.toThrow(/don't match/);
    await expect(validateUpload(new File([Buffer.from("x")], "x.exe", { type: "application/x-msdownload" }))).rejects.toThrow(/isn't accepted/);
    await expect(validateUpload(new File([Buffer.alloc(11 * 1024 * 1024)], "big.pdf", { type: "application/pdf" }))).rejects.toThrow(/10 MB/);
    const ok = await validateUpload(new File([Buffer.from("%PDF-1.7 hi")], "../../etc/passwd.pdf", { type: "application/pdf" }));
    expect(ok.filename).toBe("passwd.pdf");
  });
});

describe("deadline reminders", () => {
  it("reminds people with unfinished items once per milestone", async () => {
    const s = await setup();
    const today = new Date();
    const inSeven = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7)).toISOString().slice(0, 10);
    const req = await createRequirement(s.adminT, { kind: "TASK", title: "Orientation", isRequired: "on", dueDate: inSeven });
    expect((await sendDeadlineReminders(today)).reminders).toBe(1);
    expect((await sendDeadlineReminders(today)).reminders).toBe(1); // attempted again…
    expect(await db.notification.count({ where: { userId: s.pUser.id, title: { startsWith: "Due in 7 days" } } })).toBe(1); // …but delivered once
    await submitRequirement(s.participant, req.id, new FormData());
    const later = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 5));
    expect((await sendDeadlineReminders(later)).reminders).toBe(0); // done, so no 2-day reminder
  });
});
