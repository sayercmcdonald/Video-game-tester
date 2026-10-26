import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { hashToken, newToken } from "../crypto";
import { appUrl, queueEmail } from "../email";
import { conflict, forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth/session";
import { type OrgContext, tripContextFor, assertPerm } from "../context";
import { zEmail, zName, zOptionalText, zSlug } from "@/lib/validation";
import { Prisma } from "@/generated/prisma/client";
import { ensureParticipantCampaign } from "./campaigns";

const RESERVED_SLUGS = new Set(["admin", "api", "app", "give", "login", "signup", "settings", "new", "donor", "trips"]);

export const createOrgSchema = z.object({
  name: zName("Church name", 150),
  slug: zSlug.refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved. Try another."),
  contactEmail: zEmail,
  timezone: z.string().trim().max(60).default("America/Chicago").refine(isTimeZone, "Choose a valid time zone."),
});

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A new church starts in PENDING_REVIEW: it can be set up, but cannot take donations until approved. */
export async function createOrganization(user: SessionUser, input: z.input<typeof createOrgSchema>) {
  const data = createOrgSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { ...data, status: "PENDING_REVIEW" } });
      await tx.membership.create({ data: { orgId: org.id, userId: user.id, role: "ADMIN" } });
      await audit({ orgId: org.id, actorUserId: user.id, action: "org.created", entityType: "Organization", entityId: org.id }, tx);
      return org;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("That web address is already taken. Try another.");
    }
    throw e;
  }
}

export const orgSettingsSchema = z.object({
  name: zName("Church name", 150),
  contactEmail: zEmail,
  timezone: z.string().trim().min(1).max(60).refine(isTimeZone, "Choose a valid time zone."),
  legalName: zOptionalText(200),
  taxId: zOptionalText(40),
  receiptStatement: zOptionalText(1000),
});

export async function updateOrgSettings(ctx: OrgContext, input: z.input<typeof orgSettingsSchema>) {
  assertPerm(ctx.isAdmin);
  const data = orgSettingsSchema.parse(input);
  const org = await db.organization.update({
    where: { id: ctx.org.id },
    data: { ...data, legalName: data.legalName ?? null, taxId: data.taxId ?? null, receiptStatement: data.receiptStatement ?? null },
  });
  await audit({ orgId: org.id, actorUserId: ctx.user.id, action: "org.settings_updated", entityType: "Organization", entityId: org.id });
  return org;
}

// ── Invitations ──

export const inviteSchema = z.object({
  email: zEmail,
  orgRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  tripId: z.string().optional(),
  tripRole: z.enum(["LEADER", "PARTICIPANT"]).optional(),
});

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Church admins can invite anyone to the church (and optionally a trip).
 * Trip leaders can invite participants to their own trip only.
 */
export async function createInvitation(ctx: OrgContext, input: z.input<typeof inviteSchema>) {
  const data = inviteSchema.parse(input);
  let tripName: string | null = null;
  if (data.tripId) {
    const t = await tripContextFor(ctx, data.tripId);
    assertPerm(t.perms.manage);
    if (!ctx.isAdmin && data.tripRole !== "PARTICIPANT") throw forbidden("Only church administrators can add trip leaders.");
    tripName = t.trip.name;
  } else if (!ctx.isAdmin) {
    throw forbidden();
  }
  if (data.orgRole === "ADMIN" && !ctx.isAdmin) throw forbidden();
  if (data.tripId && !data.tripRole) throw invalid("Choose a trip role.");

  const token = newToken();
  const invitation = await db.invitation.create({
    data: {
      orgId: ctx.org.id,
      email: data.email,
      orgRole: data.orgRole,
      tripId: data.tripId ?? null,
      tripRole: data.tripId ? data.tripRole : null,
      tokenHash: hashToken(token),
      invitedById: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  const what = tripName
    ? `join ${tripName} as a ${data.tripRole === "LEADER" ? "trip leader" : "participant"}`
    : `join ${ctx.org.name}${data.orgRole === "ADMIN" ? " as an administrator" : ""}`;
  await queueEmail({
    to: data.email,
    subject: `${ctx.user.name} invited you to ${what}`,
    text: `Hi,\n\n${ctx.user.name} invited you to ${what} on Mission Trips.\n\nAccept the invitation:\n${appUrl(`/invite/${token}`)}\n\nThis link expires in 14 days.`,
  });
  await audit({
    orgId: ctx.org.id,
    actorUserId: ctx.user.id,
    action: "invitation.created",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { email: data.email, orgRole: data.orgRole, tripId: data.tripId ?? null, tripRole: data.tripRole ?? null },
  });
  return { invitation, token };
}

export async function findInvitation(token: string) {
  if (!token || token.length > 200) return null;
  const inv = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: { select: { name: true, slug: true } }, trip: { select: { name: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) return null;
  return inv;
}

export async function acceptInvitation(user: SessionUser, token: string) {
  const inv = await findInvitation(token);
  if (!inv) throw invalid("This invitation is invalid, expired or already used.");
  if (inv.email !== user.email.toLowerCase()) {
    throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`);
  }
  return db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw invalid("This invitation has already been used.");
    // Opening a link sent to this address proves the person controls the inbox.
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });

    const existing = await tx.membership.findUnique({ where: { orgId_userId: { orgId: inv.orgId, userId: user.id } } });
    if (!existing) {
      await tx.membership.create({ data: { orgId: inv.orgId, userId: user.id, role: inv.orgRole } });
    } else if (existing.role === "MEMBER" && inv.orgRole === "ADMIN") {
      await tx.membership.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
    }

    if (inv.tripId && inv.tripRole) {
      const tm = await tx.tripMember.upsert({
        where: { tripId_userId: { tripId: inv.tripId, userId: user.id } },
        create: {
          orgId: inv.orgId,
          tripId: inv.tripId,
          userId: user.id,
          role: inv.tripRole,
          status: "APPROVED",
          decidedAt: new Date(),
          decidedById: inv.invitedById,
        },
        update: { role: inv.tripRole, status: "APPROVED", decidedAt: new Date(), decidedById: inv.invitedById },
      });
      if (tm.role === "PARTICIPANT") await ensureParticipantCampaign(tx, tm.id);
    }
    await audit({ orgId: inv.orgId, actorUserId: user.id, action: "invitation.accepted", entityType: "Invitation", entityId: inv.id }, tx);
    return inv.org.slug;
  });
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string) {
  assertPerm(ctx.isAdmin);
  const res = await db.invitation.updateMany({
    where: { id: invitationId, orgId: ctx.org.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw notFound("Invitation");
  await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "invitation.revoked", entityType: "Invitation", entityId: invitationId });
}

// ── Members ──

export async function setMemberRole(ctx: OrgContext, membershipId: string, role: "ADMIN" | "MEMBER") {
  assertPerm(ctx.isAdmin);
  await db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, orgId: ctx.org.id } });
    if (!m) throw notFound("Member");
    if (m.role === "ADMIN" && role === "MEMBER") {
      const admins = await tx.membership.count({ where: { orgId: ctx.org.id, role: "ADMIN" } });
      if (admins <= 1) throw invalid("A church needs at least one administrator.");
    }
    await tx.membership.update({ where: { id: m.id }, data: { role } });
    await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "member.role_changed", entityType: "Membership", entityId: m.id, metadata: { role } }, tx);
  });
}

export async function removeMember(ctx: OrgContext, membershipId: string) {
  assertPerm(ctx.isAdmin);
  await db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, orgId: ctx.org.id } });
    if (!m) throw notFound("Member");
    if (m.role === "ADMIN") {
      const admins = await tx.membership.count({ where: { orgId: ctx.org.id, role: "ADMIN" } });
      if (admins <= 1) throw invalid("A church needs at least one administrator.");
    }
    // Keep trip history (donations reference campaigns); mark them withdrawn instead of deleting.
    await tx.tripMember.updateMany({ where: { orgId: ctx.org.id, userId: m.userId }, data: { status: "WITHDRAWN" } });
    await tx.membership.delete({ where: { id: m.id } });
    await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "member.removed", entityType: "Membership", entityId: m.id, metadata: { userId: m.userId } }, tx);
  });
}
