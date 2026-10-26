import "server-only";
import { db } from "./db";
import { deliverQueuedEmails } from "./email";
import { notifyUsers } from "./notify";
import { reconcilePendingDonations } from "./services/donations";
import { stripeConfigured, stripeGateway, type PaymentGateway } from "./payments/gateway";
import { daysUntil } from "@/lib/dates";

/**
 * Reminds participants about required items due in 7 days, 2 days, or today.
 * Each reminder is sent once (deduplicated by key), so the job can run as
 * often as you like.
 */
export async function sendDeadlineReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + 8 * 86_400_000);
  const reqs = await db.requirement.findMany({
    where: { isRequired: true, dueDate: { not: null, lte: horizon }, trip: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
    include: { trip: { include: { org: { select: { slug: true } } } } },
  });
  let sent = 0;
  for (const r of reqs) {
    const days = daysUntil(r.dueDate!, now);
    const bucket = days === 7 ? "7d" : days === 2 ? "2d" : days === 0 ? "0d" : null;
    if (!bucket) continue;
    const members = await db.tripMember.findMany({
      where: { tripId: r.tripId, role: "PARTICIPANT", status: "APPROVED" },
      include: { submissions: { where: { requirementId: r.id } } },
    });
    for (const m of members) {
      const s = m.submissions[0];
      if (s && (s.status === "APPROVED" || s.status === "SUBMITTED")) continue;
      await notifyUsers({
        userIds: [m.userId],
        orgId: r.orgId,
        title: days === 0 ? `Due today: ${r.title}` : `Due in ${days} days: ${r.title}`,
        body: `"${r.title}" for ${r.trip.name} is due ${days === 0 ? "today" : `in ${days} days`}.`,
        href: `/o/${r.trip.org.slug}/trips/${r.tripId}/requirements`,
        category: "deadlines",
        dedupePrefix: `deadline:${r.id}:${m.id}:${bucket}`,
      });
      sent++;
    }
  }
  return { reminders: sent };
}

export async function runAllJobs(gateway: PaymentGateway = stripeGateway) {
  const reminders = await sendDeadlineReminders();
  const reconcile = stripeConfigured() ? await reconcilePendingDonations(gateway) : { skipped: "stripe not configured" };
  const emails = await deliverQueuedEmails();
  // Expired sessions are useless; clean them up.
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { reminders, reconcile, emails, expiredSessionsRemoved: sessions.count };
}
