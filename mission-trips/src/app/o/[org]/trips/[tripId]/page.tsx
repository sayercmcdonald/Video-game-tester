import Link from "next/link";
import { pageTrip } from "@/server/page-guard";
import type { TripContext } from "@/server/context";
import { participantDashboard } from "@/server/services/dashboards";
import { tripReadiness } from "@/server/services/requirements";
import { tripCampaignsWithProgress } from "@/server/services/campaigns";
import { financialSummary } from "@/server/services/finance";
import { allowedStatusChanges } from "@/server/services/trips";
import { givingAvailability } from "@/server/services/donations";
import { db } from "@/server/db";
import { alertsForViewer } from "@/server/services/insights";
import { AlertList } from "@/components/alert-list";
import { appUrl } from "@/server/email";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, LinkButton, Progress, Stat } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { GoalMeter, Legend } from "@/components/charts";
import { CopyLink } from "@/components/copy-link";
import { formatMoney, percent } from "@/lib/money";
import { daysUntil, formatDate, formatDateTime } from "@/lib/dates";
import { submissionStatusLabel, submissionStatusTone, tripStatusLabel, memberStatusLabel, itineraryKindLabel } from "@/lib/labels";
import { setTripStatusAction } from "../../actions";

export default async function TripOverviewPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (t.perms.manage) return <ManagerOverview t={t} />;
  if (t.perms.isParticipant) return <ParticipantOverview t={t} />;
  return <ApplicantOverview t={t} />;
}

function ApplicantOverview({ t }: { t: TripContext }) {
  const status = t.tripMember?.status ?? "APPLIED";
  return (
    <div className="max-w-2xl space-y-6">
      <Alert tone={status === "WAITLISTED" ? "info" : "warn"} title={`Application status: ${memberStatusLabel[status]}`}>
        {status === "WAITLISTED"
          ? "You're on the waitlist. A leader will contact you if a spot opens."
          : "Thanks for applying. A trip leader will review your application and you'll get a notification when there's a decision."}
      </Alert>
      {t.trip.summary && (
        <Card>
          <CardHeader title="About this trip" />
          <CardBody>
            <p className="whitespace-pre-line text-ink-2">{t.trip.summary}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

async function ParticipantOverview({ t }: { t: TripContext }) {
  const d = await participantDashboard(t);
  const base = `/o/${t.org.slug}/trips/${t.trip.id}`;
  const cur = t.org.currency;
  const remaining = d.campaign ? Math.max(0, d.campaign.goalCents - d.raisedCents) : 0;
  const giving = givingAvailability(t.org);
  const outstanding = d.checklist.filter((c) => c.requirement.isRequired && c.state !== "APPROVED");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="My fundraising" action={<LinkButton href={`${base}/fundraising`} variant="ghost">Details</LinkButton>} />
          <CardBody className="space-y-4">
            {d.campaign ? (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label="Received" value={formatMoney(d.raisedCents, cur)} />
                  <Stat label="Goal" value={formatMoney(d.campaign.goalCents, cur)} />
                  <Stat label="Still needed" value={formatMoney(remaining, cur)} tone={remaining === 0 ? "good" : undefined} />
                </div>
                <GoalMeter raised={d.raisedCents} pledged={d.pledgedCents} goal={d.campaign.goalCents} currency={cur} label="My fundraising progress" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Legend items={[{ label: "Received", swatch: "s1" }, ...(d.pledgedCents ? [{ label: `Pledged ${formatMoney(d.pledgedCents, cur)}`, swatch: "s2" as const }] : [])]} />
                  <span className="text-sm text-ink-3 tabular-nums">{percent(d.raisedCents, d.campaign.goalCents)}% of goal</span>
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-medium">Share your support page</div>
                  {giving.enabled ? (
                    <CopyLink url={appUrl(`/give/${t.org.slug}/${d.campaign.slug}`)} />
                  ) : (
                    <p className="text-sm text-ink-3">Your page will be shareable once {t.org.name} turns on online giving. {giving.reason}</p>
                  )}
                </div>
              </>
            ) : (
              <EmptyState title="No support page yet">Your support page is created when a leader approves you.</EmptyState>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent gifts" />
          {d.recentGifts.length === 0 ? (
            <EmptyState title="No gifts yet">Share your page with family, friends and your church. Gifts appear here once received.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {d.recentGifts.map((g) => (
                <li key={g.id} className="px-5 py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{g.donorName}</span>
                    <span className="tabular-nums">{formatMoney(g.amountCents, cur)}</span>
                  </div>
                  {g.message && <p className="mt-0.5 text-ink-2">“{g.message}”</p>}
                  <div className="text-xs text-ink-3">{formatDate(g.receivedAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Latest updates" action={<LinkButton href={`${base}/updates`} variant="ghost">All updates</LinkButton>} />
          {d.posts.length === 0 ? (
            <EmptyState title="No updates yet">Your leaders&apos; announcements will appear here.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {d.posts.map((p) => (
                <li key={p.id} className="px-5 py-4">
                  <div className="font-medium">{p.title}</div>
                  <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-ink-2">{p.body}</p>
                  <div className="mt-1 text-xs text-ink-3">{formatDateTime(p.publishedAt, t.org.timezone)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="My requirements" description={`${d.readiness}% complete`} />
          <CardBody>
            <Progress value={d.readiness} max={100} label="Requirements complete" tone={d.readiness === 100 ? "good" : "accent"} />
          </CardBody>
          {d.checklist.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-ink-3">Nothing required yet.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {d.checklist.map((c) => (
                <li key={c.requirement.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{c.requirement.title}</span>
                    {c.requirement.dueDate && <span className="text-xs text-ink-3">Due {formatDate(c.requirement.dueDate)}</span>}
                  </span>
                  <Badge tone={submissionStatusTone[c.state]}>{submissionStatusLabel[c.state]}</Badge>
                </li>
              ))}
            </ul>
          )}
          {outstanding.length > 0 && (
            <div className="border-t border-line px-5 py-3">
              <LinkButton href={`${base}/requirements`} className="w-full">
                Complete requirements
              </LinkButton>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Coming up" action={<LinkButton href={`${base}/itinerary`} variant="ghost">Itinerary</LinkButton>} />
          {d.nextEvents.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-3">No itinerary items yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.nextEvents.map((e) => (
                <li key={e.id} className="px-5 py-2.5 text-sm">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-ink-3">
                    {itineraryKindLabel[e.kind]} · {formatDateTime(e.startsAt, "UTC")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

async function ManagerOverview({ t }: { t: TripContext }) {
  const base = `/o/${t.org.slug}/trips/${t.trip.id}`;
  const cur = t.org.currency;
  const [readiness, campaigns, alerts, summary, deadlines] = await Promise.all([
    tripReadiness(t.trip.id, t.org.id),
    tripCampaignsWithProgress(t.trip.id, t.org.id),
    alertsForViewer(t),
    t.perms.viewFinances ? financialSummary(t.trip.id, t.org.id) : Promise.resolve(null),
    db.requirement.findMany({ where: { tripId: t.trip.id, isRequired: true, dueDate: { not: null } }, orderBy: { dueDate: "asc" } }),
  ]);
  const raised = campaigns.reduce((a, c) => a + c.raisedCents, 0);
  const participants = readiness.rows.length;
  const ready = readiness.rows.filter((r) => r.percent === 100).length;
  const nextDeadlines = deadlines.filter((r) => daysUntil(r.dueDate!) >= 0).slice(0, 4);
  const tripFund = campaigns.find((c) => c.kind === "TRIP");
  const giving = givingAvailability(t.org);
  const statusChoices = allowedStatusChanges(t.trip.status);

  return (
    <div className="space-y-6">
      {t.trip.status === "DRAFT" && (
        <Alert tone="info" title="This trip is a draft">
          Only church admins and trip leaders can see it. {t.perms.isOrgAdmin ? "Open it when you're ready to recruit and fundraise." : "A church admin can open it when it's ready."}
        </Alert>
      )}
      {alerts.length > 0 && (
        <Card>
          <CardHeader title="Needs attention" description="Found in this trip's records. Each item explains why it's here." />
          <AlertList alerts={alerts} />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Fundraising" action={<LinkButton href={`${base}/fundraising`} variant="ghost">Details</LinkButton>} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Received" value={formatMoney(raised, cur)} sub="After refunds" />
              <Stat label="Goal" value={formatMoney(t.trip.fundraisingGoalCents, cur)} />
              <Stat label="Pledged" value={summary ? formatMoney(summary.pledgesOpenCents, cur) : "—"} sub="Not yet received" />
              <Stat label="Spent" value={summary ? formatMoney(summary.totals.expenses, cur) : "—"} sub={summary ? `of ${formatMoney(t.trip.budgetCents, cur)} budget` : undefined} />
            </div>
            <GoalMeter raised={raised} pledged={summary?.pledgesOpenCents ?? 0} goal={t.trip.fundraisingGoalCents} currency={cur} label="Trip fundraising progress" />
            <Legend items={[{ label: "Received", swatch: "s1" }, ...(summary?.pledgesOpenCents ? [{ label: "Pledged", swatch: "s2" as const }] : [])]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Team readiness" action={<LinkButton href={`${base}/requirements`} variant="ghost">Details</LinkButton>} />
          <CardBody className="space-y-3">
            <Stat label="Ready to go" value={`${ready} of ${participants}`} sub="All required items complete" />
            <Progress value={ready} max={Math.max(participants, 1)} label="Participants ready" tone={participants > 0 && ready === participants ? "good" : "accent"} />
            {nextDeadlines.length > 0 && (
              <ul className="space-y-1.5 pt-2 text-sm">
                {nextDeadlines.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 text-ink-3">{formatDate(r.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Trip details" action={<LinkButton href={`${base}/settings`} variant="ghost">Edit</LinkButton>} />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Destination", value: t.trip.destination },
                { label: "Dates", value: `${formatDate(t.trip.startDate)} – ${formatDate(t.trip.endDate)}` },
                { label: "Participants", value: `${participants}${t.trip.participantLimit ? ` of ${t.trip.participantLimit}` : ""}` },
                { label: "Applications", value: t.trip.applicationsOpen ? "Open" : "Closed" },
              ]}
            />
            {t.trip.summary && <p className="mt-4 text-sm whitespace-pre-line text-ink-2">{t.trip.summary}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sharing" />
          <CardBody className="space-y-4">
            {!giving.enabled ? (
              <Alert tone="warn" title="Online giving is off">
                {giving.reason}
                {t.perms.isOrgAdmin && (
                  <>
                    {" "}
                    <Link href={`/o/${t.org.slug}/settings/payments`} className="underline">
                      Payment settings
                    </Link>
                  </>
                )}
              </Alert>
            ) : t.trip.status === "DRAFT" ? (
              <p className="text-sm text-ink-3">Giving pages go live when the trip is opened.</p>
            ) : (
              tripFund && (
                <div>
                  <div className="mb-1.5 text-sm font-medium">Team fund giving page</div>
                  <CopyLink url={appUrl(`/give/${t.org.slug}/${tripFund.slug}`)} />
                </div>
              )
            )}
            {t.trip.status !== "DRAFT" && (
              <div>
                <div className="mb-1.5 text-sm font-medium">Public trip page (updates &amp; reports)</div>
                <CopyLink url={appUrl(`/t/${t.org.slug}/${t.trip.slug}`)} />
              </div>
            )}
            {t.perms.isOrgAdmin && statusChoices.length > 0 && (
              <div className="border-t border-line pt-4">
                <div className="mb-2 text-sm font-medium">Trip status</div>
                <div className="flex flex-wrap gap-2">
                  {statusChoices.map((s) => (
                    <ActionButton
                      key={s}
                      action={setTripStatusAction.bind(null, t.org.slug, t.trip.id, s)}
                      variant={s === "CANCELLED" ? "danger" : "secondary"}
                      confirm={s === "CANCELLED" ? "Cancel this trip? Giving pages will stop accepting gifts." : undefined}
                    >
                      {s === "OPEN" && t.trip.status === "DRAFT" ? "Open trip" : `Mark ${tripStatusLabel[s].toLowerCase()}`}
                    </ActionButton>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
