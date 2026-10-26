import "server-only";
import { db } from "../db";
import type { OrgContext, TripContext } from "../context";
import { ledgerTotals, raisedByCampaign } from "./ledger";
import { tripReadiness, myRequirements, readinessPercent } from "./requirements";

/** Church administrator overview across all trips. */
export async function orgDashboard(ctx: OrgContext) {
  const orgId = ctx.org.id;
  const trips = await db.trip.findMany({
    where: { orgId, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } },
    orderBy: { startDate: "asc" },
    include: { _count: { select: { members: { where: { role: "PARTICIPANT", status: "APPROVED" } } } } },
  });
  const [orgTotals, pledges, applications, recentGifts, pendingReviews, pendingPosts] = await Promise.all([
    ledgerTotals({ orgId }),
    db.pledge.aggregate({ where: { orgId, status: "OPEN" }, _sum: { amountCents: true }, _count: true }),
    db.tripMember.count({ where: { orgId, status: "APPLIED" } }),
    db.donation.findMany({
      where: { orgId, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"] } },
      orderBy: { receivedAt: "desc" },
      take: 6,
      include: { campaign: { select: { title: true } }, trip: { select: { name: true } } },
    }),
    db.requirementSubmission.count({ where: { orgId, status: "SUBMITTED" } }),
    db.post.count({ where: { orgId, status: "PENDING_APPROVAL" } }),
  ]);

  const tripRows = await Promise.all(
    trips.map(async (t) => {
      const [totals, paid, readiness] = await Promise.all([
        ledgerTotals({ tripId: t.id }),
        db.expense.aggregate({ where: { tripId: t.id, status: "PAID" }, _sum: { amountCents: true } }),
        tripReadiness(t.id, orgId),
      ]);
      const incomplete = readiness.rows.filter((r) => r.percent < 100).length;
      return { trip: t, totals, paidCents: paid._sum.amountCents ?? 0, participants: t._count.members, incomplete };
    }),
  );

  const upcomingDeadlines = await db.requirement.findMany({
    where: { orgId, isRequired: true, dueDate: { gte: startOfTodayUtc() }, trip: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
    orderBy: { dueDate: "asc" },
    take: 6,
    include: { trip: { select: { id: true, name: true } } },
  });

  return {
    tripRows,
    orgTotals,
    pledgesOpenCents: pledges._sum.amountCents ?? 0,
    pledgesOpenCount: pledges._count,
    applications,
    recentGifts,
    pendingReviews,
    pendingPosts,
    upcomingDeadlines,
  };
}

/** A participant's own view of a trip. */
export async function participantDashboard(t: TripContext) {
  const campaign = t.tripMember ? await db.campaign.findFirst({ where: { tripMemberId: t.tripMember.id, kind: "PARTICIPANT" } }) : null;
  const [raised, pledged, recentGifts, checklist, posts, nextEvents] = await Promise.all([
    campaign ? raisedByCampaign([campaign.id]) : Promise.resolve(new Map<string, number>()),
    campaign ? db.pledge.aggregate({ where: { campaignId: campaign.id, status: "OPEN" }, _sum: { amountCents: true } }) : Promise.resolve(null),
    campaign
      ? db.donation.findMany({
          where: { campaignId: campaign.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
          orderBy: { receivedAt: "desc" },
          take: 8,
          select: { id: true, donorName: true, isAnonymous: true, amountCents: true, receivedAt: true, message: true, method: true },
        })
      : Promise.resolve([]),
    myRequirements(t),
    db.post.findMany({ where: { tripId: t.trip.id, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 3 }),
    db.itineraryItem.findMany({ where: { tripId: t.trip.id, startsAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { startsAt: "asc" }, take: 4 }),
  ]);
  return {
    campaign,
    raisedCents: campaign ? (raised.get(campaign.id) ?? 0) : 0,
    pledgedCents: pledged?._sum.amountCents ?? 0,
    recentGifts,
    checklist,
    readiness: readinessPercent(checklist),
    posts,
    nextEvents,
  };
}

export function startOfTodayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
