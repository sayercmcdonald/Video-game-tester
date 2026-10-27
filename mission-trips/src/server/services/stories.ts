import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { canSeeStory, type FeedViewer } from "../permissions";
import { deleteObject, putObject } from "../storage";
import { MAX_MEDIA_PER_STORY, processPhoto, processPoster, processVideo, type ProcessedMedia } from "../media";
import { feedViewerFor, followerUserIds, teamUserIds } from "./followers";
import type { SessionUser } from "../auth/session";
import type { Story, StoryMedia } from "@/generated/prisma/client";

// Mission stories: a trip journal written from the field.
//
//   DRAFT ──submit──▶ SUBMITTED ──approve──▶ PUBLISHED ──archive──▶ ARCHIVED
//     ▲                  │
//     └──── RETURNED ◀───┘ (reviewer sends it back with a note)
//
// Nothing is shared outside the author until it is submitted, and nothing
// reaches supporters until it is published. Uploading a photo never
// publishes it.

export const CATEGORIES = ["SERVICE", "WORSHIP", "COMMUNITY", "TEAM", "TRAVEL", "OTHER"] as const;

export const storySchema = z.object({
  body: z.string().trim().max(5000, "Keep stories under 5,000 characters."),
  category: z.enum(CATEGORIES).optional().or(z.literal("").transform(() => undefined)),
  audience: z.enum(["TEAM", "FOLLOWERS"]),
  postedAsTeam: z.boolean().default(false),
  showsVulnerablePeople: z.boolean().default(false),
});

export type StoryWithMedia = Story & { media: StoryMedia[] };

function canEdit(t: TripContext, s: Story) {
  if (s.status === "ARCHIVED") return false;
  if (s.authorId === t.user.id && (s.status === "DRAFT" || s.status === "RETURNED")) return true;
  return t.perms.manage && s.status !== "DRAFT";
}

async function loadStory(t: TripContext, storyId: string) {
  const s = await db.story.findFirst({ where: { id: storyId, tripId: t.trip.id, orgId: t.org.id }, include: { media: { orderBy: { position: "asc" } } } });
  if (!s) throw notFound("Story");
  // Someone who can't see a story gets the same answer as for a missing one.
  if (!canSeeStory({ viewer: viewerOf(t), isAuthor: s.authorId === t.user.id, status: s.status, audience: s.audience, showsVulnerablePeople: s.showsVulnerablePeople, visibility: t.trip.storyVisibility }))
    throw notFound("Story");
  return s;
}

export function viewerOf(t: TripContext): FeedViewer {
  return t.perms.manage ? "MANAGER" : t.perms.viewTeam ? "TEAM" : "NONE";
}

export async function createStory(t: TripContext, input: z.input<typeof storySchema>) {
  assertPerm(t.perms.viewTeam, "Only team members can write stories for this trip.");
  if (t.trip.status === "CANCELLED") throw invalid("This trip was cancelled.");
  const d = storySchema.parse(input);
  if (d.postedAsTeam) assertPerm(t.perms.manage, "Only leaders can post on behalf of the team.");
  const story = await db.story.create({
    data: {
      orgId: t.org.id,
      tripId: t.trip.id,
      authorId: t.user.id,
      body: d.body,
      category: d.category ?? null,
      audience: d.audience,
      postedAsTeam: d.postedAsTeam,
      showsVulnerablePeople: d.showsVulnerablePeople,
    },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.created", entityType: "Story", entityId: story.id });
  return story;
}

export async function updateStory(t: TripContext, storyId: string, input: z.input<typeof storySchema>) {
  const s = await loadStory(t, storyId);
  assertPerm(canEdit(t, s), "This story can't be edited now.");
  const d = storySchema.parse(input);
  if (d.postedAsTeam && !s.postedAsTeam) assertPerm(t.perms.manage, "Only leaders can post on behalf of the team.");
  // Once published, who sees a story and its safeguard are fixed: take it down and post again to change them.
  const published = s.status === "PUBLISHED";
  if (published && (d.audience !== s.audience || d.showsVulnerablePeople !== s.showsVulnerablePeople))
    throw invalid("Who sees a published story can't be changed. Take it down and post it again instead.");
  await db.story.update({
    where: { id: s.id },
    data: {
      body: d.body,
      category: d.category ?? null,
      audience: d.audience,
      postedAsTeam: d.postedAsTeam,
      showsVulnerablePeople: d.showsVulnerablePeople,
    },
  });
  await audit({
    orgId: t.org.id,
    actorUserId: t.user.id,
    action: "story.edited",
    entityType: "Story",
    entityId: s.id,
    metadata: { status: s.status, before: { body: s.body, audience: s.audience, category: s.category } },
  });
}

/** Whether publishing this story needs a reviewer other than the author. */
export function needsReview(trip: { storiesRequireApproval: boolean }, s: Pick<Story, "audience" | "showsVulnerablePeople">, authorIsReviewer: boolean) {
  if (s.audience === "TEAM") return false; // team-only stories are shared like team announcements
  if (s.showsVulnerablePeople) return true; // always reviewed, with consent confirmed
  return trip.storiesRequireApproval && !authorIsReviewer;
}

export async function submitStory(t: TripContext, storyId: string, opts: { consentConfirmed?: boolean } = {}) {
  const s = await loadStory(t, storyId);
  if (s.authorId !== t.user.id) throw notFound("Story");
  if (s.status !== "DRAFT" && s.status !== "RETURNED") throw conflict("This story was already submitted.");
  if (!s.body.trim() && s.media.length === 0) throw invalid("Add a photo, video or a few words first.");
  const review = needsReview(t.trip, s, t.perms.manage);
  // A leader posting a safeguarded supporter story can publish it themselves only by confirming consent.
  const safeguarded = s.audience === "FOLLOWERS" && s.showsVulnerablePeople;
  const publishNow = !review || (safeguarded && t.perms.manage && !!opts.consentConfirmed);
  const now = new Date();
  const res = await db.story.updateMany({
    where: { id: s.id, status: s.status },
    data: publishNow
      ? { status: "PUBLISHED", submittedAt: now, publishedAt: now, reviewedById: t.user.id, reviewedAt: now, consentConfirmedById: safeguarded ? t.user.id : null }
      : { status: "SUBMITTED", submittedAt: now },
  });
  if (res.count !== 1) throw conflict("This story changed; refresh and try again.");
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: publishNow ? "story.published" : "story.submitted", entityType: "Story", entityId: s.id });
  if (publishNow) await announceStory(t, s.id);
  else await notifyReviewers(t, s);
  return publishNow ? "PUBLISHED" : "SUBMITTED";
}

async function notifyReviewers(t: TripContext, s: Story) {
  const leaders = await db.tripMember.findMany({ where: { tripId: t.trip.id, status: "APPROVED", role: "LEADER" }, select: { userId: true } });
  const admins = await db.membership.findMany({ where: { orgId: t.org.id, role: "ADMIN" }, select: { userId: true } });
  await notifyUsers({
    userIds: [...leaders, ...admins].map((m) => m.userId).filter((id) => id !== s.authorId),
    orgId: t.org.id,
    title: `${t.trip.name}: a story is waiting for review`,
    body: `${t.user.name} submitted a story${s.showsVulnerablePeople ? " that shows children or vulnerable people (consent check needed)" : ""}. Review it before supporters see it.`,
    href: `/o/${t.org.slug}/trips/${t.trip.id}/journal?review=1`,
    category: "stories",
    dedupePrefix: `story-review:${s.id}:${s.submittedAt?.getTime() ?? Date.now()}`,
  });
}

export async function reviewStory(t: TripContext, storyId: string, input: { decision: "APPROVE" | "RETURN"; note?: string; consentConfirmed?: boolean }) {
  assertPerm(t.perms.manage, "Only trip leaders and church administrators review stories.");
  const s = await loadStory(t, storyId);
  if (s.status !== "SUBMITTED") throw conflict("This story isn't waiting for review.");
  const note = input.note?.trim().slice(0, 1000) || null;
  const now = new Date();
  if (input.decision === "RETURN") {
    if (!note) throw invalid("Add a short note so the author knows what to change.");
    const res = await db.story.updateMany({ where: { id: s.id, status: "SUBMITTED" }, data: { status: "RETURNED", reviewedById: t.user.id, reviewedAt: now, reviewNote: note } });
    if (res.count !== 1) throw conflict("Someone else just reviewed this story.");
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.returned", entityType: "Story", entityId: s.id, metadata: { note } });
    await notifyUsers({
      userIds: [s.authorId],
      orgId: t.org.id,
      title: `${t.trip.name}: your story needs a change`,
      body: `${t.user.name} sent your story back: "${note}"`,
      href: `/o/${t.org.slug}/trips/${t.trip.id}/journal`,
      category: "stories",
      dedupePrefix: `story-returned:${s.id}:${now.getTime()}`,
    });
    return;
  }
  if (s.showsVulnerablePeople && !input.consentConfirmed)
    throw invalid("This story shows children or vulnerable people. Confirm the church has consent (from a parent or guardian for minors) before publishing.");
  const res = await db.story.updateMany({
    where: { id: s.id, status: "SUBMITTED" },
    data: { status: "PUBLISHED", publishedAt: now, reviewedById: t.user.id, reviewedAt: now, reviewNote: note, consentConfirmedById: s.showsVulnerablePeople ? t.user.id : null },
  });
  if (res.count !== 1) throw conflict("Someone else just reviewed this story.");
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.published", entityType: "Story", entityId: s.id, metadata: { consentConfirmed: s.showsVulnerablePeople } });
  await announceStory(t, s.id);
}

/** Notifies the team and (for supporter stories) followers once per story. No names of people pictured, no places. */
async function announceStory(t: TripContext, storyId: string) {
  const s = await db.story.findUniqueOrThrow({ where: { id: storyId }, include: { media: { select: { kind: true } } } });
  const team = (await teamUserIds(t.trip.id)).filter((id) => id !== s.authorId);
  const outsiders = s.audience === "FOLLOWERS" ? await followerUserIds(t.trip) : [];
  const photos = s.media.filter((m) => m.kind === "PHOTO").length;
  const videos = s.media.length - photos;
  const what = [photos ? `${photos} photo${photos === 1 ? "" : "s"}` : "", videos ? `${videos} video${videos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  const body = `A new story from the ${t.trip.name} team${what ? ` with ${what}` : ""}.`;
  await notifyUsers({ userIds: team, orgId: t.org.id, title: `${t.trip.name}: new story`, body, href: `/o/${t.org.slug}/trips/${t.trip.id}/journal`, category: "stories", dedupePrefix: `story:${s.id}` });
  await notifyUsers({
    userIds: outsiders.filter((id) => !team.includes(id) && id !== s.authorId),
    orgId: t.org.id,
    title: `${t.trip.name}: new story`,
    body,
    href: `/t/${t.org.slug}/${t.trip.slug}`,
    category: "stories",
    dedupePrefix: `story:${s.id}`,
  });
}

/** Takes a story down. Its photos stop being served immediately. */
export async function archiveStory(t: TripContext, storyId: string) {
  const s = await loadStory(t, storyId);
  assertPerm(t.perms.manage || s.authorId === t.user.id, "Only the author or a leader can take this story down.");
  if (s.status === "ARCHIVED") return;
  await db.story.update({ where: { id: s.id }, data: { status: "ARCHIVED", archivedAt: new Date(), archivedById: t.user.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.archived", entityType: "Story", entityId: s.id, metadata: { from: s.status } });
}

/** Deletes a story and its files. Authors can delete unpublished work; leaders can delete anything. */
export async function deleteStory(t: TripContext, storyId: string) {
  const s = await loadStory(t, storyId);
  const ownDraft = s.authorId === t.user.id && (s.status === "DRAFT" || s.status === "RETURNED" || s.status === "SUBMITTED");
  assertPerm(ownDraft || t.perms.manage, "Published stories can be taken down (archived) but only a leader can delete them.");
  await db.story.delete({ where: { id: s.id } });
  for (const m of s.media) {
    await deleteObject(m.storageKey);
    if (m.thumbKey) await deleteObject(m.thumbKey);
  }
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.deleted", entityType: "Story", entityId: s.id, metadata: { status: s.status, media: s.media.length } });
}

// ── Media ──

export async function addMedia(t: TripContext, storyId: string, file: File, opts: { poster?: File | null; altText?: string } = {}) {
  const s = await loadStory(t, storyId);
  assertPerm(canEdit(t, s), "Photos can only be added while the story is a draft or returned for changes.");
  if (s.media.length >= MAX_MEDIA_PER_STORY) throw invalid(`A story can have up to ${MAX_MEDIA_PER_STORY} photos or videos.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const type = file.type || "";
  let processed: ProcessedMedia;
  if (type.startsWith("video/")) {
    processed = await processVideo(buf, type);
    if (opts.poster && opts.poster.size > 0) {
      try {
        processed.thumb = await processPoster(Buffer.from(await opts.poster.arrayBuffer()));
      } catch {
        processed.thumb = null; // the video is still usable without a poster frame
      }
    }
  } else {
    processed = await processPhoto(buf);
  }
  const storageKey = await putObject(processed.full);
  const thumbKey = processed.thumb ? await putObject(processed.thumb) : null;
  try {
    const media = await db.storyMedia.create({
      data: {
        orgId: t.org.id,
        storyId: s.id,
        kind: processed.kind,
        storageKey,
        thumbKey,
        mimeType: processed.mimeType,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        sizeBytes: processed.full.length,
        sha256: processed.sha256,
        position: (s.media.at(-1)?.position ?? -1) + 1,
        altText: (opts.altText ?? "").trim().slice(0, 300),
        uploadedById: t.user.id,
      },
    });
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.media_added", entityType: "StoryMedia", entityId: media.id, metadata: { storyId: s.id, kind: media.kind } });
    return media;
  } catch (e) {
    await deleteObject(storageKey);
    if (thumbKey) await deleteObject(thumbKey);
    throw e;
  }
}

export async function removeMedia(t: TripContext, mediaId: string) {
  const m = await db.storyMedia.findFirst({ where: { id: mediaId, orgId: t.org.id, story: { tripId: t.trip.id } } });
  if (!m) throw notFound("Photo");
  const s = await loadStory(t, m.storyId);
  // Leaders can remove a single photo from a published story (e.g. consent withdrawn).
  assertPerm(canEdit(t, s) || (t.perms.manage && s.status !== "DRAFT"), "You can't remove this photo.");
  await db.storyMedia.delete({ where: { id: m.id } });
  await deleteObject(m.storageKey);
  if (m.thumbKey) await deleteObject(m.thumbKey);
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "story.media_removed", entityType: "StoryMedia", entityId: m.id, metadata: { storyId: s.id, storyStatus: s.status } });
}

// ── Reading ──

/** Stories for the team's journal: everything this person may see, newest first. */
export async function teamStories(t: TripContext): Promise<StoryWithMedia[]> {
  if (!t.perms.viewTeam) return [];
  const rows = await db.story.findMany({
    where: {
      tripId: t.trip.id,
      orgId: t.org.id,
      OR: t.perms.manage ? [{ authorId: t.user.id }, { status: { not: "DRAFT" } }] : [{ authorId: t.user.id }, { status: "PUBLISHED" }],
    },
    include: { media: { orderBy: { position: "asc" } } },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 200,
  });
  return rows;
}

/** Published stories an outsider (follower or public visitor) may see. */
export async function outsiderStories(tripId: string, viewer: FeedViewer, visibility: "PUBLIC" | "SUPPORTERS" | "TEAM", take = 50): Promise<StoryWithMedia[]> {
  if (viewer !== "FOLLOWER" && viewer !== "PUBLIC") return [];
  const rows = await db.story.findMany({
    where: { tripId, status: "PUBLISHED", audience: "FOLLOWERS", ...(viewer === "PUBLIC" ? { showsVulnerablePeople: false } : {}) },
    include: { media: { orderBy: { position: "asc" } } },
    orderBy: { publishedAt: "desc" },
    take,
  });
  return rows.filter((s) => canSeeStory({ viewer, isAuthor: false, status: s.status, audience: s.audience, showsVulnerablePeople: s.showsVulnerablePeople, visibility }));
}

/**
 * Decides whether this visitor may load a story photo or video. Returns
 * null for anything they may not see, including other churches' media,
 * drafts, unpublished and archived stories.
 */
export async function authorizeMedia(user: SessionUser | null, mediaId: string) {
  const m = await db.storyMedia.findUnique({ where: { id: mediaId }, include: { story: { include: { trip: { include: { org: true } } } } } });
  if (!m) return null;
  const { story } = m;
  const viewer = await feedViewerFor(user, story.trip);
  const ok = canSeeStory({
    viewer,
    isAuthor: !!user && story.authorId === user.id,
    status: story.status,
    audience: story.audience,
    showsVulnerablePeople: story.showsVulnerablePeople,
    visibility: story.trip.storyVisibility,
  });
  if (!ok) return null;
  return { media: m, publicAccess: viewer === "PUBLIC" };
}
