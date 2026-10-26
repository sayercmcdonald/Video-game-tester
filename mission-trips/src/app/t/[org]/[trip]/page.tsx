import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { raisedByCampaign } from "@/server/services/ledger";
import { givingAvailability } from "@/server/services/donations";
import type { ReportSnapshot } from "@/server/services/finance";
import { PublicShell } from "@/components/public-shell";
import { Badge, Card, CardBody, CardHeader, LinkButton, Stat } from "@/components/ui";
import { BulletChart, GoalMeter } from "@/components/charts";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateRange } from "@/lib/dates";
import { expenseCategoryLabel, tripStatusLabel } from "@/lib/labels";

type Props = { params: Promise<{ org: string; trip: string }> };

async function load(orgSlug: string, tripSlug: string) {
  return db.trip.findFirst({
    where: { slug: tripSlug, org: { slug: orgSlug, status: "ACTIVE" }, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] } },
    include: { org: true },
  });
}

export async function generateMetadata({ params }: Props) {
  const { org, trip } = await params;
  const t = await load(org, trip);
  return { title: t ? `${t.name} — ${t.org.name}` : "Trip" };
}

// Public page: only approved public updates and reports that a church admin
// chose to publish. Nothing private about participants or donors appears here.
export default async function PublicTripPage({ params }: Props) {
  const { org, trip: slug } = await params;
  const trip = await load(org, slug);
  if (!trip) notFound();
  const [posts, reports, campaigns] = await Promise.all([
    db.post.findMany({ where: { tripId: trip.id, audience: "PUBLIC", status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 20 }),
    db.financialReport.findMany({ where: { tripId: trip.id }, orderBy: { publishedAt: "desc" } }),
    db.campaign.findMany({ where: { tripId: trip.id, kind: { in: ["TRIP", "PROJECT"] }, isPublic: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const raised = await raisedByCampaign(campaigns.map((c) => c.id));
  const latest = reports[0];
  const snap = latest?.snapshot as unknown as ReportSnapshot | undefined;
  const giving = givingAvailability(trip.org);

  return (
    <PublicShell orgName={trip.org.name}>
      <div className="mb-8">
        <Badge>{tripStatusLabel[trip.status]}</Badge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{trip.name}</h1>
        <p className="mt-1 text-ink-2">
          {trip.destination} · {formatDateRange(trip.startDate, trip.endDate)}
        </p>
        {trip.summary && <p className="mt-4 max-w-2xl text-[17px] leading-relaxed whitespace-pre-line text-ink-2">{trip.summary}</p>}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {latest && snap && (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {latest.title} {latest.isFinal && <Badge tone="good">Final report</Badge>}
                  </span>
                }
                description={`Published by ${trip.org.name} on ${formatDate(latest.publishedAt)}. Figures as of that date.`}
              />
              <CardBody className="space-y-5">
                {latest.narrative && <p className="whitespace-pre-line text-ink-2">{latest.narrative}</p>}
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                  <Stat label="Given" value={formatMoney(snap.raisedCents, snap.currency)} sub={`${snap.giftCount} gifts`} />
                  <Stat label="Processing fees" value={formatMoney(snap.feesCents, snap.currency)} />
                  <Stat label="Spent" value={formatMoney(snap.spentCents, snap.currency)} sub={snap.committedCents ? `${formatMoney(snap.committedCents, snap.currency)} committed` : undefined} />
                  <Stat label="Remaining" value={formatMoney(snap.remainingCents, snap.currency)} />
                </div>
                {snap.spendingByCategory.length > 0 && (
                  <BulletChart
                    rows={snap.spendingByCategory.map((c) => ({ label: expenseCategoryLabel[c.category], primary: c.paidCents, target: c.budgetCents }))}
                    primaryLabel="Spent"
                    targetLabel="Budget"
                    currency={snap.currency}
                    caption="How funds were spent by category"
                  />
                )}
              </CardBody>
            </Card>
          )}
          <section>
            <h2 className="mb-3 text-lg font-semibold">Updates</h2>
            {posts.length === 0 ? (
              <p className="text-ink-3">No updates have been shared yet.</p>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <Card key={p.id}>
                    <CardBody>
                      <h3 className="font-semibold">{p.title}</h3>
                      <div className="text-xs text-ink-3">{formatDate(p.publishedAt)}</div>
                      <p className="mt-2 whitespace-pre-line text-ink-2">{p.body}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </section>
          {reports.length > 1 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Earlier reports</h2>
              <ul className="space-y-1 text-sm text-ink-2">
                {reports.slice(1).map((r) => (
                  <li key={r.id}>
                    {r.title} · {formatDate(r.publishedAt)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="space-y-4">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardBody className="space-y-3">
                <div className="font-medium">{c.title}</div>
                <GoalMeter raised={raised.get(c.id) ?? 0} goal={c.goalCents} currency={trip.org.currency} label={`${c.title} progress`} />
                <div className="text-sm text-ink-2 tabular-nums">
                  {formatMoney(raised.get(c.id) ?? 0, trip.org.currency)} of {formatMoney(c.goalCents, trip.org.currency)}
                </div>
                {giving.enabled && !c.isClosed && trip.status !== "COMPLETED" && (
                  <LinkButton href={`/give/${trip.org.slug}/${c.slug}`} className="w-full">
                    Give
                  </LinkButton>
                )}
              </CardBody>
            </Card>
          ))}
          {trip.applicationsOpen && trip.status === "OPEN" && (
            <Card>
              <CardBody className="space-y-2">
                <div className="font-medium">Want to go?</div>
                <p className="text-sm text-ink-2">Applications are open.</p>
                <Link href={`/apply/${trip.org.slug}/${trip.id}`} className="text-sm font-medium text-accent hover:underline">
                  Apply to join the team →
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
