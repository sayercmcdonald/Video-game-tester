import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { zName } from "@/lib/validation";

export const postSchema = z.object({
  title: zName("Title", 200),
  body: z.string().trim().min(1, "Write something to share.").max(20_000, "That's too long."),
  audience: z.enum(["TEAM", "PUBLIC"]),
});

/**
 * Team announcements publish immediately. Donor-facing (public) updates from
 * leaders wait for a church admin's approval, so nothing private is shared by accident.
 */
export async function createPost(t: TripContext, input: z.input<typeof postSchema>) {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators can post updates.");
  const d = postSchema.parse(input);
  const publishNow = d.audience === "TEAM" || t.perms.publishPublicUpdates;
  const post = await db.post.create({
    data: {
      orgId: t.org.id,
      tripId: t.trip.id,
      authorId: t.user.id,
      audience: d.audience,
      title: d.title,
      body: d.body,
      status: publishNow ? "PUBLISHED" : "PENDING_APPROVAL",
      publishedAt: publishNow ? new Date() : null,
      approvedById: publishNow && d.audience === "PUBLIC" ? t.user.id : null,
    },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "post.created", entityType: "Post", entityId: post.id, metadata: { audience: d.audience, status: post.status } });
  if (post.status === "PUBLISHED") await announce(t, post.id);
  else {
    const admins = await db.membership.findMany({ where: { orgId: t.org.id, role: "ADMIN" }, select: { userId: true } });
    await notifyUsers({
      userIds: admins.map((a) => a.userId),
      orgId: t.org.id,
      title: "Donor update awaiting approval",
      body: `${t.user.name} wrote a public update for ${t.trip.name}: "${post.title}". Review it before it's shared with donors.`,
      href: `/o/${t.org.slug}/trips/${t.trip.id}/updates`,
      category: "announcements",
    });
  }
  return post;
}

async function announce(t: TripContext, postId: string) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const team = await db.tripMember.findMany({ where: { tripId: t.trip.id, status: "APPROVED" }, select: { userId: true } });
  await notifyUsers({
    userIds: team.map((m) => m.userId).filter((id) => id !== post.authorId),
    orgId: t.org.id,
    title: `${t.trip.name}: ${post.title}`,
    body: post.body.length > 600 ? `${post.body.slice(0, 600)}…` : post.body,
    href: `/o/${t.org.slug}/trips/${t.trip.id}/updates`,
    category: "announcements",
    dedupePrefix: `post:${post.id}`,
  });
}

export async function approvePost(t: TripContext, postId: string) {
  assertPerm(t.perms.publishPublicUpdates, "Only church administrators can approve donor updates.");
  const post = await db.post.findFirst({ where: { id: postId, tripId: t.trip.id, orgId: t.org.id } });
  if (!post) throw notFound("Update");
  if (post.status !== "PENDING_APPROVAL") throw invalid("This update isn't waiting for approval.");
  await db.post.update({ where: { id: post.id }, data: { status: "PUBLISHED", publishedAt: new Date(), approvedById: t.user.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "post.approved", entityType: "Post", entityId: post.id });
  await announce(t, post.id);
}

export async function deletePost(t: TripContext, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, tripId: t.trip.id, orgId: t.org.id } });
  if (!post) throw notFound("Update");
  assertPerm(t.perms.isOrgAdmin || (t.perms.manage && post.authorId === t.user.id));
  await db.post.delete({ where: { id: post.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "post.deleted", entityType: "Post", entityId: post.id, metadata: { title: post.title } });
}

export async function tripPosts(t: TripContext) {
  if (!t.perms.viewTeam) return [];
  return db.post.findMany({
    where: {
      tripId: t.trip.id,
      orgId: t.org.id,
      // Pending public updates are visible only to people who manage the trip.
      ...(t.perms.manage ? {} : { status: "PUBLISHED" }),
    },
    orderBy: [{ status: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
}
