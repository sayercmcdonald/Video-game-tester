import Link from "next/link";
import { pageOrg } from "@/server/page-guard";
import { db } from "@/server/db";
import { raisedByCampaign } from "@/server/services/ledger";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { GoalMeter } from "@/components/charts";
import { formatDateRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { tripStatusLabel, tripStatusTone } from "@/lib/labels";

export const metadata = { title: "Trips" };

export default async function TripsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrg(org);
  const base = `/o/${ctx.org.slug}`;

  // Admins see every trip; others see trips they lead or belong to.
  const trips = await db.trip.findMany({
    where: ctx.isAdmin
      ? { orgId: ctx.org.id }
      : {
          orgId: ctx.org.id,
          members: { some: { userId: ctx.user.id, status: { notIn: ["DECLINED", "WITHDRAWN"] } } },
        },
    orderBy: [{ startDate: "desc" }],
    include: {
      campaigns: { select: { id: true } },
      members: { where: { status: { in: ["APPROVED", "APPLIED"] } }, select: { status: true, role: true, userId: true } },
    },
  });
  const visible = trips.filter((t) => ctx.isAdmin || t.status !== "DRAFT" || t.members.some((m) => m.userId === ctx.user.id && m.role === "LEADER"));
  const raised = await raisedByCampaign(visible.flatMap((t) => t.campaigns.map((c) => c.id)));

  return (
    <>
      <PageHeader title="Trips" actions={ctx.isAdmin ? <LinkButton href={`${base}/trips/new`}>New trip</LinkButton> : undefined} />
      <Card>
        {visible.length === 0 ? (
          <EmptyState title="No trips yet" action={ctx.isAdmin ? <LinkButton href={`${base}/trips/new`}>Create a trip</LinkButton> : undefined}>
            {ctx.isAdmin ? "Create a trip to start recruiting a team and raising support." : "Trips you join will appear here."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Trip</Th>
                <Th>Dates</Th>
                <Th className="w-[24%]">Raised</Th>
                <Th className="text-right">Team</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const tripRaised = t.campaigns.reduce((a, c) => a + (raised.get(c.id) ?? 0), 0);
                const approved = t.members.filter((m) => m.status === "APPROVED" && m.role === "PARTICIPANT").length;
                const applied = t.members.filter((m) => m.status === "APPLIED").length;
                return (
                  <tr key={t.id}>
                    <Td>
                      <Link href={`${base}/trips/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-ink-3">
                        <Badge tone={tripStatusTone[t.status]}>{tripStatusLabel[t.status]}</Badge>
                        <span className="truncate">{t.destination}</span>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateRange(t.startDate, t.endDate)}</Td>
                    <Td>
                      <GoalMeter raised={tripRaised} goal={t.fundraisingGoalCents} currency={ctx.org.currency} label={`${t.name} raised`} />
                      <div className="mt-1 text-xs text-ink-3 tabular-nums">
                        {formatMoney(tripRaised, ctx.org.currency, { compact: true })} of {formatMoney(t.fundraisingGoalCents, ctx.org.currency, { compact: true })}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {approved}
                      {t.participantLimit ? ` / ${t.participantLimit}` : ""}
                      {applied > 0 && (
                        <div>
                          <Badge tone="warn">{applied} to review</Badge>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
