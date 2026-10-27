import "server-only";
import { db } from "../db";
import { tripPermissions } from "../permissions";
import { financialSummary } from "./finance";
import { raisedByCampaign } from "./ledger";
import { tripReadiness } from "./requirements";
import { formatMoney } from "@/lib/money";
import { daysUntil, formatDate } from "@/lib/dates";
import { expenseCategoryLabel } from "@/lib/labels";

// "Needs attention": rule-based, explainable alerts computed from real records.
// Every alert says what was found and why it matters, with the numbers that
// triggered it. Nothing here changes data; acting on an alert is always a
// separate, deliberate step by a person.

export type Severity = "urgent" | "soon" | "fyi";
export type AlertKind =
  | "overdue"
  | "due_soon"
  | "reviews"
  | "applications"
  | "fundraising_behind"
  | "budget_over"
  | "shortfall"
  | "expense_approvals"
  | "refunds"
  | "departure";

export type Alert = {
  id: string;
  kind: AlertKind;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
  /** Who should see it: anyone managing the trip, or only people who can see finances / approve. */
  audience: "manage" | "finances" | "admin";
};

// ── Thresholds (documented in docs/ARCHITECTURE.md) ──
export const RULES = {
  dueSoonDays: 7,
  /** Participant fundraising is due this many days before departure. */
  fundraisingDueDaysBeforeDeparture: 14,
  /** Flag when a participant is this far (share of goal) behind an even pace… */
  paceToleranceShare: 0.15,
  /** …once at least this share of their fundraising window has passed. */
  paceMinElapsedShare: 0.25,
  departureWarningDays: 30,
  recentFinancialDays: 30,
};

export const severityRank: Record<Severity, number> = { urgent: 0, soon: 1, fyi: 2 };

// ── Pure rules (unit-tested) ──

export type PaceInput = { raisedCents: number; goalCents: number; windowStart: Date; deadline: Date; now: Date };
export type PaceResult =
  | { status: "on_track" | "no_goal" | "too_early" }
  | { status: "behind"; expectedCents: number; elapsedShare: number }
  | { status: "missed"; shortCents: number };

/** Compares money received with an even pace from approval to the fundraising deadline. */
export function fundraisingPace({ raisedCents, goalCents, windowStart, deadline, now }: PaceInput): PaceResult {
  if (goalCents <= 0) return { status: "no_goal" };
  if (raisedCents >= goalCents) return { status: "on_track" };
  if (now >= deadline) return { status: "missed", shortCents: goalCents - raisedCents };
  const span = deadline.getTime() - windowStart.getTime();
  if (span <= 0) return { status: "too_early" };
  const elapsedShare = Math.min(1, Math.max(0, (now.getTime() - windowStart.getTime()) / span));
  if (elapsedShare < RULES.paceMinElapsedShare) return { status: "too_early" };
  const expectedCents = Math.round(goalCents * elapsedShare);
  if (raisedCents < expectedCents - goalCents * RULES.paceToleranceShare) return { status: "behind", expectedCents, elapsedShare };
  return { status: "on_track" };
}

export function fundraisingDeadline(tripStart: Date): Date {
  return new Date(tripStart.getTime() - RULES.fundraisingDueDaysBeforeDeparture * 86_400_000);
}

export type BudgetLineFacts = { category: keyof typeof expenseCategoryLabel; budgetCents: number; committedCents: number; paidCents: number };

/** Categories where approved spending (paid + committed) exceeds the planned budget. */
export function budgetOverruns(lines: BudgetLineFacts[]) {
  return lines
    .filter((l) => l.budgetCents > 0 && l.paidCents + l.committedCents > l.budgetCents)
    .map((l) => ({ ...l, usedCents: l.paidCents + l.committedCents, overCents: l.paidCents + l.committedCents - l.budgetCents }));
}

function names(list: string[], max = 3) {
  return list.length <= max ? list.join(", ") : `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Loader ──

export async function tripAlerts(tripId: string, orgId: string, now = new Date()): Promise<Alert[]> {
  const trip = await db.trip.findFirstOrThrow({ where: { id: tripId, orgId }, include: { org: { select: { slug: true, currency: true } } } });
  const base = `/o/${trip.org.slug}/trips/${trip.id}`;
  const cur = trip.org.currency;
  const alerts: Alert[] = [];
  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") return alerts;

  const [readiness, applications, reviews, campaigns, summary, refunds, disputes] = await Promise.all([
    tripReadiness(trip.id, orgId),
    db.tripMember.count({ where: { tripId, status: "APPLIED" } }),
    db.requirementSubmission.count({ where: { status: "SUBMITTED", requirement: { tripId } } }),
    db.campaign.findMany({ where: { tripId, kind: "PARTICIPANT", tripMember: { status: "APPROVED" } }, include: { tripMember: { include: { user: { select: { name: true } } } } } }),
    financialSummary(trip.id, orgId),
    db.donation.aggregate({ where: { tripId, refundedCents: { gt: 0 }, updatedAt: { gte: new Date(now.getTime() - RULES.recentFinancialDays * 86_400_000) } }, _count: true, _sum: { refundedCents: true } }),
    db.donation.count({ where: { tripId, status: "DISPUTED" } }),
  ]);

  // Requirements: overdue and due soon, per requirement, naming who is outstanding.
  for (const r of readiness.requirements) {
    if (!r.isRequired || !r.dueDate) continue;
    const outstanding = readiness.rows.filter((row) => row.cells.find((c) => c.requirement.id === r.id)?.state !== "APPROVED").map((row) => row.member.user.name);
    if (outstanding.length === 0) continue;
    const days = daysUntil(r.dueDate, now);
    if (days < 0) {
      alerts.push({
        id: `overdue:${r.id}`,
        kind: "overdue",
        severity: "urgent",
        title: `${r.title} is overdue for ${plural(outstanding.length, "person", "people")}`,
        detail: `Due ${formatDate(r.dueDate)}. Still outstanding: ${names(outstanding)}.`,
        href: `${base}/requirements`,
        audience: "manage",
      });
    } else if (days <= RULES.dueSoonDays) {
      alerts.push({
        id: `due:${r.id}`,
        kind: "due_soon",
        severity: "soon",
        title: `${r.title} is due ${days === 0 ? "today" : `in ${plural(days, "day")}`}`,
        detail: `${plural(outstanding.length, "person", "people")} haven't finished it: ${names(outstanding)}.`,
        href: `${base}/requirements`,
        audience: "manage",
      });
    }
  }

  if (reviews > 0) {
    alerts.push({ id: "reviews", kind: "reviews", severity: "soon", title: `${plural(reviews, "submission")} waiting for review`, detail: "Participants can't be marked ready until a leader reviews them.", href: `${base}/requirements`, audience: "manage" });
  }
  if (applications > 0) {
    alerts.push({ id: "applications", kind: "applications", severity: "soon", title: `${plural(applications, "application")} waiting for a decision`, detail: "Approving someone creates their support page and checklist.", href: `${base}/team`, audience: "manage" });
  }

  // Departure approaching with people not ready.
  const daysToDeparture = daysUntil(trip.startDate, now);
  const notReady = readiness.rows.filter((r) => r.percent < 100).map((r) => r.member.user.name);
  if (daysToDeparture >= 0 && daysToDeparture <= RULES.departureWarningDays && notReady.length > 0) {
    alerts.push({
      id: "departure",
      kind: "departure",
      severity: "urgent",
      title: `Departure in ${plural(daysToDeparture, "day")}; ${plural(notReady.length, "person", "people")} not ready`,
      detail: `Required items are still outstanding for ${names(notReady)}.`,
      href: `${base}/requirements`,
      audience: "manage",
    });
  }

  // Participant fundraising pace.
  const raised = await raisedByCampaign(campaigns.map((c) => c.id));
  const deadline = fundraisingDeadline(trip.startDate);
  for (const c of campaigns) {
    if (!c.tripMember) continue;
    const r = raised.get(c.id) ?? 0;
    const pace = fundraisingPace({ raisedCents: r, goalCents: c.goalCents, windowStart: c.tripMember.decidedAt ?? c.createdAt, deadline, now });
    const who = c.tripMember.user.name;
    if (pace.status === "behind") {
      alerts.push({
        id: `pace:${c.id}`,
        kind: "fundraising_behind",
        severity: "soon",
        title: `${who} is behind on fundraising`,
        detail: `Received ${formatMoney(r, cur)} of ${formatMoney(c.goalCents, cur)} (${Math.round((r / c.goalCents) * 100)}%). ${Math.round(pace.elapsedShare * 100)}% of the time until the fundraising deadline (${formatDate(deadline)}) has passed, so an even pace would be about ${formatMoney(pace.expectedCents, cur)}.`,
        href: `${base}/fundraising`,
        audience: "manage",
      });
    } else if (pace.status === "missed") {
      alerts.push({
        id: `pace:${c.id}`,
        kind: "fundraising_behind",
        severity: "urgent",
        title: `${who} is ${formatMoney(pace.shortCents, cur)} short of their goal`,
        detail: `The fundraising deadline (${formatDate(deadline)}, ${RULES.fundraisingDueDaysBeforeDeparture} days before departure) has passed with ${formatMoney(r, cur)} of ${formatMoney(c.goalCents, cur)} received.`,
        href: `${base}/fundraising`,
        audience: "manage",
      });
    }
  }

  // Money.
  for (const o of budgetOverruns(summary.categories)) {
    alerts.push({
      id: `budget:${o.category}`,
      kind: "budget_over",
      severity: "soon",
      title: `${expenseCategoryLabel[o.category]} is over budget by ${formatMoney(o.overCents, cur)}`,
      detail: `Approved spending is ${formatMoney(o.usedCents, cur)} (${formatMoney(o.paidCents, cur)} paid, ${formatMoney(o.committedCents, cur)} committed) against a budget of ${formatMoney(o.budgetCents, cur)}.`,
      href: `${base}/finances`,
      audience: "finances",
    });
  }
  const afterCommitments = summary.totals.balance - summary.committedCents;
  if (afterCommitments < 0) {
    alerts.push({
      id: "shortfall",
      kind: "shortfall",
      severity: "urgent",
      title: `Committed spending exceeds funds by ${formatMoney(-afterCommitments, cur)}`,
      detail: `Available now: ${formatMoney(summary.totals.balance, cur)}. Approved but unpaid: ${formatMoney(summary.committedCents, cur)}.${summary.pledgesOpenCents ? ` Open pledges of ${formatMoney(summary.pledgesOpenCents, cur)} are not counted until received.` : ""}`,
      href: `${base}/finances`,
      audience: "finances",
    });
  }
  if (summary.pendingApprovalCount > 0) {
    alerts.push({
      id: "expense_approvals",
      kind: "expense_approvals",
      severity: "soon",
      title: `${plural(summary.pendingApprovalCount, "expense")} waiting for approval`,
      detail: `${formatMoney(summary.pendingApprovalCents, cur)} submitted by trip leaders. It isn't counted until approved.`,
      href: `${base}/finances`,
      audience: "admin",
    });
  }
  if (disputes > 0) {
    alerts.push({ id: "disputes", kind: "refunds", severity: "urgent", title: `${plural(disputes, "gift")} under a payment dispute`, detail: "A donor's bank has withdrawn these funds pending review. Respond in your Stripe dashboard.", href: `${base}/fundraising`, audience: "admin" });
  }
  if (refunds._count > 0) {
    alerts.push({
      id: "refunds",
      kind: "refunds",
      severity: "fyi",
      title: `${plural(refunds._count, "gift")} refunded in the last ${RULES.recentFinancialDays} days`,
      detail: `${formatMoney(refunds._sum.refundedCents ?? 0, cur)} returned to donors.`,
      href: `${base}/fundraising`,
      audience: "finances",
    });
  }

  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/** Filters alerts to what this person may see on this trip. */
export function visibleAlerts(alerts: Alert[], perms: { manage: boolean; viewFinances: boolean; administerFinances: boolean }) {
  return alerts.filter((a) => (a.audience === "manage" ? perms.manage : a.audience === "finances" ? perms.viewFinances : perms.administerFinances));
}

/** Church-wide view for administrators: every active trip's alerts, most urgent first. */
export async function orgAlerts(orgId: string, now = new Date()) {
  const trips = await db.trip.findMany({ where: { orgId, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } }, select: { id: true, name: true } });
  const all = await Promise.all(trips.map(async (t) => (await tripAlerts(t.id, orgId, now)).map((a) => ({ ...a, tripName: t.name }))));
  return all.flat().sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/** For a trip page: computes and filters alerts for the current person. */
export async function alertsForViewer(t: { trip: { id: string }; org: { id: string }; perms: ReturnType<typeof tripPermissions> }) {
  return visibleAlerts(await tripAlerts(t.trip.id, t.org.id), t.perms);
}
