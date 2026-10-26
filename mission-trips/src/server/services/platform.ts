import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { env } from "../env";
import { appUrl } from "../email";
import { assertPerm, type OrgContext } from "../context";
import { AppError, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { stripeConfigured, type PaymentGateway } from "../payments/gateway";
import type { SessionUser } from "../auth/session";
import type { OrgStatus } from "@/generated/prisma/client";

// ── Church payment setup (Stripe Connect) ──

export async function startStripeOnboarding(gateway: PaymentGateway, ctx: OrgContext): Promise<string> {
  assertPerm(ctx.isAdmin);
  if (!stripeConfigured()) throw new AppError("Online payments aren't configured on this server yet.", "UNAVAILABLE");
  if (env().STRIPE_MODE !== "connect") throw new AppError("This server uses a single platform payment account; no setup is needed.", "INVALID");
  let account = ctx.org.stripeAccountId;
  if (!account) {
    const created = await gateway.createConnectedAccount({ email: ctx.org.contactEmail, name: ctx.org.legalName ?? ctx.org.name });
    // Only set if still empty, so two admins clicking at once can't create two accounts on record.
    const res = await db.organization.updateMany({ where: { id: ctx.org.id, stripeAccountId: null }, data: { stripeAccountId: created.id } });
    account = res.count === 1 ? created.id : (await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } })).stripeAccountId!;
    await audit({ orgId: ctx.org.id, actorUserId: ctx.user.id, action: "payments.account_created", entityType: "Organization", entityId: ctx.org.id, metadata: { account } });
  }
  return gateway.createOnboardingLink(account, appUrl(`/o/${ctx.org.slug}/settings/payments?return=1`), appUrl(`/o/${ctx.org.slug}/settings/payments?refresh=1`));
}

export async function refreshStripeStatus(gateway: PaymentGateway, ctx: OrgContext) {
  assertPerm(ctx.isAdmin);
  if (!ctx.org.stripeAccountId || !stripeConfigured()) return ctx.org.stripeChargesEnabled;
  const enabled = await gateway.retrieveAccountChargesEnabled(ctx.org.stripeAccountId);
  if (enabled !== ctx.org.stripeChargesEnabled) {
    await db.organization.update({ where: { id: ctx.org.id }, data: { stripeChargesEnabled: enabled } });
  }
  return enabled;
}

// ── Platform administration ──

function assertPlatformAdmin(user: SessionUser) {
  if (user.platformRole !== "PLATFORM_ADMIN") throw notFound("Page");
}

/** Platform admins see operational facts about churches, not their private records. */
export async function listOrganizations(user: SessionUser) {
  assertPlatformAdmin(user);
  const orgs = await db.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { memberships: true, trips: true } } },
  });
  return orgs;
}

export async function setOrganizationStatus(user: SessionUser, orgId: string, status: OrgStatus) {
  assertPlatformAdmin(user);
  const org = await db.organization.update({ where: { id: orgId }, data: { status } });
  await audit({ orgId, actorUserId: user.id, action: "platform.org_status_changed", entityType: "Organization", entityId: orgId, metadata: { status } });
  if (status === "ACTIVE") {
    const admins = await db.membership.findMany({ where: { orgId, role: "ADMIN" }, select: { userId: true } });
    await notifyUsers({
      userIds: admins.map((a) => a.userId),
      orgId,
      title: `${org.name} is approved`,
      body: `${org.name} has been approved. Once your payment account is connected, your giving pages can accept gifts.`,
      href: `/o/${org.slug}/settings/payments`,
      category: "account",
    });
  }
  return org;
}

export async function operationsHealth(user: SessionUser) {
  assertPlatformAdmin(user);
  const [failedEvents, unprocessedEvents, failedEmails, queuedEmails, stalePending] = await Promise.all([
    db.stripeEvent.findMany({ where: { processedAt: null, lastError: { not: null } }, orderBy: { receivedAt: "desc" }, take: 20 }),
    db.stripeEvent.count({ where: { processedAt: null } }),
    db.emailOutbox.count({ where: { status: "FAILED" } }),
    db.emailOutbox.count({ where: { status: "QUEUED" } }),
    db.donation.count({ where: { status: "PENDING", stripePaymentIntentId: { not: null }, createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } }),
  ]);
  return { failedEvents, unprocessedEvents, failedEmails, queuedEmails, stalePending };
}
