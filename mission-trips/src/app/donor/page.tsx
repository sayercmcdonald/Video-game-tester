import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { GoalMeter } from "@/components/charts";
import { requireUser } from "@/server/context";
import { db } from "@/server/db";
import { raisedByCampaign } from "@/server/services/ledger";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { donationStatusLabel, donationStatusTone } from "@/lib/labels";

export const metadata = { title: "My giving" };

export default async function DonorPage() {
  const user = await requireUser();
  // Gifts made while signed in, plus gifts made with this (verified) email address.
  const donations = await db.donation.findMany({
    where: {
      status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "PENDING"] },
      OR: [{ donorUserId: user.id }, ...(user.emailVerifiedAt ? [{ donorEmail: user.email }] : [])],
      NOT: { status: "PENDING", stripePaymentIntentId: null }, // abandoned checkouts aren't gifts
    },
    orderBy: { createdAt: "desc" },
    include: { org: { select: { name: true, slug: true } }, campaign: true, trip: { select: { name: true, slug: true, status: true } } },
  });
  const campaignIds = [...new Set(donations.map((d) => d.campaignId))];
  const raised = await raisedByCampaign(campaignIds);
  const tripIds = [...new Set(donations.map((d) => d.tripId))];
  const updates = await db.post.findMany({
    where: { tripId: { in: tripIds }, audience: "PUBLIC", status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: 5,
    include: { trip: { select: { name: true, slug: true, org: { select: { slug: true } } } } },
  });
  const total = donations.filter((d) => d.status !== "PENDING").reduce((a, d) => a + d.amountCents - d.refundedCents, 0);

  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PageHeader title="My giving" description={donations.length ? `You've given ${formatMoney(total)} in total. Thank you.` : undefined} />
        {!user.emailVerifiedAt && (
          <div className="mb-6">
            <Alert tone="warn">Confirm your email address to see gifts you made without signing in.</Alert>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Gifts and receipts" />
            {donations.length === 0 ? (
              <EmptyState title="No gifts yet">Gifts you make with {user.email} will appear here with their receipts.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>To</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {donations.map((d) => (
                    <tr key={d.id}>
                      <Td className="whitespace-nowrap text-ink-2">{formatDate(d.receivedAt ?? d.createdAt)}</Td>
                      <Td label="To">
                        <div className="font-medium">{d.campaign.title}</div>
                        <div className="text-xs text-ink-3">{d.org.name}</div>
                      </Td>
                      <Td label="Amount" className="text-right tabular-nums">{formatMoney(d.amountCents, d.currency)}</Td>
                      <Td label="Status">
                        <Badge tone={donationStatusTone[d.status]}>{d.status === "PENDING" ? "Processing" : donationStatusLabel[d.status]}</Badge>
                      </Td>
                      <Td className="text-right">
                        {d.receiptNumber != null && (
                          <Link href={`/receipts/${d.id}`} className="text-sm text-accent hover:underline">
                            Receipt
                          </Link>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <div className="space-y-6">
            {campaignIds.length > 0 && (
              <Card>
                <CardHeader title="Campaigns you support" />
                <CardBody className="space-y-4">
                  {campaignIds.map((id) => {
                    const c = donations.find((d) => d.campaignId === id)!;
                    return (
                      <div key={id}>
                        <Link href={`/t/${c.org.slug}/${c.trip.slug}`} className="text-sm font-medium hover:underline">
                          {c.campaign.title}
                        </Link>
                        <div className="mt-1.5">
                          <GoalMeter raised={raised.get(id) ?? 0} goal={c.campaign.goalCents} label={`${c.campaign.title} progress`} />
                        </div>
                        <div className="mt-1 text-xs text-ink-3 tabular-nums">
                          {formatMoney(raised.get(id) ?? 0)} of {formatMoney(c.campaign.goalCents)}
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Updates from the field" />
              {updates.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-3">Updates shared by the trips you support will appear here.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {updates.map((p) => (
                    <li key={p.id} className="px-5 py-3">
                      <Link href={`/t/${p.trip.org.slug}/${p.trip.slug}`} className="text-sm font-medium hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-xs text-ink-3">
                        {p.trip.name} · {formatDate(p.publishedAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
