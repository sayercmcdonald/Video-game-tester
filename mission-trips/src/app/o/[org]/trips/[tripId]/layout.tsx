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
      <div className="mb-1 text-sm text-ink-3">
        <Link href={`/o/${t.org.slug}/trips`} className="hover:underline">
          Trips
        </Link>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t.trip.name}</h1>
        <div className="flex items-center gap-2">
          {t.perms.isLeader && <Badge tone="accent">You lead this trip</Badge>}
          <Badge tone={tripStatusTone[t.trip.status]}>{tripStatusLabel[t.trip.status]}</Badge>
        </div>
      </div>
      <p className="mt-1 text-ink-2">
        {t.trip.destination} · {formatDateRange(t.trip.startDate, t.trip.endDate)}
      </p>
      <div className="mt-5 mb-6 border-b border-line">
        <Tabs items={tabs} />
      </div>
      {children}
    </div>
  );
}
