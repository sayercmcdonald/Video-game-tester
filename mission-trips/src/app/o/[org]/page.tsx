import Link from "next/link";
import { pageOrg } from "@/server/page-guard";
import { orgDashboard } from "@/server/services/dashboards";
import { db } from "@/server/db";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { GoalMeter } from "@/components/charts";
import { formatMoney, percent } from "@/lib/money";
import { formatDate, formatDateRange, daysUntil } from "@/lib/dates";
import { tripStatusLabel, tripStatusTone, memberStatusLabel, memberStatusTone } from "@/lib/labels";

export const metadata = { title: "Dashboard" };

export default async function OrgDashboardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrg(org);
  if (!ctx.isAdmin) return <MemberHome orgId={ctx.org.id} userId={ctx.user.id} orgSlug={ctx.org.slug} orgName={ctx.org.name} />;

  const d = await orgDashboard(ctx);
  const base = `/o/${ctx.org.slug}`;
  const cur = ctx.org.currency;
  const attention = [
    d.applications > 0 && { label: `${d.applications} application${d.applications === 1 ? "" : "s"} waiting for a decision`, href: `${base}/trips` },
    d.pendingReviews > 0 && { label: `${d.pendingReviews} submitted requirement${d.pendingReviews === 1 ? "" : "s"} to review`, href: `${base}/trips` },
    d.pendingPosts > 0 && { label: `${d.pendingPosts} donor update${d.pendingPosts === 1 ? "" : "s"} awaiting approval`, href: `${base}/trips` },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <>
      <PageHeader title="Dashboard" description={`Everything happening across ${ctx.org.name}'s trips.`} actions={<LinkButton href={`${base}/trips/new`}>New trip</LinkButton>} />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Gifts received" value={formatMoney(d.orgTotals.raised, cur)} sub="After refunds" />
          <Stat label="Processing fees" value={formatMoney(d.orgTotals.fees, cur)} sub={`Net ${formatMoney(d.orgTotals.netRaised, cur)}`} />
          <Stat label="Outstanding pledges" value={formatMoney(d.pledgesOpenCents, cur)} sub={`${d.pledgesOpenCount} open · not yet received`} />
          <Stat label="Spent" value={formatMoney(d.orgTotals.expenses, cur)} sub={`Balance ${formatMoney(d.orgTotals.balance, cur)}`} />
        </CardBody>
      </Card>

      {attention.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Needs your attention" />
          <ul className="divide-y divide-line">
            {attention.map((a) => (
              <li key={a.label}>
                <Link href={a.href} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-subtle/60">
                  <span>{a.label}</span>
                  <span aria-hidden className="text-ink-3">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader title="Active and upcoming trips" description="Fundraising, spending and team readiness." />
        {d.tripRows.length === 0 ? (
          <EmptyState title="No active trips" action={<LinkButton href={`${base}/trips/new`}>Create your first trip</LinkButton>}>
            Create a trip to set dates, a budget and fundraising goals, then invite leaders and participants.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Trip</Th>
                <Th className="w-[28%]">Fundraising</Th>
                <Th className="text-right">Budget used</Th>
                <Th className="text-right">Team</Th>
              </tr>
            </thead>
            <tbody>
              {d.tripRows.map(({ trip, totals, paidCents, participants, incomplete }) => (
                <tr key={trip.id}>
                  <Td>
                    <Link href={`${base}/trips/${trip.id}`} className="font-medium hover:underline">
                      {trip.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-ink-3">
                      <Badge tone={tripStatusTone[trip.status]}>{tripStatusLabel[trip.status]}</Badge>
                      <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
                    </div>
                  </Td>
                  <Td>
                    <GoalMeter raised={totals.raised} goal={trip.fundraisingGoalCents} currency={cur} label={`${trip.name} fundraising`} />
                    <div className="mt-1 text-xs text-ink-3 tabular-nums">
                      {formatMoney(totals.raised, cur, { compact: true })} of {formatMoney(trip.fundraisingGoalCents, cur, { compact: true })} ·{" "}
                      {percent(totals.raised, trip.fundraisingGoalCents)}%
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(paidCents, cur, { compact: true })}
                    <div className="text-xs text-ink-3">of {formatMoney(trip.budgetCents, cur, { compact: true })}</div>
                  </Td>
                  <Td className="text-right">
                    <span className="tabular-nums">{participants}</span>
                    {trip.participantLimit ? <span className="text-ink-3"> / {trip.participantLimit}</span> : null}
                    {incomplete > 0 ? <div className="text-xs text-warn">{incomplete} not ready</div> : participants > 0 ? <div className="text-xs text-good">All ready</div> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming deadlines" />
          {d.upcomingDeadlines.length === 0 ? (
            <EmptyState title="No upcoming deadlines">Add requirements with due dates to a trip to track them here.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {d.upcomingDeadlines.map((r) => {
                const days = daysUntil(r.dueDate!);
                return (
                  <li key={r.id}>
                    <Link href={`${base}/trips/${r.trip.id}/requirements`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-subtle/60">
                      <span className="min-w-0">
                        <span className="font-medium">{r.title}</span>
                        <span className="block truncate text-ink-3">{r.trip.name}</span>
                      </span>
                      <Badge tone={days <= 3 ? "warn" : "neutral"}>{days === 0 ? "Today" : `${formatDate(r.dueDate)}`}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent gifts" action={<LinkButton href={`${base}/donations`} variant="ghost">All donations</LinkButton>} />
          {d.recentGifts.length === 0 ? (
            <EmptyState title="No gifts yet">Gifts appear here once they are received — online gifts after Stripe confirms payment.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {d.recentGifts.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{g.donorName}</span>
                    {g.isAnonymous && <span className="text-ink-3"> (anonymous publicly)</span>}
                    <span className="block truncate text-ink-3">{g.campaign.title}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatMoney(g.amountCents, g.currency)}
                    <span className="block text-xs text-ink-3">{formatDate(g.receivedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

async function MemberHome({ orgId, userId, orgSlug, orgName }: { orgId: string; userId: string; orgSlug: string; orgName: string }) {
  const tms = await db.tripMember.findMany({
    where: { orgId, userId, status: { notIn: ["DECLINED", "WITHDRAWN"] } },
    include: { trip: true },
    orderBy: { trip: { startDate: "asc" } },
  });
  const openTrips = await db.trip.findMany({
    where: { orgId, status: "OPEN", applicationsOpen: true, id: { notIn: tms.map((t) => t.tripId) } },
    orderBy: { startDate: "asc" },
  });
  return (
    <>
      <PageHeader title={orgName} description="Your trips with this church." />
      <Card className="mb-6">
        <CardHeader title="My trips" />
        {tms.length === 0 ? (
          <EmptyState title="You're not on a trip yet">Apply to an open trip below, or ask a leader to invite you.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {tms
              .filter((tm) => tm.trip.status !== "DRAFT" || tm.role === "LEADER")
              .map((tm) => (
                <li key={tm.id}>
                  <Link href={`/o/${orgSlug}/trips/${tm.tripId}`} className="flex items-center justify-between px-5 py-4 hover:bg-subtle/60">
                    <span>
                      <span className="font-medium">{tm.trip.name}</span>
                      <span className="block text-sm text-ink-3">
                        {tm.trip.destination} · {formatDateRange(tm.trip.startDate, tm.trip.endDate)}
                      </span>
                    </span>
                    <Badge tone={memberStatusTone[tm.status]}>{tm.role === "LEADER" ? "Leader" : memberStatusLabel[tm.status]}</Badge>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Card>
      {openTrips.length > 0 && (
        <Card>
          <CardHeader title="Open for applications" />
          <ul className="divide-y divide-line">
            {openTrips.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <span>
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-sm text-ink-3">
                    {t.destination} · {formatDateRange(t.startDate, t.endDate)}
                  </span>
                </span>
                <LinkButton href={`/apply/${orgSlug}/${t.id}`} variant="secondary">
                  Apply
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
