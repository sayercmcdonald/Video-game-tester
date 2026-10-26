import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "./auth/session";
import { notFound, forbidden } from "./errors";
import { tripPermissions, type TripPermissions } from "./permissions";
import type { Organization, Membership, Trip, TripMember } from "@/generated/prisma/client";

export type OrgContext = {
  user: SessionUser;
  org: Organization;
  membership: Membership;
  isAdmin: boolean;
};

export type TripContext = OrgContext & {
  trip: Trip;
  tripMember: TripMember | null;
  perms: TripPermissions;
};

// ── Request-bound helpers (read the session cookie) ──

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await validateSessionToken(token);
  return result?.user ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const path = (await headers()).get("x-pathname") ?? "/";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.platformRole !== "PLATFORM_ADMIN") throw notFound("Page");
  return user;
}

export const requireOrg = cache(async (orgSlug: string): Promise<OrgContext> => {
  const user = await requireUser();
  return orgContextFor(user, orgSlug);
});

export async function requireOrgAdmin(orgSlug: string): Promise<OrgContext> {
  const ctx = await requireOrg(orgSlug);
  if (!ctx.isAdmin) throw forbidden();
  return ctx;
}

export const requireTrip = cache(async (orgSlug: string, tripId: string): Promise<TripContext> => {
  const ctx = await requireOrg(orgSlug);
  return tripContextFor(ctx, tripId);
});

// ── Pure loaders (used by the helpers above and directly by tests) ──

/** Loads a church only if the user belongs to it. Non-members get "not found". */
export async function orgContextFor(user: SessionUser, orgSlug: string): Promise<OrgContext> {
  const membership = await db.membership.findFirst({
    where: { userId: user.id, org: { slug: orgSlug } },
    include: { org: true },
  });
  if (!membership) throw notFound("Organization");
  if (membership.org.status === "SUSPENDED") throw forbidden("This organization has been suspended.");
  const { org, ...m } = membership;
  return { user, org, membership: m, isAdmin: m.role === "ADMIN" };
}

/** Loads a trip only within the current church, and only if the user may see it. */
export async function tripContextFor(ctx: OrgContext, tripId: string): Promise<TripContext> {
  const trip = await db.trip.findFirst({ where: { id: tripId, orgId: ctx.org.id } });
  if (!trip) throw notFound("Trip");
  const tripMember = await db.tripMember.findUnique({
    where: { tripId_userId: { tripId: trip.id, userId: ctx.user.id } },
  });
  const perms = tripPermissions({
    orgRole: ctx.membership.role,
    tripStatus: trip.status,
    leadersSeeFinances: trip.leadersSeeFinances,
    membership: tripMember ? { role: tripMember.role, status: tripMember.status } : null,
  });
  if (!perms.view) throw notFound("Trip");
  return { ...ctx, trip, tripMember, perms };
}

export function assertPerm(ok: boolean, message?: string): asserts ok {
  if (!ok) throw forbidden(message);
}
