import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { tripContextFor } from "@/server/context";
import { canSeeStory, canSeeJourneyItem } from "@/server/permissions";
import { processPhoto, stripMp4Metadata, processVideo } from "@/server/media";
import { addMedia, archiveStory, authorizeMedia, createStory, deleteStory, outsiderStories, removeMedia, reviewStory, submitStory, teamStories, updateStory } from "@/server/services/stories";
import { decideFollower, feedViewerFor, followerUserIds, requestToFollow, revokeUser } from "@/server/services/followers";
import { recordOfflineDonation } from "@/server/services/donations";
import { addTripMember, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";

beforeEach(resetDb);

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "PhoneCo", Model: "Secret Model" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "14/1 37/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "90/1 30/1 0/1" } })
    .toBuffer();
}

const photo = async (name = "p.jpg") => new File([new Uint8Array(await jpegWithGps())], name, { type: "image/jpeg" });

function box(type: string, payload: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

/** A minimal MP4: ftyp, moov(mvhd + udta with a location), mdat. */
function mp4(seconds: number) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(seconds * 1000, 16); // duration
  const xyz = box("©xyz", Buffer.from("+14.6349-090.5069/", "latin1"));
  const moov = box("moov", Buffer.concat([box("mvhd", mvhd), box("udta", xyz), box("meta", Buffer.from("Apple location 14.63,-90.50", "latin1"))]));
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isomavc1", "latin1")), moov, box("mdat", Buffer.alloc(64, 1))]);
}

async function setup(opts: { visibility?: "PUBLIC" | "SUPPORTERS" | "TEAM"; requireApproval?: boolean } = {}) {
  const o = await makeOrg();
  const { trip, fund } = await makeTrip(o.org.id, { status: "IN_PROGRESS" });
  await db.trip.update({ where: { id: trip.id }, data: { storyVisibility: opts.visibility ?? "SUPPORTERS", storiesRequireApproval: opts.requireApproval ?? true } });
  const leaderUser = await makeUser({ name: "Lee Leader" });
  await addTripMember(trip, leaderUser, "LEADER");
  const pUser = await makeUser({ name: "Pat Participant" });
  await addTripMember(trip, pUser);
  const adminT = await tripContextFor(o.ctx, trip.id);
  const leader = await tripCtxFor(leaderUser, o.org.slug, trip.id);
  const participant = await tripCtxFor(pUser, o.org.slug, trip.id);
  const tripWithOrg = await db.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { org: true } });
  return { ...o, trip: tripWithOrg, fund, adminT, leader, leaderUser, participant, pUser };
}

async function publishedStory(s: Awaited<ReturnType<typeof setup>>, overrides: Partial<{ showsVulnerablePeople: boolean; audience: "TEAM" | "FOLLOWERS" }> = {}) {
  const story = await createStory(s.participant, { body: "We finished the roof today.", audience: overrides.audience ?? "FOLLOWERS", showsVulnerablePeople: overrides.showsVulnerablePeople ?? false });
  const media = await addMedia(s.participant, story.id, await photo());
  const state = await submitStory(s.participant, story.id);
  if (state === "SUBMITTED") await reviewStory(s.leader, story.id, { decision: "APPROVE", consentConfirmed: true });
  return { story, media };
}

async function expectError(p: Promise<unknown>, code: AppError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe("media processing", () => {
  it("re-encodes photos, removing GPS and camera metadata, and makes a thumbnail", async () => {
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const out = await processPhoto(original);
    const meta = await sharp(out.full).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(out.full.includes(Buffer.from("Secret Model"))).toBe(false);
    const thumb = await sharp(out.thumb!).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(640);
  });

  it("rejects files that aren't photos and explains HEIC", async () => {
    await expectError(processPhoto(Buffer.from("%PDF-1.4 not a photo")), "INVALID");
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(32)]);
    await expect(processPhoto(heic)).rejects.toThrow(/HEIC/);
  });

  it("erases location metadata from videos without changing their size", async () => {
    const buf = mp4(20);
    const before = buf.length;
    const { durationMs, blanked } = stripMp4Metadata(buf);
    expect(durationMs).toBe(20_000);
    expect(blanked).toBe(2);
    expect(buf.length).toBe(before);
    expect(buf.includes(Buffer.from("14.6349", "latin1"))).toBe(false);
    expect(buf.includes(Buffer.from("Apple location", "latin1"))).toBe(false);
  });

  it("limits video length and rejects non-video files", async () => {
    await expect(processVideo(mp4(120), "video/mp4")).rejects.toThrow(/90 seconds/);
    await expectError(processVideo(Buffer.from("not a video at all, really"), "video/mp4"), "INVALID");
  });
});

describe("story visibility rules", () => {
  const base = { isAuthor: false, status: "PUBLISHED" as const, audience: "FOLLOWERS" as const, showsVulnerablePeople: false, visibility: "SUPPORTERS" as const };
  it("keeps drafts private to the author", () => {
    expect(canSeeStory({ ...base, viewer: "MANAGER", status: "DRAFT" })).toBe(false);
    expect(canSeeStory({ ...base, viewer: "TEAM", status: "DRAFT", isAuthor: true })).toBe(true);
    expect(canSeeStory({ ...base, viewer: "MANAGER", status: "SUBMITTED" })).toBe(true);
    expect(canSeeStory({ ...base, viewer: "TEAM", status: "SUBMITTED" })).toBe(false);
  });
  it("shows outsiders only published supporter stories, by trip setting", () => {
    expect(canSeeStory({ ...base, viewer: "FOLLOWER" })).toBe(true);
    expect(canSeeStory({ ...base, viewer: "PUBLIC" })).toBe(false);
    expect(canSeeStory({ ...base, viewer: "PUBLIC", visibility: "PUBLIC" })).toBe(true);
    expect(canSeeStory({ ...base, viewer: "FOLLOWER", visibility: "TEAM" })).toBe(false);
    expect(canSeeStory({ ...base, viewer: "FOLLOWER", audience: "TEAM" })).toBe(false);
    expect(canSeeStory({ ...base, viewer: "FOLLOWER", status: "ARCHIVED" })).toBe(false);
  });
  it("never shows children or vulnerable people on the open public page", () => {
    expect(canSeeStory({ ...base, viewer: "PUBLIC", visibility: "PUBLIC", showsVulnerablePeople: true })).toBe(false);
    expect(canSeeStory({ ...base, viewer: "FOLLOWER", visibility: "PUBLIC", showsVulnerablePeople: true })).toBe(true);
  });
  it("keeps travel segments off the open web", () => {
    expect(canSeeJourneyItem({ viewer: "PUBLIC", shared: true, visibility: "PUBLIC", isTravelSegment: true })).toBe(false);
    expect(canSeeJourneyItem({ viewer: "PUBLIC", shared: true, visibility: "PUBLIC", isTravelSegment: false })).toBe(true);
    expect(canSeeJourneyItem({ viewer: "FOLLOWER", shared: true, visibility: "SUPPORTERS", isTravelSegment: true })).toBe(true);
    expect(canSeeJourneyItem({ viewer: "FOLLOWER", shared: false, visibility: "SUPPORTERS", isTravelSegment: false })).toBe(false);
  });
});

describe("story workflow", () => {
  it("never publishes on upload: draft → submitted → approved", async () => {
    const s = await setup();
    const follower = await makeUser();
    await db.tripFollower.create({ data: { orgId: s.org.id, tripId: s.trip.id, userId: follower.id, status: "APPROVED" } });

    const story = await createStory(s.participant, { body: "Day one", audience: "FOLLOWERS" });
    const media = await addMedia(s.participant, story.id, await photo());
    // Draft: only the author.
    expect(await authorizeMedia(s.pUser, media.id)).not.toBeNull();
    expect(await authorizeMedia(s.leaderUser, media.id)).toBeNull();
    expect(await authorizeMedia(follower, media.id)).toBeNull();
    expect(await authorizeMedia(null, media.id)).toBeNull();

    expect(await submitStory(s.participant, story.id)).toBe("SUBMITTED");
    expect(await authorizeMedia(s.leaderUser, media.id)).not.toBeNull();
    expect(await authorizeMedia(follower, media.id)).toBeNull();
    // Other participants don't see it before review either.
    const other = await makeUser();
    await addTripMember(s.trip, other);
    expect(await authorizeMedia(other, media.id)).toBeNull();

    await reviewStory(s.leader, story.id, { decision: "APPROVE" });
    expect(await authorizeMedia(follower, media.id)).not.toBeNull();
    expect(await authorizeMedia(other, media.id)).not.toBeNull();
    // SUPPORTERS trip: signed-out visitors still see nothing.
    expect(await authorizeMedia(null, media.id)).toBeNull();
    const n = await db.notification.findMany({ where: { userId: follower.id } });
    expect(n).toHaveLength(1);
    expect(n[0].body).not.toContain("Pat");
  });

  it("returns a story with a required note, and lets the author fix and resubmit", async () => {
    const s = await setup();
    const story = await createStory(s.participant, { body: "Faces visible", audience: "FOLLOWERS" });
    await submitStory(s.participant, story.id);
    await expectError(reviewStory(s.leader, story.id, { decision: "RETURN" }), "INVALID");
    await reviewStory(s.leader, story.id, { decision: "RETURN", note: "Please crop out the kids' faces." });
    expect((await db.story.findUniqueOrThrow({ where: { id: story.id } })).status).toBe("RETURNED");
    await updateStory(s.participant, story.id, { body: "Cropped", audience: "FOLLOWERS" });
    expect(await submitStory(s.participant, story.id)).toBe("SUBMITTED");
    // Double review (two leaders at once) is caught.
    await reviewStory(s.adminT, story.id, { decision: "APPROVE" });
    await expectError(reviewStory(s.leader, story.id, { decision: "APPROVE" }), "CONFLICT");
  });

  it("participants can't review, and can't post on behalf of the team", async () => {
    const s = await setup();
    const story = await createStory(s.participant, { body: "x", audience: "FOLLOWERS" });
    await submitStory(s.participant, story.id);
    await expectError(reviewStory(s.participant, story.id, { decision: "APPROVE" }), "FORBIDDEN");
    await expectError(createStory(s.participant, { body: "x", audience: "FOLLOWERS", postedAsTeam: true }), "FORBIDDEN");
  });

  it("publishes directly when the church turns approval off, except safeguarded stories", async () => {
    const s = await setup({ requireApproval: false });
    const a = await createStory(s.participant, { body: "Worship night", audience: "FOLLOWERS" });
    expect(await submitStory(s.participant, a.id)).toBe("PUBLISHED");
    const b = await createStory(s.participant, { body: "Kids club", audience: "FOLLOWERS", showsVulnerablePeople: true });
    expect(await submitStory(s.participant, b.id)).toBe("SUBMITTED");
    await expect(reviewStory(s.leader, b.id, { decision: "APPROVE" })).rejects.toThrow(/consent/);
    await reviewStory(s.leader, b.id, { decision: "APPROVE", consentConfirmed: true });
    const row = await db.story.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(row.consentConfirmedById).toBe(s.leaderUser.id);
  });

  it("keeps safeguarded stories off the open public page but shows them to followers", async () => {
    const s = await setup({ visibility: "PUBLIC" });
    const { media } = await publishedStory(s, { showsVulnerablePeople: true });
    const plain = await publishedStory(s);
    const follower = await makeUser();
    await db.tripFollower.create({ data: { orgId: s.org.id, tripId: s.trip.id, userId: follower.id, status: "APPROVED" } });
    expect(await authorizeMedia(null, media.id)).toBeNull();
    expect(await authorizeMedia(null, plain.media.id)).not.toBeNull();
    expect(await authorizeMedia(follower, media.id)).not.toBeNull();
    expect((await outsiderStories(s.trip.id, "PUBLIC", "PUBLIC")).map((x) => x.id)).toEqual([plain.story.id]);
    expect(await outsiderStories(s.trip.id, "FOLLOWER", "PUBLIC")).toHaveLength(2);
  });

  it("team-only stories never reach followers", async () => {
    const s = await setup({ visibility: "PUBLIC" });
    const { media } = await publishedStory(s, { audience: "TEAM" });
    const follower = await makeUser();
    await db.tripFollower.create({ data: { orgId: s.org.id, tripId: s.trip.id, userId: follower.id, status: "APPROVED" } });
    expect(await authorizeMedia(follower, media.id)).toBeNull();
    expect(await authorizeMedia(null, media.id)).toBeNull();
  });

  it("taking a story down revokes access to its photos immediately", async () => {
    const s = await setup({ visibility: "PUBLIC" });
    const { story, media } = await publishedStory(s);
    expect(await authorizeMedia(null, media.id)).not.toBeNull();
    await archiveStory(s.participant, story.id);
    expect(await authorizeMedia(null, media.id)).toBeNull();
    expect(await authorizeMedia(s.leaderUser, media.id)).not.toBeNull(); // leaders keep the record
    // Published stories can't be deleted by the author, only taken down.
    const other = await publishedStory(s);
    await expectError(deleteStory(s.participant, other.story.id), "FORBIDDEN");
    await deleteStory(s.leader, other.story.id);
    expect(await db.storyMedia.count({ where: { id: other.media.id } })).toBe(0);
  });

  it("lets a leader remove one photo from a published story (e.g. consent withdrawn)", async () => {
    const s = await setup();
    const { media } = await publishedStory(s);
    await expectError(removeMedia(s.participant, media.id), "FORBIDDEN");
    await removeMedia(s.leader, media.id);
    expect(await authorizeMedia(s.leaderUser, media.id)).toBeNull();
  });

  it("won't let authors widen a published story's audience", async () => {
    const s = await setup();
    const { story } = await publishedStory(s, { audience: "TEAM" });
    await expectError(updateStory(s.leader, story.id, { body: "x", audience: "FOLLOWERS" }), "INVALID");
  });

  it("only the author can add photos to their draft", async () => {
    const s = await setup();
    const story = await createStory(s.participant, { body: "", audience: "FOLLOWERS" });
    const otherUser = await makeUser();
    await addTripMember(s.trip, otherUser);
    const other = await tripCtxFor(otherUser, s.org.slug, s.trip.id);
    await expectError(addMedia(other, story.id, await photo()), "NOT_FOUND");
    await expectError(addMedia(s.leader, story.id, await photo()), "NOT_FOUND"); // drafts are private
    await expectError(submitStory(s.participant, story.id), "INVALID"); // empty
  });
});

describe("trip and church isolation for stories", () => {
  it("blocks another church's admin, by id, from stories, media and reviews", async () => {
    const s = await setup({ visibility: "SUPPORTERS" });
    const { story, media } = await publishedStory(s);
    const pending = await createStory(s.participant, { body: "pending", audience: "FOLLOWERS" });
    await submitStory(s.participant, pending.id);

    const other = await makeOrg();
    const { trip: otherTrip } = await makeTrip(other.org.id);
    const otherT = await tripContextFor(other.ctx, otherTrip.id);
    // Using our story ids from their own trip context.
    await expectError(reviewStory(otherT, pending.id, { decision: "APPROVE" }), "NOT_FOUND");
    await expectError(archiveStory(otherT, story.id), "NOT_FOUND");
    await expectError(addMedia(otherT, pending.id, await photo()), "NOT_FOUND");
    await expectError(removeMedia(otherT, media.id), "NOT_FOUND");
    // Loading our trip through their church.
    await expectError(tripContextFor(other.ctx, s.trip.id), "NOT_FOUND");
    // Downloading media directly: they're just a member of the public here.
    expect(await authorizeMedia(other.admin, media.id)).toBeNull();
    expect(await teamStories(otherT)).toHaveLength(0);
  });

  it("a participant on a different trip in the same church can't see the team's stories", async () => {
    const s = await setup();
    const { media } = await publishedStory(s, { audience: "TEAM" });
    const { trip: t2 } = await makeTrip(s.org.id);
    const u = await makeUser();
    await addTripMember(t2, u);
    expect(await authorizeMedia(u, media.id)).toBeNull();
  });

  it("hides everything when the church is suspended", async () => {
    const s = await setup({ visibility: "PUBLIC" });
    const { media } = await publishedStory(s);
    await db.organization.update({ where: { id: s.org.id }, data: { status: "SUSPENDED" } });
    expect(await authorizeMedia(null, media.id)).toBeNull();
    expect(await authorizeMedia(s.pUser, media.id)).toBeNull();
  });
});

describe("followers", () => {
  it("donors follow automatically when allowed; leaders can revoke", async () => {
    const s = await setup();
    const donor = await makeUser({ email: "giver@example.test" });
    await recordOfflineDonation(s.adminT, { campaignId: s.fund.id, amount: "50", donorName: "Gale Giver", donorEmail: "giver@example.test", method: "CHECK", receivedOn: "2026-10-01" });
    const trip = await db.trip.findUniqueOrThrow({ where: { id: s.trip.id }, include: { org: true } });
    expect(await feedViewerFor(donor, trip)).toBe("FOLLOWER");
    expect(await followerUserIds(trip)).toContain(donor.id);
    await revokeUser(s.leader, donor.id);
    expect(await feedViewerFor(donor, trip)).toBe("PUBLIC");
    expect(await followerUserIds(trip)).not.toContain(donor.id);
    // Revoked people can't re-request.
    expect((await requestToFollow(donor, trip.id)).status).toBe("REVOKED");
  });

  it("unverified email addresses don't count as donors", async () => {
    const s = await setup();
    const impostor = await makeUser({ email: "giver@example.test", verified: false });
    await recordOfflineDonation(s.adminT, { campaignId: s.fund.id, amount: "50", donorName: "Gale Giver", donorEmail: "giver@example.test", method: "CHECK", receivedOn: "2026-10-01" });
    expect(await feedViewerFor(impostor, s.trip)).toBe("PUBLIC");
  });

  it("donors need approval when the trip turns automatic following off", async () => {
    const s = await setup();
    await db.trip.update({ where: { id: s.trip.id }, data: { donorsCanFollow: false } });
    const donor = await makeUser({ email: "g2@example.test" });
    await recordOfflineDonation(s.adminT, { campaignId: s.fund.id, amount: "50", donorName: "G", donorEmail: "g2@example.test", method: "CHECK", receivedOn: "2026-10-01" });
    const trip = await db.trip.findUniqueOrThrow({ where: { id: s.trip.id }, include: { org: true } });
    expect(await feedViewerFor(donor, trip)).toBe("PUBLIC");
  });

  it("requests notify leaders once; approval grants access; participants can't decide", async () => {
    const s = await setup();
    const fan = await makeUser();
    expect((await requestToFollow(fan, s.trip.id)).status).toBe("REQUESTED");
    expect((await requestToFollow(fan, s.trip.id)).status).toBe("REQUESTED");
    expect(await db.notification.count({ where: { userId: s.leaderUser.id } })).toBe(1);
    const row = await db.tripFollower.findFirstOrThrow({ where: { userId: fan.id } });
    await expectError(decideFollower(s.participant, row.id, "APPROVED"), "FORBIDDEN");
    await decideFollower(s.leader, row.id, "APPROVED");
    expect(await feedViewerFor(fan, s.trip)).toBe("FOLLOWER");
  });

  it("can't follow draft trips, team-only trips, or other churches' trips through a leader's id", async () => {
    const s = await setup({ visibility: "TEAM" });
    const fan = await makeUser();
    await expectError(requestToFollow(fan, s.trip.id), "NOT_FOUND");
    const { trip: draft } = await makeTrip(s.org.id, { status: "DRAFT" });
    await expectError(requestToFollow(fan, draft.id), "NOT_FOUND");
    const other = await makeOrg();
    const { trip: otherTrip } = await makeTrip(other.org.id);
    const req = await requestToFollow(fan, otherTrip.id);
    const row = await db.tripFollower.findFirstOrThrow({ where: { userId: fan.id, tripId: otherTrip.id } });
    expect(req.status).toBe("REQUESTED");
    await expectError(decideFollower(s.leader, row.id, "APPROVED"), "NOT_FOUND");
  });
});
