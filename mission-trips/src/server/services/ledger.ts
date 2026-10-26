import "server-only";
import { db, type Tx } from "../db";
import type { LedgerType, Prisma } from "@/generated/prisma/client";

// Every figure shown as money "raised", "fees", "refunded" or "spent" is
// computed from LedgerEntry rows. Nothing is stored as a running total that
// could drift out of sync.

export type LedgerTotals = {
  donations: number; // gross gifts received
  fees: number; // processor fees (positive number)
  refunds: number; // returned to donors (positive number)
  disputes: number; // net chargebacks (positive number)
  expenses: number; // net paid expenses (positive number)
  adjustments: number; // signed
  /** Gifts received minus refunds and lost disputes: what donors have given. */
  raised: number;
  /** Raised minus fees: what reached the church. */
  netRaised: number;
  /** Everything: what remains after expenses. */
  balance: number;
};

export function emptyTotals(): LedgerTotals {
  return { donations: 0, fees: 0, refunds: 0, disputes: 0, expenses: 0, adjustments: 0, raised: 0, netRaised: 0, balance: 0 };
}

export function totalsFromSums(rows: { type: LedgerType; sum: number }[]): LedgerTotals {
  const by = (t: LedgerType) => rows.filter((r) => r.type === t).reduce((a, r) => a + r.sum, 0);
  const neg = (n: number) => (n === 0 ? 0 : -n); // avoid -0, which would display as "-$0.00"
  const donations = by("DONATION");
  const fees = neg(by("PROCESSING_FEE"));
  const refunds = neg(by("REFUND"));
  const disputes = neg(by("DISPUTE") + by("DISPUTE_REVERSAL"));
  const expenses = neg(by("EXPENSE") + by("EXPENSE_REVERSAL"));
  const adjustments = by("ADJUSTMENT");
  const raised = donations - refunds - disputes;
  const netRaised = raised - fees;
  return { donations, fees, refunds, disputes, expenses, adjustments, raised, netRaised, balance: netRaised - expenses + adjustments };
}

export async function ledgerTotals(where: Prisma.LedgerEntryWhereInput, tx: Tx = db): Promise<LedgerTotals> {
  const grouped = await tx.ledgerEntry.groupBy({ by: ["type"], where, _sum: { amountCents: true } });
  return totalsFromSums(grouped.map((g) => ({ type: g.type, sum: g._sum.amountCents ?? 0 })));
}

/** "Raised" per campaign, for progress bars. */
export async function raisedByCampaign(campaignIds: string[], tx: Tx = db): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (campaignIds.length === 0) return out;
  const grouped = await tx.ledgerEntry.groupBy({
    by: ["campaignId", "type"],
    where: { campaignId: { in: campaignIds }, type: { in: ["DONATION", "REFUND", "DISPUTE", "DISPUTE_REVERSAL"] } },
    _sum: { amountCents: true },
  });
  for (const g of grouped) {
    if (!g.campaignId) continue;
    out.set(g.campaignId, (out.get(g.campaignId) ?? 0) + (g._sum.amountCents ?? 0));
  }
  return out;
}

/** Amount by restriction (restricted vs unrestricted funds) for reports. */
export async function balanceByRestriction(where: Prisma.LedgerEntryWhereInput, tx: Tx = db) {
  const grouped = await tx.ledgerEntry.groupBy({ by: ["restriction"], where, _sum: { amountCents: true } });
  return {
    restricted: grouped.find((g) => g.restriction === "RESTRICTED")?._sum.amountCents ?? 0,
    unrestricted: grouped.find((g) => g.restriction === "UNRESTRICTED")?._sum.amountCents ?? 0,
  };
}
