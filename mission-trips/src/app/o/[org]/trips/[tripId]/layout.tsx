import Link from "next/link";
import { pageTrip } from "@/server/page-guard";
import { db } from "@/server/db";
import { Tabs, type NavItem } from "@/components/nav";
import { Badge } from "@/components/ui";
import { formatDateRange } from "@/lib/dates";
import { tripStatusLabel, tripStatusTone } from "@/lib/labels";

export default async function TripLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  const base = `/o/${t.org.slug}/trips/${t.trip.id}`;
  const [applications, toReview, pendingPosts] = t.perms.manage
    ? await Promise.all([
        db.tripMember.count({ where: { tripId: t.trip.id, status: "APPLIED" } }),
        db.requirementSubmission.count({ where: { status: "SUBMITTED", requirement: { tripId: t.trip.id } } }),
        db.post.count({ where: { tripId: t.trip.id, status: "PENDING_APPROVAL" } }),
      ])
    : [0, 0, 0];

  const tabs: NavItem[] = [
    { href: base, label: "Overview", exact: true },
    ...(t.perms.viewTeam
      ? [
          { href: `${base}/team`, label: "Team", count: applications },
          { href: `${base}/fundraising`, label: "Fundraising" },
          { href: `${base}/requirements`, label: "Requirements", count: toReview },
          { href: `${base}/itinerary`, label: "Itinerary" },
          { href: `${base}/updates`, label: "Updates", count: t.perms.isOrgAdmin ? pendingPosts : 0 },
          { href: `${base}/documents`, label: "Documents" },
        ]
      : []),
    ...(t.perms.viewFinances ? [{ href: `${base}/finances`, label: "Finances" }] : []),
    ...(t.perms.manage ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  return (
    <div>
      <Link href={`/o/${t.org.slug}/trips`} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[17px] text-accent lg:min-h-0 lg:text-[15px]">
        <svg aria-hidden width="10" height="17" viewBox="0 0 10 17" className="mr-0.5">
          <path d="M8.5 1.5 1.5 8.5l7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Trips
      </Link>
      <h1 className="mt-1 text-[34px] leading-[1.12] font-bold tracking-tight lg:text-[28px]">{t.trip.name}</h1>
      <p className="mt-1 text-ink-2">
        {t.trip.destination} · {formatDateRange(t.trip.startDate, t.trip.endDate)}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={tripStatusTone[t.trip.status]}>{tripStatusLabel[t.trip.status]}</Badge>
        {t.perms.isLeader && <Badge tone="accent">You lead this trip</Badge>}
      </div>
      <div className="mt-5 mb-6">
        <Tabs items={tabs} />
      </div>
      {children}
    </div>
  );
}
