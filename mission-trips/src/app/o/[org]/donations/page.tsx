import Link from "next/link";
import { pageOrgAdmin } from "@/server/page-guard";
import { db } from "@/server/db";
import { ledgerTotals } from "@/server/services/ledger";
import { Badge, Card, CardBody, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { donationMethodLabel, donationStatusLabel, donationStatusTone } from "@/lib/labels";
import type { DonationStatus } from "@/generated/prisma/client";

export const metadata = { title: "Donations" };

const FILTERS: { key: string; label: string; statuses: DonationStatus[] }[] = [
  { key: "received", label: "Received", statuses: ["SUCCEEDED", "PARTIALLY_REFUNDED"] },
  { key: "pending", label: "Processing", statuses: ["PENDING"] },
  { key: "problems", label: "Refunds & disputes", statuses: ["REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED"] },
  { key: "failed", label: "Failed", statuses: ["FAILED"] },
];

export default async function DonationsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ show?: string }> }) {
  const { org } = await params;
  const { show = "received" } = await searchParams;
  const ctx = await pageOrgAdmin(org);
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const [donations, totals] = await Promise.all([
    db.donation.findMany({
      where: {
        orgId: ctx.org.id,
        status: { in: filter.statuses },
        // A checkout someone opened but never paid isn't shown as "processing".
        ...(filter.key === "pending" ? { stripePaymentIntentId: { not: null } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { campaign: { select: { title: true } }, trip: { select: { id: true, name: true } } },
    }),
    ledgerTotals({ orgId: ctx.org.id }),
  ]);
  const cur = ctx.org.currency;

  return (
    <>
      <PageHeader title="Donations" description="All gifts across your trips. To refund or record a check, open the trip's Fundraising page." />
      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Gifts received" value={formatMoney(totals.donations, cur)} />
          <Stat label="Refunded" value={formatMoney(totals.refunds, cur)} />
          <Stat label="Disputes" value={formatMoney(totals.disputes, cur)} />
          <Stat label="Processing fees" value={formatMoney(totals.fees, cur)} sub={`Net ${formatMoney(totals.netRaised, cur)}`} />
        </CardBody>
      </Card>
      {/* Segmented control */}
      <nav aria-label="Filter donations" className="mb-4 grid grid-cols-2 gap-0.5 rounded-xl bg-fill p-0.5 sm:inline-grid sm:grid-cols-4">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`?show=${f.key}`}
            aria-current={f.key === filter.key ? "page" : undefined}
            className={
              f.key === filter.key
                ? "flex min-h-9 items-center justify-center rounded-[10px] bg-surface px-3 text-[15px] font-semibold whitespace-nowrap shadow-[0_3px_8px_rgb(0_0_0/0.12)] lg:min-h-8 lg:text-sm dark:bg-[#636366]"
                : "flex min-h-9 items-center justify-center rounded-[10px] px-3 text-[15px] whitespace-nowrap text-ink lg:min-h-8 lg:text-sm"
            }
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <Card>
        {donations.length === 0 ? (
          <EmptyState title={`No ${filter.label.toLowerCase()} gifts`} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Donor</Th>
                <Th>Trip / campaign</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {donations.map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap text-ink-2">{formatDate(d.receivedAt ?? d.createdAt)}</Td>
                  <Td label="Donor">
                    <div className="font-medium">{d.donorName}</div>
                    <div className="text-xs text-ink-3">{d.donorEmail ?? "No email"}</div>
                  </Td>
                  <Td label="Trip / campaign">
                    <Link href={`/o/${ctx.org.slug}/trips/${d.trip.id}/fundraising`} className="hover:underline">
                      {d.trip.name}
                    </Link>
                    <div className="max-w-56 truncate text-xs text-ink-3">{d.campaign.title}</div>
                  </Td>
                  <Td label="Amount" className="text-right tabular-nums">
                    {formatMoney(d.amountCents, d.currency)}
                    {d.refundedCents > 0 && <div className="text-xs text-bad">−{formatMoney(d.refundedCents, d.currency)}</div>}
                  </Td>
                  <Td label="Status">
                    <Badge tone={donationStatusTone[d.status]}>{donationStatusLabel[d.status]}</Badge>
                    <div className="text-xs text-ink-3">
                      {donationMethodLabel[d.method]}
                      {d.failureReason && ` · ${d.failureReason}`}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {d.receiptNumber != null && (
                      <Link href={`/receipts/${d.id}`} className="text-sm text-accent hover:underline">
                        #{d.receiptNumber}
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
