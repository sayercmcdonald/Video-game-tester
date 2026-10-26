import "server-only";
import { db } from "./db";
import { appUrl, queueEmail } from "./email";

export type NotifyCategory = "donations" | "announcements" | "deadlines" | "account";

/**
 * In-app notification for each user, plus an email when the user's
 * preferences allow it. "account" emails (invites, approvals) always send.
 */
export async function notifyUsers(input: {
  userIds: string[];
  orgId: string | null;
  title: string;
  body: string;
  href?: string;
  category: NotifyCategory;
  emailSubject?: string;
  dedupePrefix?: string;
}) {
  let userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return;
  const dedupe = (userId: string) => (input.dedupePrefix ? `${input.dedupePrefix}:${userId}` : null);
  if (input.dedupePrefix) {
    // Skip anyone who already received this exact notification.
    const already = await db.notification.findMany({
      where: { dedupeKey: { in: userIds.map((id) => dedupe(id)!) } },
      select: { userId: true },
    });
    const done = new Set(already.map((a) => a.userId));
    userIds = userIds.filter((id) => !done.has(id));
    if (userIds.length === 0) return;
  }
  await db.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      orgId: input.orgId,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      dedupeKey: dedupe(userId),
    })),
    skipDuplicates: true,
  });

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, preferences: true },
  });
  for (const u of users) {
    const p = u.preferences;
    const wants =
      input.category === "account" ||
      (input.category === "donations" && (p?.emailDonations ?? true)) ||
      (input.category === "announcements" && (p?.emailAnnouncements ?? true)) ||
      (input.category === "deadlines" && (p?.emailDeadlines ?? true));
    if (!wants) continue;
    const link = input.href ? `\n\nOpen: ${appUrl(input.href)}` : "";
    await queueEmail({
      to: u.email,
      subject: input.emailSubject ?? input.title,
      text: `${input.body}${link}\n\nYou can change which emails you receive in your account settings.`,
      dedupeKey: input.dedupePrefix ? `${input.dedupePrefix}:${u.id}` : undefined,
    });
  }
}
