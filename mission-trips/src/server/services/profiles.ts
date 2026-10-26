import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import { type OrgContext } from "../context";
import { notFound } from "../errors";
import { tripPermissions } from "../permissions";
import { zOptionalDate, zOptionalText } from "@/lib/validation";

export type SensitiveInfo = { medicalNotes?: string; allergies?: string; medications?: string };

export const profileSchema = z.object({
  phone: zOptionalText(40),
  dateOfBirth: zOptionalDate("Date of birth"),
  emergencyContactName: zOptionalText(120),
  emergencyContactPhone: zOptionalText(40),
  emergencyContactRelation: zOptionalText(60),
  medicalNotes: zOptionalText(3000),
  allergies: zOptionalText(1000),
  medications: zOptionalText(1000),
});

/** People edit only their own profile. Medical details are encrypted before storage. */
export async function updateOwnProfile(ctx: OrgContext, input: z.input<typeof profileSchema>) {
  const d = profileSchema.parse(input);
  const sensitive: SensitiveInfo = { medicalNotes: d.medicalNotes, allergies: d.allergies, medications: d.medications };
  const hasSensitive = Object.values(sensitive).some(Boolean);
  const data = {
    phone: d.phone ?? null,
    dateOfBirth: d.dateOfBirth ?? null,
    emergencyContactName: d.emergencyContactName ?? null,
    emergencyContactPhone: d.emergencyContactPhone ?? null,
    emergencyContactRelation: d.emergencyContactRelation ?? null,
    sensitiveEncrypted: hasSensitive ? encryptJson(sensitive) : null,
  };
  await db.personProfile.upsert({
    where: { orgId_userId: { orgId: ctx.org.id, userId: ctx.user.id } },
    create: { orgId: ctx.org.id, userId: ctx.user.id, ...data },
    update: data,
  });
  await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "profile.updated", entityType: "PersonProfile", entityId: ctx.user.id });
}

/**
 * Who can see a person's private profile: the person, church admins, and
 * leaders of a trip that person is actively on. Viewing someone else's
 * profile is recorded in the audit log.
 */
export async function canViewProfile(ctx: OrgContext, userId: string): Promise<boolean> {
  if (userId === ctx.user.id || ctx.isAdmin) return true;
  const theirTrips = await db.tripMember.findMany({
    where: { userId, orgId: ctx.org.id, status: { in: ["APPLIED", "APPROVED", "WAITLISTED"] } },
    include: { trip: true },
  });
  for (const tm of theirTrips) {
    const mine = await db.tripMember.findUnique({ where: { tripId_userId: { tripId: tm.tripId, userId: ctx.user.id } } });
    const perms = tripPermissions({
      orgRole: ctx.membership.role,
      tripStatus: tm.trip.status,
      leadersSeeFinances: tm.trip.leadersSeeFinances,
      membership: mine ? { role: mine.role, status: mine.status } : null,
    });
    if (perms.viewSensitive) return true;
  }
  return false;
}

export async function getProfile(ctx: OrgContext, userId: string) {
  const member = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.org.id, userId } }, include: { user: { select: { id: true, name: true, email: true } } } });
  if (!member || !(await canViewProfile(ctx, userId))) throw notFound("Person");
  const profile = await db.personProfile.findUnique({ where: { orgId_userId: { orgId: ctx.org.id, userId } } });
  if (userId !== ctx.user.id) {
    await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "profile.viewed", entityType: "PersonProfile", entityId: userId });
  }
  let sensitive: SensitiveInfo = {};
  if (profile?.sensitiveEncrypted) {
    try {
      sensitive = decryptJson<SensitiveInfo>(profile.sensitiveEncrypted);
    } catch (e) {
      console.error("[profiles] could not decrypt sensitive data", e);
      sensitive = { medicalNotes: "[Unable to decrypt — check DATA_ENCRYPTION_KEY]" };
    }
  }
  return { user: member.user, membership: member, profile, sensitive };
}
