// Test data builders. Everything here writes to the isolated test database.
import { db } from "@/server/db";
import { hashToken } from "@/server/crypto";
import type { SessionUser } from "@/server/auth/session";
import { orgContextFor, tripContextFor } from "@/server/context";
import { resetRateLimits } from "@/server/rate-limit";

let seq = 0;
const next = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

export async function resetDb() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
  );
  // TRUNCATE bypasses the append-only row triggers, which is what we want between tests.
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  resetRateLimits();
}

export async function makeUser(overrides: Partial<{ name: string; email: string; platformRole: "USER" | "PLATFORM_ADMIN"; verified: boolean }> = {}): Promise<SessionUser> {
  const id = next();
  const u = await db.user.create({
    data: {
      name: overrides.name ?? `User ${id}`,
      email: (overrides.email ?? `user-${id}@example.test`).toLowerCase(),
      passwordHash: "x",
      platformRole: overrides.platformRole ?? "USER",
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    },
  });
  return { id: u.id, email: u.email, name: u.name, platformRole: u.platformRole, emailVerifiedAt: u.emailVerifiedAt };
}

export async function makeOrg(opts: { status?: "ACTIVE" | "PENDING_REVIEW" | "SUSPENDED"; stripe?: boolean } = {}) {
  const id = next();
  const admin = await makeUser({ name: `Admin ${id}` });
  const org = await db.organization.create({
    data: {
      name: `Church ${id}`,
      slug: `church-${id}`,
      contactEmail: `office-${id}@example.test`,
      status: opts.status ?? "ACTIVE",
      stripeAccountId: opts.stripe ? `acct_${id}` : null,
      stripeChargesEnabled: !!opts.stripe,
    },
  });
  await db.membership.create({ data: { orgId: org.id, userId: admin.id, role: "ADMIN" } });
  const ctx = await orgContextFor(admin, org.slug);
  return { org, admin, ctx };
}

export async function addMember(orgId: string, user?: SessionUser, role: "ADMIN" | "MEMBER" = "MEMBER") {
  const u = user ?? (await makeUser());
  await db.membership.create({ data: { orgId, userId: u.id, role } });
  return u;
}

export async function makeTrip(orgId: string, overrides: Partial<{ status: "DRAFT" | "OPEN" | "IN_PROGRESS" | "COMPLETED"; applicationsOpen: boolean; participantLimit: number | null }> = {}) {
  const id = next();
  const trip = await db.trip.create({
    data: {
      orgId,
      name: `Trip ${id}`,
      slug: `trip-${id}`,
      destination: "Guatemala City, Guatemala",
      startDate: new Date("2027-06-10T00:00:00Z"),
      endDate: new Date("2027-06-20T00:00:00Z"),
      status: overrides.status ?? "OPEN",
      applicationsOpen: overrides.applicationsOpen ?? true,
      participantLimit: overrides.participantLimit ?? null,
      budgetCents: 2_000_000,
      fundraisingGoalCents: 2_500_000,
      defaultParticipantGoalCents: 250_000,
    },
  });
  const fund = await db.campaign.create({
    data: { orgId, tripId: trip.id, kind: "TRIP", slug: `fund-${id}`, title: "Team fund", goalCents: 2_500_000 },
  });
  return { trip, fund };
}

export async function addTripMember(
  trip: { id: string; orgId: string },
  user: SessionUser,
  role: "LEADER" | "PARTICIPANT" = "PARTICIPANT",
  status: "APPLIED" | "APPROVED" | "WAITLISTED" | "DECLINED" | "WITHDRAWN" = "APPROVED",
) {
  const exists = await db.membership.findUnique({ where: { orgId_userId: { orgId: trip.orgId, userId: user.id } } });
  if (!exists) await db.membership.create({ data: { orgId: trip.orgId, userId: user.id, role: "MEMBER" } });
  return db.tripMember.create({ data: { orgId: trip.orgId, tripId: trip.id, userId: user.id, role, status } });
}

export async function ctxFor(user: SessionUser, orgSlug: string) {
  return orgContextFor(user, orgSlug);
}

export async function tripCtxFor(user: SessionUser, orgSlug: string, tripId: string) {
  return tripContextFor(await orgContextFor(user, orgSlug), tripId);
}

export { hashToken };
