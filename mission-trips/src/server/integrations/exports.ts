import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type OrgContext } from "../context";
import { notFound } from "../errors";
import { money, toCsv } from "./csv";
import { donationMethodLabel, donationStatusLabel, expenseCategoryLabel, expenseStatusLabel } from "@/lib/labels";

export const EXPORT_KINDS = ["donations", "expenses", "ledger"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const LEDGER_LABEL: Record<string, string> = {
  DONATION: "Gift received",
  PROCESSING_FEE: "Processing fee",
  REFUND: "Refund",
  DISPUTE: "Chargeback",
  DISPUTE_REVERSAL: "Chargeback reversed",
  EXPENSE: "Expense paid",
  EXPENSE_REVERSAL: "Expense voided",
  ADJUSTMENT: "Adjustment",
};

/**
 * Builds an export file. Church administrators only. Every export is recorded
 * as a sync run and in the activity log, because it contains donor details.
 */
export async function runExport(ctx: OrgContext, kind: ExportKind, tripId?: string | null) {
  assertPerm(ctx.isAdmin, "Only church administrators can export financial records.");
  const orgId = ctx.org.id;
  if (tripId) {
    const exists = await db.trip.findFirst({ where: { id: tripId, orgId }, select: { id: true } });
    if (!exists) throw notFound("Trip");
  }
  const where = { orgId, ...(tripId ? { tripId } : {}) };
  const run = await db.syncRun.create({ data: { orgId, provider: "CSV_EXPORT", direction: "EXPORT", kind, triggeredById: ctx.user.id } });
  try {
    let header: string[];
    let rows: unknown[][];
    if (kind === "donations") {
      const list = await db.donation.findMany({
        where: { ...where, status: { notIn: ["PENDING", "CANCELED", "FAILED"] } },
        orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
        include: { trip: { select: { name: true } }, campaign: { select: { title: true, restriction: true } } },
      });
      header = ["Receipt number", "Date received", "Donor name", "Donor email", "Amount", "Refunded", "Net gift", "Processing fee", "Method", "Check or reference", "Status", "Trip", "Campaign", "Restriction", "Stripe payment ID"];
      rows = list.map((d) => [
        d.receiptNumber,
        d.receivedAt,
        d.donorName,
        d.donorEmail,
        money(d.amountCents),
        money(d.refundedCents),
        money(d.amountCents - d.refundedCents),
        money(d.feeCents),
        donationMethodLabel[d.method],
        d.offlineReference,
        donationStatusLabel[d.status],
        d.trip.name,
        d.campaign.title,
        d.campaign.restriction === "RESTRICTED" ? "Designated for trip" : "Unrestricted",
        d.stripePaymentIntentId,
      ]);
    } else if (kind === "expenses") {
      const list = await db.expense.findMany({ where, orderBy: [{ incurredOn: "asc" }, { createdAt: "asc" }], include: { trip: { select: { name: true } } } });
      const people = await db.user.findMany({ where: { id: { in: [...new Set(list.flatMap((e) => [e.createdById, e.approvedById].filter(Boolean) as string[]))] } }, select: { id: true, name: true } });
      const who = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "") : "");
      header = ["Date incurred", "Date paid", "Trip", "Category", "Description", "Vendor", "Amount", "Status", "Submitted by", "Approved or declined by", "Decision date", "Receipt attached", "Notes"];
      rows = list.map((e) => [
        e.incurredOn,
        e.paidOn,
        e.trip.name,
        expenseCategoryLabel[e.category],
        e.description,
        e.vendor,
        money(e.amountCents),
        expenseStatusLabel[e.status],
        who(e.createdById),
        who(e.approvedById),
        e.approvedAt,
        e.receiptId ? "Yes" : "No",
        e.notes,
      ]);
    } else {
      const list = await db.ledgerEntry.findMany({ where, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }], include: { trip: { select: { name: true } } } });
      header = ["Date", "Trip", "Type", "Amount", "Fund", "Memo", "Gift ID", "Expense ID", "Recorded at"];
      rows = list.map((l) => [l.occurredAt, l.trip.name, LEDGER_LABEL[l.type], money(l.amountCents), l.restriction === "RESTRICTED" ? "Designated" : "Unrestricted", l.memo, l.donationId, l.expenseId, l.createdAt.toISOString()]);
    }
    const csv = toCsv(header, rows);
    await db.syncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", recordsTotal: rows.length, finishedAt: new Date() } });
    await audit({ orgId, actorUserId: ctx.user.id, action: "export.downloaded", entityType: "SyncRun", entityId: run.id, metadata: { kind, tripId: tripId ?? null, rows: rows.length } });
    const date = new Date().toISOString().slice(0, 10);
    return { csv, filename: `sent-${ctx.org.slug}-${kind}${tripId ? "-trip" : ""}-${date}.csv`, rows: rows.length };
  } catch (err) {
    await db.syncRun.update({ where: { id: run.id }, data: { status: "FAILED", error: String(err).slice(0, 1000), finishedAt: new Date() } });
    throw err;
  }
}
