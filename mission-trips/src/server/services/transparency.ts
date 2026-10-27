import "server-only";
import { db } from "../db";
import { financialSummary } from "./finance";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateRange } from "@/lib/dates";
import { expenseCategoryLabel } from "@/lib/labels";
import type { ExpenseCategory } from "@/generated/prisma/client";

// Donor-facing figures. Aggregates only: never names, emails, individual
// gifts, or anything that could identify a donor or participant.

/** The one sentence that must accompany any donor-facing financial figures. */
export const POOLED_FUNDS_NOTE =
  "Gifts to this trip are pooled. Individual gifts are not matched to specific expenses.";

export type PublicFinancials = {
  currency: string;
  asOf: Date | null; // time of the most recent money movement
  giftCount: number;
  givenCents: number; // after refunds and lost disputes
  feesCents: number;
  spentCents: number;
  committedCents: number;
  remainingCents: number;
  budgetCents: number;
  goalCents: number;
  spendingByCategory: { category: ExpenseCategory; paidCents: number; budgetCents: number }[];
};

/** Live figures for a trip whose church has opted in. Returns null if not opted in. */
export async function publicTripFinancials(tripId: string): Promise<PublicFinancials | null> {
  const trip = await db.trip.findUnique({ where: { id: tripId }, include: { org: { select: { currency: true, status: true } } } });
  if (!trip || !trip.showLiveFinancials || trip.org.status !== "ACTIVE") return null;
  const [s, latest] = await Promise.all([
    financialSummary(trip.id, trip.orgId),
    db.ledgerEntry.findFirst({ where: { tripId: trip.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return {
    currency: trip.org.currency,
    asOf: latest?.createdAt ?? null,
    giftCount: s.giftCount,
    givenCents: s.totals.raised,
    feesCents: s.totals.fees,
    spentCents: s.totals.expenses,
    committedCents: s.committedCents,
    remainingCents: s.totals.balance,
    budgetCents: s.budgetCents,
    goalCents: s.goalCents,
    spendingByCategory: s.categories.filter((c) => c.paidCents > 0 || c.budgetCents > 0).map((c) => ({ category: c.category, paidCents: c.paidCents, budgetCents: c.budgetCents })),
  };
}

// ── Report drafts ──

export type ReportFacts = {
  tripName: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  completed: boolean;
  participants: number;
  leaders: number;
  giftCount: number;
  givenCents: number;
  refundsCents: number;
  feesCents: number;
  spentCents: number;
  committedCents: number;
  remainingCents: number;
  spending: { category: ExpenseCategory; paidCents: number }[];
  publicUpdates: number;
  asOf: Date;
  currency: string;
};

/**
 * Writes a plain-language draft from verified records only. Every number in
 * the text comes from the facts passed in; nothing is estimated or invented.
 * An administrator reviews and edits it before anything is published.
 */
export function composeReportDraft(f: ReportFacts): { title: string; narrative: string } {
  const m = (c: number) => formatMoney(c, f.currency);
  const team = f.participants + f.leaders;
  const teamText = `${team} ${team === 1 ? "person" : "people"}`;
  const paras: string[] = [];
  paras.push(
    f.completed
      ? `A team of ${teamText} served in ${f.destination} (${formatDateRange(f.startDate, f.endDate)}). Thank you for making it possible.`
      : `A team of ${teamText} is preparing to serve in ${f.destination} (${formatDateRange(f.startDate, f.endDate)}).`,
  );
  if (f.giftCount > 0) {
    paras.push(
      `As of ${formatDate(f.asOf)}, ${f.giftCount} ${f.giftCount === 1 ? "gift has" : "gifts have"} been received, totaling ${m(f.givenCents)}` +
        (f.refundsCents > 0 ? ` after ${m(f.refundsCents)} in refunds` : "") +
        `. Payment processing fees came to ${m(f.feesCents)}.`,
    );
  } else {
    paras.push(`As of ${formatDate(f.asOf)}, no gifts have been recorded yet.`);
  }
  const spent = f.spending.filter((s) => s.paidCents > 0).sort((a, b) => b.paidCents - a.paidCents);
  if (spent.length > 0) {
    const parts = spent.map((s) => `${expenseCategoryLabel[s.category].toLowerCase()} ${m(s.paidCents)}`);
    paras.push(`So far ${m(f.spentCents)} has been spent: ${parts.join(", ")}.`);
  } else {
    paras.push("No expenses have been paid yet.");
  }
  if (f.committedCents > 0) paras.push(`A further ${m(f.committedCents)} is committed for costs not yet paid.`);
  const after = f.remainingCents - f.committedCents;
  paras.push(
    after >= 0
      ? `${m(f.remainingCents)} remains available${f.committedCents > 0 ? `, or ${m(after)} after committed costs` : ""}.`
      : `Committed costs currently exceed the funds received by ${m(-after)}.`,
  );
  paras.push(`${POOLED_FUNDS_NOTE} These figures come from the church's records.`);
  return {
    title: f.completed ? `Final report: ${f.tripName}` : `Update: ${f.tripName}`,
    narrative: paras.join("\n\n"),
  };
}

export async function reportFacts(tripId: string, orgId: string, now = new Date()): Promise<ReportFacts> {
  const trip = await db.trip.findFirstOrThrow({ where: { id: tripId, orgId }, include: { org: { select: { currency: true } } } });
  const [s, participants, leaders, publicUpdates] = await Promise.all([
    financialSummary(trip.id, orgId),
    db.tripMember.count({ where: { tripId, role: "PARTICIPANT", status: "APPROVED" } }),
    db.tripMember.count({ where: { tripId, role: "LEADER", status: "APPROVED" } }),
    db.post.count({ where: { tripId, audience: "PUBLIC", status: "PUBLISHED" } }),
  ]);
  return {
    tripName: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    completed: trip.status === "COMPLETED",
    participants,
    leaders,
    giftCount: s.giftCount,
    givenCents: s.totals.raised,
    refundsCents: s.totals.refunds,
    feesCents: s.totals.fees,
    spentCents: s.totals.expenses,
    committedCents: s.committedCents,
    remainingCents: s.totals.balance,
    spending: s.categories.map((c) => ({ category: c.category, paidCents: c.paidCents })),
    publicUpdates,
    asOf: now,
    currency: trip.org.currency,
  };
}
