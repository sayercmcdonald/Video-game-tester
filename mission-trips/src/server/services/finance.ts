import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { invalid, notFound } from "../errors";
import { validateUpload } from "../storage";
import { storeDocument } from "./documents";
import { balanceByRestriction, ledgerTotals, raisedByCampaign, type LedgerTotals } from "./ledger";
import { zDate, zMoney, zName, zOptionalDate, zOptionalText } from "@/lib/validation";
import { formatMoney } from "@/lib/money";
import { ExpenseCategory, type Prisma } from "@/generated/prisma/client";

export const EXPENSE_CATEGORIES = Object.values(ExpenseCategory);

// ───────────────────────────── Expenses ─────────────────────────────

export const expenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]]),
    description: zName("Description", 200),
    vendor: zOptionalText(150),
    amount: zMoney("Amount", { min: 1 }),
    status: z.enum(["COMMITTED", "PAID"]),
    incurredOn: zDate("Date"),
    paidOn: zOptionalDate("Paid date"),
    notes: zOptionalText(2000),
  })
  .refine((d) => d.status !== "PAID" || d.paidOn, { message: "Enter the date it was paid.", path: ["paidOn"] });

/** Paid expenses go into the ledger; committed ones count toward the budget but not spending. */
export async function createExpense(t: TripContext, input: z.input<typeof expenseSchema>, receipt?: File | null) {
  assertPerm(t.perms.recordExpenses, "You don't have permission to record expenses for this trip.");
  const d = expenseSchema.parse(input);
  const upload = receipt && receipt.size > 0 ? await validateUpload(receipt) : null;
  const expense = await db.$transaction(async (tx) => {
    const doc = upload
      ? await storeDocument(tx, upload, { orgId: t.org.id, tripId: t.trip.id, ownerUserId: null, kind: "EXPENSE_RECEIPT", uploadedById: t.user.id })
      : null;
    const e = await tx.expense.create({
      data: {
        orgId: t.org.id,
        tripId: t.trip.id,
        category: d.category,
        description: d.description,
        vendor: d.vendor ?? null,
        amountCents: d.amount,
        status: d.status,
        incurredOn: d.incurredOn,
        paidOn: d.status === "PAID" ? d.paidOn! : null,
        notes: d.notes ?? null,
        receiptId: doc?.id ?? null,
        createdById: t.user.id,
      },
    });
    if (e.status === "PAID") await postExpenseToLedger(tx, e, t.user.id);
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "expense.created", entityType: "Expense", entityId: e.id, metadata: { amountCents: e.amountCents, status: e.status } }, tx);
    return e;
  });
  return expense;
}

async function postExpenseToLedger(tx: Prisma.TransactionClient, e: { id: string; orgId: string; tripId: string; amountCents: number; paidOn: Date | null; description: string }, actor: string) {
  await tx.ledgerEntry.create({
    data: {
      orgId: e.orgId,
      tripId: e.tripId,
      expenseId: e.id,
      type: "EXPENSE",
      amountCents: -e.amountCents,
      restriction: "RESTRICTED",
      occurredAt: e.paidOn ?? new Date(),
      memo: e.description,
      sourceRef: `expense:${e.id}:paid`,
      createdById: actor,
    },
  });
}

export async function markExpensePaid(t: TripContext, expenseId: string, paidOnInput: string) {
  assertPerm(t.perms.recordExpenses);
  const paidOn = zDate("Paid date").parse(paidOnInput);
  await db.$transaction(async (tx) => {
    const claimed = await tx.expense.updateMany({ where: { id: expenseId, tripId: t.trip.id, orgId: t.org.id, status: "COMMITTED" }, data: { status: "PAID", paidOn } });
    if (claimed.count === 0) throw invalid("Only committed expenses can be marked paid.");
    const e = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });
    await postExpenseToLedger(tx, e, t.user.id);
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "expense.paid", entityType: "Expense", entityId: e.id }, tx);
  });
}

/** Voiding keeps the record. A paid expense gets an offsetting ledger entry rather than being erased. */
export async function voidExpense(t: TripContext, expenseId: string, reason: string) {
  assertPerm(t.perms.recordExpenses);
  const why = z.string().trim().min(3, "Give a short reason.").max(500).parse(reason);
  await db.$transaction(async (tx) => {
    const e = await tx.expense.findFirst({ where: { id: expenseId, tripId: t.trip.id, orgId: t.org.id } });
    if (!e) throw notFound("Expense");
    if (e.status === "VOID") throw invalid("This expense is already void.");
    await tx.expense.update({ where: { id: e.id }, data: { status: "VOID", notes: [e.notes, `Voided: ${why}`].filter(Boolean).join("\n") } });
    if (e.status === "PAID") {
      await tx.ledgerEntry.create({
        data: {
          orgId: e.orgId,
          tripId: e.tripId,
          expenseId: e.id,
          type: "EXPENSE_REVERSAL",
          amountCents: e.amountCents,
          restriction: "RESTRICTED",
          occurredAt: new Date(),
          memo: `Voided: ${why}`,
          sourceRef: `expense:${e.id}:void`,
          createdById: t.user.id,
        },
      });
    }
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "expense.voided", entityType: "Expense", entityId: e.id, metadata: { reason: why } }, tx);
  });
}

export async function attachExpenseReceipt(t: TripContext, expenseId: string, file: File | null) {
  assertPerm(t.perms.recordExpenses);
  const e = await db.expense.findFirst({ where: { id: expenseId, tripId: t.trip.id, orgId: t.org.id } });
  if (!e) throw notFound("Expense");
  const upload = await validateUpload(file);
  await db.$transaction(async (tx) => {
    const doc = await storeDocument(tx, upload, { orgId: t.org.id, tripId: t.trip.id, ownerUserId: null, kind: "EXPENSE_RECEIPT", uploadedById: t.user.id });
    await tx.expense.update({ where: { id: e.id }, data: { receiptId: doc.id } });
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "expense.receipt_attached", entityType: "Expense", entityId: e.id }, tx);
  });
}

// ───────────────────────────── Budget ─────────────────────────────

export async function setBudgetLines(t: TripContext, fd: FormData) {
  assertPerm(t.perms.recordExpenses);
  const lines: { category: ExpenseCategory; plannedCents: number }[] = [];
  for (const c of EXPENSE_CATEGORIES) {
    const raw = String(fd.get(`budget_${c}`) ?? "").trim();
    const cents = raw === "" ? 0 : zMoney("Budget").safeParse(raw);
    if (typeof cents === "object" && !cents.success) throw invalid(`Enter a valid amount for ${c.toLowerCase().replace(/_/g, " ")}.`);
    lines.push({ category: c, plannedCents: typeof cents === "number" ? cents : cents.data });
  }
  await db.$transaction(async (tx) => {
    for (const l of lines) {
      await tx.budgetLine.upsert({
        where: { tripId_category: { tripId: t.trip.id, category: l.category } },
        create: { orgId: t.org.id, tripId: t.trip.id, ...l },
        update: { plannedCents: l.plannedCents },
      });
    }
    const total = lines.reduce((a, l) => a + l.plannedCents, 0);
    await tx.trip.update({ where: { id: t.trip.id }, data: { budgetCents: total } });
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "budget.updated", entityType: "Trip", entityId: t.trip.id, metadata: { totalCents: total } }, tx);
  });
}

// ───────────────────────────── Summary ─────────────────────────────

export type CategoryRow = { category: ExpenseCategory; budgetCents: number; committedCents: number; paidCents: number };

export type FinancialSummary = {
  totals: LedgerTotals;
  restricted: { restricted: number; unrestricted: number };
  budgetCents: number;
  goalCents: number;
  committedCents: number; // agreed but not yet paid
  paidCents: number;
  categories: CategoryRow[];
  pledgesOpenCents: number;
  pledgesOpenCount: number;
  giftCount: number;
  pendingGiftCount: number;
};

export async function financialSummary(tripId: string, orgId: string): Promise<FinancialSummary> {
  const [totals, restricted, trip, expenses, budgetLines, pledges, giftCount, pendingGiftCount] = await Promise.all([
    ledgerTotals({ tripId, orgId }),
    balanceByRestriction({ tripId, orgId }),
    db.trip.findUniqueOrThrow({ where: { id: tripId } }),
    db.expense.groupBy({ by: ["category", "status"], where: { tripId, orgId, status: { not: "VOID" } }, _sum: { amountCents: true } }),
    db.budgetLine.findMany({ where: { tripId, orgId } }),
    db.pledge.aggregate({ where: { tripId, orgId, status: "OPEN" }, _sum: { amountCents: true }, _count: true }),
    db.donation.count({ where: { tripId, orgId, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } } }),
    db.donation.count({ where: { tripId, orgId, status: "PENDING", method: "CARD_ONLINE", stripePaymentIntentId: { not: null } } }),
  ]);
  const categories: CategoryRow[] = EXPENSE_CATEGORIES.map((category) => ({
    category,
    budgetCents: budgetLines.find((b) => b.category === category)?.plannedCents ?? 0,
    committedCents: expenses.find((e) => e.category === category && e.status === "COMMITTED")?._sum.amountCents ?? 0,
    paidCents: expenses.find((e) => e.category === category && e.status === "PAID")?._sum.amountCents ?? 0,
  }));
  return {
    totals,
    restricted,
    budgetCents: trip.budgetCents,
    goalCents: trip.fundraisingGoalCents,
    committedCents: categories.reduce((a, c) => a + c.committedCents, 0),
    paidCents: categories.reduce((a, c) => a + c.paidCents, 0),
    categories,
    pledgesOpenCents: pledges._sum.amountCents ?? 0,
    pledgesOpenCount: pledges._count,
    giftCount,
    pendingGiftCount,
  };
}

// ───────────────────────────── Published reports ─────────────────────────────

/** What donors see: aggregate figures only, never individual donors or participants. */
export type ReportSnapshot = {
  currency: string;
  generatedAt: string;
  giftCount: number;
  raisedCents: number;
  feesCents: number;
  refundsCents: number;
  netRaisedCents: number;
  spentCents: number;
  committedCents: number;
  remainingCents: number;
  budgetCents: number;
  goalCents: number;
  spendingByCategory: { category: ExpenseCategory; paidCents: number; budgetCents: number }[];
};

export const reportSchema = z.object({
  title: zName("Title", 200),
  narrative: z.string().trim().max(20_000).default(""),
  isFinal: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export async function publishFinancialReport(t: TripContext, input: z.input<typeof reportSchema>) {
  assertPerm(t.perms.administerFinances, "Only church administrators can publish financial reports.");
  const d = reportSchema.parse(input);
  const s = await financialSummary(t.trip.id, t.org.id);
  const snapshot: ReportSnapshot = {
    currency: t.org.currency,
    generatedAt: new Date().toISOString(),
    giftCount: s.giftCount,
    raisedCents: s.totals.raised,
    feesCents: s.totals.fees,
    refundsCents: s.totals.refunds,
    netRaisedCents: s.totals.netRaised,
    spentCents: s.totals.expenses,
    committedCents: s.committedCents,
    remainingCents: s.totals.balance,
    budgetCents: s.budgetCents,
    goalCents: s.goalCents,
    spendingByCategory: s.categories.filter((c) => c.paidCents > 0 || c.budgetCents > 0).map((c) => ({ category: c.category, paidCents: c.paidCents, budgetCents: c.budgetCents })),
  };
  const report = await db.financialReport.create({
    data: { orgId: t.org.id, tripId: t.trip.id, title: d.title, narrative: d.narrative, isFinal: d.isFinal, snapshot, publishedById: t.user.id },
  });
  await audit({
    orgId: t.org.id,
    actorUserId: t.user.id,
    action: "report.published",
    entityType: "FinancialReport",
    entityId: report.id,
    metadata: { raised: formatMoney(snapshot.raisedCents), spent: formatMoney(snapshot.spentCents) },
  });
  return report;
}

// ───────────────────────────── Pledges ─────────────────────────────

export const pledgeSchema = z.object({
  campaignId: z.string().min(1, "Choose a campaign."),
  donorName: zName("Name", 120),
  donorEmail: z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address." })).optional(),
  amount: zMoney("Amount", { min: 100 }),
  expectedBy: zOptionalDate("Expected date"),
  note: zOptionalText(1000),
});

/** A pledge is a promise, tracked separately. It is never counted as money raised. */
export async function createPledge(t: TripContext, input: z.input<typeof pledgeSchema>) {
  const d = pledgeSchema.parse(input);
  const campaign = await db.campaign.findFirst({ where: { id: d.campaignId, tripId: t.trip.id, orgId: t.org.id } });
  if (!campaign) throw notFound("Campaign");
  const ownCampaign = campaign.tripMemberId != null && campaign.tripMemberId === t.tripMember?.id;
  assertPerm(t.perms.manage || ownCampaign);
  const p = await db.pledge.create({
    data: {
      orgId: t.org.id,
      tripId: t.trip.id,
      campaignId: campaign.id,
      donorName: d.donorName,
      donorEmail: d.donorEmail ?? null,
      amountCents: d.amount,
      expectedBy: d.expectedBy ?? null,
      note: d.note ?? null,
      createdById: t.user.id,
    },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "pledge.created", entityType: "Pledge", entityId: p.id, metadata: { amountCents: d.amount } });
  return p;
}

export async function setPledgeStatus(t: TripContext, pledgeId: string, status: "FULFILLED" | "CANCELLED") {
  const p = await db.pledge.findFirst({ where: { id: pledgeId, tripId: t.trip.id, orgId: t.org.id }, include: { campaign: true } });
  if (!p) throw notFound("Pledge");
  const own = p.campaign.tripMemberId != null && p.campaign.tripMemberId === t.tripMember?.id;
  assertPerm(t.perms.manage || own);
  if (p.status !== "OPEN") throw invalid("This pledge is already closed.");
  await db.pledge.update({ where: { id: p.id }, data: { status } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: `pledge.${status.toLowerCase()}`, entityType: "Pledge", entityId: p.id });
}

// ───────────────────────────── Participant fundraising ─────────────────────────────

export async function participantFundraising(tripId: string, orgId: string) {
  const campaigns = await db.campaign.findMany({
    where: { tripId, orgId, kind: "PARTICIPANT", tripMember: { status: "APPROVED" } },
    include: { tripMember: { include: { user: { select: { id: true, name: true } } } } },
  });
  const raised = await raisedByCampaign(campaigns.map((c) => c.id));
  const pledges = await db.pledge.groupBy({ by: ["campaignId"], where: { tripId, orgId, status: "OPEN" }, _sum: { amountCents: true } });
  return campaigns
    .map((c) => ({
      campaign: c,
      name: c.tripMember?.user.name ?? c.title,
      userId: c.tripMember?.user.id ?? null,
      raisedCents: raised.get(c.id) ?? 0,
      pledgedCents: pledges.find((p) => p.campaignId === c.id)?._sum.amountCents ?? 0,
      goalCents: c.goalCents,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
