import "server-only";
import { z } from "zod";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { conflict, notFound } from "../errors";
import { slugify, zCheckbox, zMoney, zName, zOptionalText } from "@/lib/validation";
import { newToken } from "../crypto";
import { raisedByCampaign } from "./ledger";
import { Prisma } from "@/generated/prisma/client";

async function uniqueCampaignSlug(tx: Tx, orgId: string, base: string): Promise<string> {
  const root = slugify(base) || "campaign";
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? root : `${root}-${newToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || i}`;
    const taken = await tx.campaign.findUnique({ where: { orgId_slug: { orgId, slug: candidate } } });
    if (!taken) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Every trip has one general fund campaign. */
export async function createTripFundCampaign(tx: Tx, trip: { id: string; orgId: string; name: string; slug: string; fundraisingGoalCents: number }) {
  return tx.campaign.create({
    data: {
      orgId: trip.orgId,
      tripId: trip.id,
      kind: "TRIP",
      slug: await uniqueCampaignSlug(tx, trip.orgId, trip.slug),
      title: `${trip.name} — team fund`,
      goalCents: trip.fundraisingGoalCents,
      restriction: "RESTRICTED",
      designationNote: `Gifts support the ${trip.name} team as a whole.`,
    },
  });
}

/** Each approved participant gets a personal support page. Safe to call repeatedly. */
export async function ensureParticipantCampaign(tx: Tx, tripMemberId: string) {
  const existing = await tx.campaign.findFirst({ where: { tripMemberId, kind: "PARTICIPANT" } });
  if (existing) return existing;
  const tm = await tx.tripMember.findUniqueOrThrow({
    where: { id: tripMemberId },
    include: { trip: true, user: { select: { name: true } } },
  });
  const firstName = tm.user.name.split(/\s+/)[0] ?? tm.user.name;
  return tx.campaign.create({
    data: {
      orgId: tm.orgId,
      tripId: tm.tripId,
      tripMemberId: tm.id,
      kind: "PARTICIPANT",
      slug: await uniqueCampaignSlug(tx, tm.orgId, `${tm.trip.slug}-${tm.user.name}`),
      title: `Support ${firstName} on ${tm.trip.name}`,
      goalCents: tm.trip.defaultParticipantGoalCents,
      restriction: "RESTRICTED",
      designationNote: `Gifts are applied to ${firstName}'s share of the ${tm.trip.name} costs.`,
    },
  });
}

export const campaignSchema = z.object({
  title: zName("Title", 150),
  story: zOptionalText(10_000),
  goal: zMoney("Goal"),
  designationNote: zOptionalText(500),
  isPublic: zCheckbox,
  isClosed: zCheckbox,
});

/** Participants may edit their own page's story and goal; managers may edit any campaign on the trip. */
export async function updateCampaign(t: TripContext, campaignId: string, input: z.input<typeof campaignSchema>) {
  const data = campaignSchema.parse(input);
  const c = await db.campaign.findFirst({ where: { id: campaignId, tripId: t.trip.id, orgId: t.org.id } });
  if (!c) throw notFound("Campaign");
  const isOwn = c.tripMemberId != null && c.tripMemberId === t.tripMember?.id;
  assertPerm(t.perms.manage || isOwn);
  const updated = await db.campaign.update({
    where: { id: c.id },
    data: {
      title: data.title,
      story: data.story ?? "",
      goalCents: data.goal,
      // Only managers control visibility, closing, and how gifts are designated.
      ...(t.perms.manage
        ? { isPublic: data.isPublic, isClosed: data.isClosed, designationNote: data.designationNote ?? null }
        : {}),
    },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "campaign.updated", entityType: "Campaign", entityId: c.id });
  return updated;
}

export const projectCampaignSchema = z.object({
  title: zName("Title", 150),
  story: zOptionalText(10_000),
  goal: zMoney("Goal", { min: 100 }),
  restriction: z.enum(["RESTRICTED", "UNRESTRICTED"]).default("RESTRICTED"),
  designationNote: zOptionalText(500),
});

export async function createProjectCampaign(t: TripContext, input: z.input<typeof projectCampaignSchema>) {
  assertPerm(t.perms.manage);
  const data = projectCampaignSchema.parse(input);
  try {
    const c = await db.$transaction(async (tx) =>
      tx.campaign.create({
        data: {
          orgId: t.org.id,
          tripId: t.trip.id,
          kind: "PROJECT",
          slug: await uniqueCampaignSlug(tx, t.org.id, `${t.trip.slug}-${data.title}`),
          title: data.title,
          story: data.story ?? "",
          goalCents: data.goal,
          restriction: data.restriction,
          designationNote: data.designationNote ?? null,
        },
      }),
    );
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "campaign.created", entityType: "Campaign", entityId: c.id });
    return c;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("A campaign with that name already exists.");
    throw e;
  }
}

/** Campaigns for a trip with live "raised" amounts from the ledger. */
export async function tripCampaignsWithProgress(tripId: string, orgId: string) {
  const campaigns = await db.campaign.findMany({
    where: { tripId, orgId },
    include: { tripMember: { include: { user: { select: { id: true, name: true } } } } },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });
  const raised = await raisedByCampaign(campaigns.map((c) => c.id));
  return campaigns.map((c) => ({ ...c, raisedCents: raised.get(c.id) ?? 0 }));
}

/** Public lookup for a giving page. Only active churches' public campaigns on visible trips. */
export async function findPublicCampaign(orgSlug: string, campaignSlug: string) {
  const campaign = await db.campaign.findFirst({
    where: {
      slug: campaignSlug,
      isPublic: true,
      org: { slug: orgSlug, status: "ACTIVE" },
      trip: { status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] } },
    },
    include: {
      org: { select: { id: true, name: true, slug: true, stripeChargesEnabled: true, stripeAccountId: true, currency: true } },
      trip: { select: { id: true, name: true, slug: true, destination: true, startDate: true, endDate: true, summary: true, status: true } },
      tripMember: { include: { user: { select: { name: true } } } },
    },
  });
  if (!campaign) return null;
  const raised = await raisedByCampaign([campaign.id]);
  const recent = await db.donation.findMany({
    where: { campaignId: campaign.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
    orderBy: { receivedAt: "desc" },
    take: 8,
    select: { id: true, donorName: true, isAnonymous: true, message: true, receivedAt: true },
  });
  return {
    campaign,
    raisedCents: raised.get(campaign.id) ?? 0,
    // Public pages show first names only, and never amounts or emails per donor.
    recentSupporters: recent.map((d) => ({
      id: d.id,
      name: d.isAnonymous ? "Anonymous" : (d.donorName.split(/\s+/)[0] ?? "A supporter"),
      message: d.message,
      receivedAt: d.receivedAt,
    })),
  };
}
