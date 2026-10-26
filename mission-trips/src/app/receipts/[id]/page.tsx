import { notFound } from "next/navigation";
import { getCurrentUser } from "@/server/context";
import { loadReceipt } from "@/server/services/donations";
import { PublicShell } from "@/components/public-shell";
import { Card } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { donationMethodLabel, restrictionLabel } from "@/lib/labels";

export const metadata = { title: "Receipt", robots: { index: false } };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const { id } = await params;
  const { token } = await searchParams;
  const user = await getCurrentUser();
  const d = await loadReceipt(id, { token, userId: user?.id, userEmail: user?.email, userVerified: !!user?.emailVerifiedAt });
  if (!d) notFound();
  const net = d.amountCents - d.refundedCents;

  return (
    <PublicShell orgName={d.org.name}>
      <Card className="mx-auto max-w-2xl p-8 print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-ink-3">Gift receipt #{d.receiptNumber}</div>
            <h1 className="mt-1 text-2xl font-semibold">{d.org.legalName ?? d.org.name}</h1>
            {d.org.taxId && <div className="text-sm text-ink-3">Tax ID: {d.org.taxId}</div>}
            <div className="text-sm text-ink-3">{d.org.contactEmail}</div>
          </div>
          <PrintButton />
        </div>
        <dl className="mt-8 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-3">Received from</dt>
            <dd className="font-medium">{d.donorName}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Date received</dt>
            <dd className="font-medium">{formatDate(d.receivedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Amount</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(d.amountCents, d.currency)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Method</dt>
            <dd className="font-medium">
              {donationMethodLabel[d.method]}
              {d.offlineReference && ` #${d.offlineReference}`}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-3">Designation</dt>
            <dd className="font-medium">
              {d.campaign.title} — {d.trip.name}
            </dd>
            <dd className="text-ink-2">{d.campaign.designationNote ?? restrictionLabel[d.campaign.restriction]}</dd>
          </div>
        </dl>
        {d.refundedCents > 0 && (
          <div className="mt-6 rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
            {formatMoney(d.refundedCents, d.currency)} of this gift was refunded. Net gift: <strong>{formatMoney(net, d.currency)}</strong>.
          </div>
        )}
        {d.status === "DISPUTED" && <div className="mt-6 rounded-md bg-bad-soft px-4 py-3 text-sm text-bad">This gift is under a payment dispute.</div>}
        {/* Only the church's own wording; the platform makes no tax claims. */}
        {d.org.receiptStatement && <p className="mt-8 border-t border-line pt-6 text-sm whitespace-pre-line text-ink-2">{d.org.receiptStatement}</p>}
      </Card>
    </PublicShell>
  );
}
