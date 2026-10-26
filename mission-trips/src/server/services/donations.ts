import "server-only";
import { z } from "zod";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { env } from "../env";
import { hashToken, newToken } from "../crypto";
import { appUrl, queueEmail } from "../email";
import { notifyUsers } from "../notify";
import { AppError, invalid, notFound } from "../errors";
import { assertPerm, type TripContext } from "../context";
import { stripeConfigured, type PaymentGateway, type ChargeFacts } from "../payments/gateway";
import { zEmail, zMoney, zName, zOptionalText, zDate } from "@/lib/validation";
import { formatMoney } from "@/lib/money";
import { Prisma, type Donation, type Organization } from "@/generated/prisma/client";
import { tripManagerUserIds } from "./trips";

export const ONLINE_MIN_CENTS = 500; // $5
export const ONLINE_MAX_CENTS = 5_000_000; // $50,000

// ───────────────────────── Can this church take online gifts? ─────────────────────────

export type GivingAvailability = { enabled: true; account: string | null } | { enabled: false; reason: string };

export function givingAvailability(org: Pick<Organization, "status" | "stripeAccountId" | "stripeChargesEnabled">): GivingAvailability {
  if (!stripeConfigured()) return { enabled: false, reason: "Online giving isn't configured on this server yet." };
  if (org.status !== "ACTIVE") return { enabled: false, reason: "This church's giving page isn't active yet." };
  if (env().STRIPE_MODE === "platform") return { enabled: true, account: null };
  if (!org.stripeAccountId || !org.stripeChargesEnabled) {
    return { enabled: false, reason: "This church hasn't finished connecting its payment account yet." };
  }
  return { enabled: true, account: org.stripeAccountId };
}

// ───────────────────────────── Starting a gift ─────────────────────────────

export const checkoutSchema = z.object({
  amount: zMoney("Gift amount", { min: ONLINE_MIN_CENTS, max: ONLINE_MAX_CENTS }),
  donorName: zName("Your name", 120),
  donorEmail: zEmail,
  isAnonymous: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  message: zOptionalText(500),
});

/**
 * Creates a PENDING donation and a Stripe Checkout session. The donation only
 * becomes SUCCEEDED when Stripe's signed webhook says the money arrived.
 */
export async function startCheckout(
  gateway: PaymentGateway,
  input: { orgSlug: string; campaignSlug: string; donorUserId?: string | null; form: z.input<typeof checkoutSchema> },
): Promise<{ donationId: string; url: string }> {
  const data = checkoutSchema.parse(input.form);
  const campaign = await db.campaign.findFirst({
    where: {
      slug: input.campaignSlug,
      isPublic: true,
      isClosed: false,
      org: { slug: input.orgSlug },
      trip: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    },
    include: { org: true, trip: true },
  });
  if (!campaign) throw notFound("Campaign");
  const availability = givingAvailability(campaign.org);
  if (!availability.enabled) throw new AppError(availability.reason, "UNAVAILABLE");

  const donation = await db.donation.create({
    data: {
      orgId: campaign.orgId,
      tripId: campaign.tripId,
      campaignId: campaign.id,
      donorUserId: input.donorUserId ?? null,
      donorName: data.donorName,
      donorEmail: data.donorEmail,
      isAnonymous: data.isAnonymous,
      message: data.message ?? null,
      amountCents: data.amount,
      currency: campaign.org.currency,
      method: "CARD_ONLINE",
      status: "PENDING",
      stripeAccountId: availability.account,
    },
  });

  const base = `/give/${campaign.org.slug}/${campaign.slug}`;
  try {
    const session = await gateway.createCheckoutSession(
      {
        mode: "payment",
        submit_type: "donate",
        customer_email: data.donorEmail,
        client_reference_id: donation.id,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: campaign.org.currency,
              unit_amount: data.amount,
              product_data: { name: `Gift: ${campaign.title}`.slice(0, 250), description: `${campaign.org.name} · ${campaign.trip.name}`.slice(0, 250) },
            },
          },
        ],
        metadata: { donationId: donation.id, orgId: campaign.orgId, campaignId: campaign.id },
        payment_intent_data: {
          description: `Gift to ${campaign.org.name}: ${campaign.title}`.slice(0, 500),
          metadata: { donationId: donation.id, orgId: campaign.orgId, campaignId: campaign.id },
        },
        success_url: appUrl(`${base}/thank-you?donation=${donation.id}`),
        cancel_url: appUrl(`${base}?canceled=1`),
      },
      { idempotencyKey: `checkout:${donation.id}`, account: availability.account },
    );
    await db.donation.update({ where: { id: donation.id }, data: { stripeCheckoutSessionId: session.id } });
    return { donationId: donation.id, url: session.url };
  } catch (err) {
    console.error("[donations] checkout creation failed", err);
    await db.donation.update({ where: { id: donation.id }, data: { status: "FAILED", failureReason: "Could not start checkout" } });
    throw new AppError("We couldn't start the secure payment page. No money was charged. Please try again.", "UNAVAILABLE");
  }
}

// ───────────────────────────── Recording received money ─────────────────────────────

async function insertLedger(tx: Tx, data: Prisma.LedgerEntryUncheckedCreateInput): Promise<boolean> {
  // sourceRef is unique: a duplicate event can never double-count money.
  if (data.sourceRef) {
    const exists = await tx.ledgerEntry.findUnique({ where: { sourceRef: data.sourceRef }, select: { id: true } });
    if (exists) return false;
  }
  await tx.ledgerEntry.create({ data });
  return true;
}

async function restrictionFor(tx: Tx, campaignId: string) {
  const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { restriction: true } });
  return c.restriction;
}

async function nextReceiptNumber(tx: Tx, orgId: string): Promise<number> {
  const org = await tx.organization.update({
    where: { id: orgId },
    data: { nextReceiptNumber: { increment: 1 } },
    select: { nextReceiptNumber: true },
  });
  return org.nextReceiptNumber - 1;
}

/**
 * Marks a donation as received using facts fetched from Stripe. Idempotent:
 * calling it twice (duplicate webhooks, reconciliation) has no extra effect.
 */
export async function markDonationReceived(gateway: PaymentGateway, donationId: string, paymentIntentId: string) {
  const donation = await db.donation.findUnique({ where: { id: donationId } });
  if (!donation) throw new Error(`Donation ${donationId} not found for payment ${paymentIntentId}`);
  if (donation.status !== "PENDING" && donation.status !== "CANCELED" && donation.status !== "FAILED") return { changed: false };

  const pi = await gateway.retrievePaymentIntent(paymentIntentId, donation.stripeAccountId);
  if (pi.status !== "succeeded") return { changed: false };
  if (pi.amountReceived !== donation.amountCents || pi.currency !== donation.currency) {
    // Never silently accept a mismatch; surface it for a human.
    throw new Error(
      `Amount mismatch for donation ${donation.id}: expected ${donation.amountCents} ${donation.currency}, Stripe reports ${pi.amountReceived} ${pi.currency}`,
    );
  }

  const receiptToken = newToken();
  const result = await db.$transaction(async (tx) => {
    const claimed = await tx.donation.updateMany({
      where: { id: donation.id, status: { in: ["PENDING", "CANCELED", "FAILED"] } },
      data: {
        status: "SUCCEEDED",
        receivedAt: new Date(),
        failureReason: null,
        stripePaymentIntentId: pi.id,
        stripeChargeId: pi.charge?.id ?? null,
        feeCents: pi.charge?.feeCents ?? 0,
        receiptTokenHash: hashToken(receiptToken),
      },
    });
    if (claimed.count === 0) return null; // another worker got here first
    const receiptNumber = await nextReceiptNumber(tx, donation.orgId);
    await tx.donation.update({ where: { id: donation.id }, data: { receiptNumber } });
    const restriction = await restrictionFor(tx, donation.campaignId);
    const common = { orgId: donation.orgId, tripId: donation.tripId, campaignId: donation.campaignId, donationId: donation.id, restriction, occurredAt: new Date() };
    await insertLedger(tx, { ...common, type: "DONATION", amountCents: donation.amountCents, sourceRef: `stripe:pi:${pi.id}:received`, memo: "Online gift" });
    if (pi.charge?.feeCents) {
      await insertLedger(tx, { ...common, type: "PROCESSING_FEE", amountCents: -pi.charge.feeCents, sourceRef: `stripe:charge:${pi.charge.id}:fee`, memo: "Stripe processing fee" });
    }
    await audit({ orgId: donation.orgId, actorUserId: null, action: "donation.succeeded", entityType: "Donation", entityId: donation.id, metadata: { paymentIntentId: pi.id } }, tx);
    return { receiptNumber };
  });
  if (!result) return { changed: false };
  await afterDonationReceived(donation.id, receiptToken);
  return { changed: true };
}

/** Receipt email and team notifications. Runs after the money is safely recorded. */
async function afterDonationReceived(donationId: string, receiptToken: string | null) {
  const d = await db.donation.findUniqueOrThrow({
    where: { id: donationId },
    include: { org: true, campaign: { include: { tripMember: true } }, trip: true },
  });
  if (d.donorEmail && receiptToken) {
    await queueEmail({
      to: d.donorEmail,
      subject: `Your gift receipt from ${d.org.name}`,
      text:
        `Dear ${d.donorName},\n\nThank you for your gift of ${formatMoney(d.amountCents, d.currency)} to "${d.campaign.title}".\n\n` +
        `View or print your receipt (#${d.receiptNumber}):\n${appUrl(`/receipts/${d.id}?token=${receiptToken}`)}\n\n` +
        (d.org.receiptStatement ? `${d.org.receiptStatement}\n\n` : "") +
        `${d.org.name}`,
      dedupeKey: `receipt:${d.id}`,
    });
  }
  const recipients = new Set(await tripManagerUserIds(d.tripId, d.orgId));
  if (d.campaign.tripMember) recipients.add(d.campaign.tripMember.userId);
  const who = d.isAnonymous ? "An anonymous donor" : d.donorName;
  await notifyUsers({
    userIds: [...recipients],
    orgId: d.orgId,
    title: `New gift: ${formatMoney(d.amountCents, d.currency)}`,
    body: `${who} gave ${formatMoney(d.amountCents, d.currency)} to "${d.campaign.title}".`,
    href: `/o/${d.org.slug}/trips/${d.tripId}/fundraising`,
    category: "donations",
    dedupePrefix: `gift:${d.id}`,
  });
}

/** Records a processor fee that wasn't available when the payment first succeeded. */
export async function recordChargeFee(charge: ChargeFacts) {
  if (charge.feeCents == null || charge.feeCents === 0) return;
  const donation = await db.donation.findFirst({ where: { stripeChargeId: charge.id } });
  if (!donation) return;
  await db.$transaction(async (tx) => {
    const inserted = await insertLedger(tx, {
      orgId: donation.orgId,
      tripId: donation.tripId,
      campaignId: donation.campaignId,
      donationId: donation.id,
      type: "PROCESSING_FEE",
      amountCents: -charge.feeCents!,
      restriction: await restrictionFor(tx, donation.campaignId),
      occurredAt: new Date(),
      sourceRef: `stripe:charge:${charge.id}:fee`,
      memo: "Stripe processing fee",
    });
    if (inserted) await tx.donation.update({ where: { id: donation.id }, data: { feeCents: charge.feeCents! } });
  });
}

/**
 * Applies Stripe's cumulative refunded amount for a charge. Because we compare
 * against the total refunded so far, repeated or out-of-order events are harmless.
 */
export async function applyChargeRefundTotal(charge: ChargeFacts) {
  const donation = await db.donation.findFirst({ where: { stripeChargeId: charge.id } });
  if (!donation) return { changed: false };
  return applyRefundTotal(donation, charge.amountRefunded, `stripe:charge:${charge.id}:refunded_to:${charge.amountRefunded}`, null);
}

async function applyRefundTotal(donation: Donation, newTotal: number, sourceRef: string, actorUserId: string | null) {
  if (newTotal > donation.amountCents) throw new Error(`Refund total exceeds gift for donation ${donation.id}`);
  return db.$transaction(async (tx) => {
    const fresh = await tx.donation.findUniqueOrThrow({ where: { id: donation.id } });
    const delta = newTotal - fresh.refundedCents;
    if (delta <= 0) return { changed: false };
    const claimed = await tx.donation.updateMany({
      where: { id: donation.id, refundedCents: fresh.refundedCents },
      data: {
        refundedCents: newTotal,
        status: fresh.status === "DISPUTED" ? "DISPUTED" : newTotal === fresh.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });
    if (claimed.count === 0) return { changed: false };
    await insertLedger(tx, {
      orgId: fresh.orgId,
      tripId: fresh.tripId,
      campaignId: fresh.campaignId,
      donationId: fresh.id,
      type: "REFUND",
      amountCents: -delta,
      restriction: await restrictionFor(tx, fresh.campaignId),
      occurredAt: new Date(),
      sourceRef,
      memo: `Refund of ${formatMoney(delta, fresh.currency)}`,
      createdById: actorUserId,
    });
    await audit({ orgId: fresh.orgId, actorUserId, action: "donation.refunded", entityType: "Donation", entityId: fresh.id, metadata: { amountCents: delta, totalRefunded: newTotal } }, tx);
    return { changed: true };
  });
}

export async function markCheckoutExpired(donationId: string) {
  await db.donation.updateMany({ where: { id: donationId, status: "PENDING" }, data: { status: "CANCELED", failureReason: "Checkout was not completed" } });
}

export async function markAsyncPaymentFailed(donationId: string, reason: string) {
  await db.donation.updateMany({ where: { id: donationId, status: "PENDING" }, data: { status: "FAILED", failureReason: reason.slice(0, 300) } });
}

export async function noteFailedAttempt(donationId: string, reason: string) {
  // The donor can retry within the same checkout page, so the gift stays PENDING.
  await db.donation.updateMany({ where: { id: donationId, status: "PENDING" }, data: { failureReason: reason.slice(0, 300) } });
}

export async function applyDisputeOpened(input: { disputeId: string; chargeId: string; amountCents: number; feeCents: number }) {
  const donation = await db.donation.findFirst({ where: { stripeChargeId: input.chargeId } });
  if (!donation) return;
  await db.$transaction(async (tx) => {
    const restriction = await restrictionFor(tx, donation.campaignId);
    const common = { orgId: donation.orgId, tripId: donation.tripId, campaignId: donation.campaignId, donationId: donation.id, restriction, occurredAt: new Date() };
    const inserted = await insertLedger(tx, { ...common, type: "DISPUTE", amountCents: -input.amountCents, sourceRef: `stripe:dispute:${input.disputeId}:opened`, memo: "Chargeback opened by donor's bank" });
    if (input.feeCents > 0) {
      await insertLedger(tx, { ...common, type: "PROCESSING_FEE", amountCents: -input.feeCents, sourceRef: `stripe:dispute:${input.disputeId}:fee`, memo: "Dispute fee" });
    }
    if (inserted) {
      await tx.donation.update({ where: { id: donation.id }, data: { status: "DISPUTED" } });
      await audit({ orgId: donation.orgId, actorUserId: null, action: "donation.disputed", entityType: "Donation", entityId: donation.id, metadata: { disputeId: input.disputeId } }, tx);
    }
  });
}

export async function applyDisputeClosed(input: { disputeId: string; chargeId: string; amountCents: number; won: boolean }) {
  const donation = await db.donation.findFirst({ where: { stripeChargeId: input.chargeId } });
  if (!donation) return;
  await db.$transaction(async (tx) => {
    let inserted = false;
    if (input.won) {
      inserted = await insertLedger(tx, {
        orgId: donation.orgId,
        tripId: donation.tripId,
        campaignId: donation.campaignId,
        donationId: donation.id,
        type: "DISPUTE_REVERSAL",
        amountCents: input.amountCents,
        restriction: await restrictionFor(tx, donation.campaignId),
        occurredAt: new Date(),
        sourceRef: `stripe:dispute:${input.disputeId}:won`,
        memo: "Chargeback resolved in the church's favor",
      });
    }
    if (inserted) {
      const status = donation.refundedCents === 0 ? "SUCCEEDED" : donation.refundedCents === donation.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await tx.donation.update({ where: { id: donation.id }, data: { status } });
    }
    await audit({ orgId: donation.orgId, actorUserId: null, action: input.won ? "donation.dispute_won" : "donation.dispute_lost", entityType: "Donation", entityId: donation.id }, tx);
  });
}

// ───────────────────────────── Admin actions ─────────────────────────────

export const refundSchema = z.object({
  amount: zMoney("Refund amount", { min: 1 }),
  reason: z.enum(["requested_by_customer", "duplicate", "fraudulent"]).default("requested_by_customer"),
});

/**
 * Church admins request refunds. For online gifts we ask Stripe to refund and
 * record it when Stripe confirms via webhook. Offline gifts are recorded directly.
 */
export async function requestRefund(gateway: PaymentGateway, t: TripContext, donationId: string, input: z.input<typeof refundSchema>) {
  assertPerm(t.perms.administerFinances, "Only church administrators can issue refunds.");
  const data = refundSchema.parse(input);
  const donation = await db.donation.findFirst({ where: { id: donationId, orgId: t.org.id, tripId: t.trip.id } });
  if (!donation) throw notFound("Donation");
  if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(donation.status)) throw invalid("Only received gifts can be refunded.");
  const remaining = donation.amountCents - donation.refundedCents;
  if (data.amount > remaining) throw invalid(`You can refund at most ${formatMoney(remaining, donation.currency)}.`);

  if (donation.method === "CARD_ONLINE") {
    if (!donation.stripePaymentIntentId) throw invalid("This gift has no payment record to refund.");
    const refund = await gateway.createRefund(
      { paymentIntentId: donation.stripePaymentIntentId, amountCents: data.amount, reason: data.reason },
      // Same gift + same refunded-so-far + same amount = same request, so double-clicks don't double-refund.
      { idempotencyKey: `refund:${donation.id}:${donation.refundedCents}:${data.amount}`, account: donation.stripeAccountId },
    );
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "donation.refund_requested", entityType: "Donation", entityId: donation.id, metadata: { amountCents: data.amount, refundId: refund.id } });
    return { pending: true as const };
  }
  await applyRefundTotal(donation, donation.refundedCents + data.amount, `manual:refund:${donation.id}:${donation.refundedCents + data.amount}`, t.user.id);
  return { pending: false as const };
}

export const offlineDonationSchema = z.object({
  campaignId: z.string().min(1, "Choose where the gift goes."),
  amount: zMoney("Amount", { min: 1, max: 100_000_000 }),
  donorName: zName("Donor name", 120),
  donorEmail: zEmail.optional(),
  method: z.enum(["CHECK", "CASH", "OTHER_OFFLINE"]),
  reference: zOptionalText(100),
  receivedOn: zDate("Date received"),
  isAnonymous: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

/** A check or cash gift recorded by a church admin. Clearly marked as manually recorded. */
export async function recordOfflineDonation(t: TripContext, input: z.input<typeof offlineDonationSchema>) {
  assertPerm(t.perms.administerFinances, "Only church administrators can record offline gifts.");
  const data = offlineDonationSchema.parse(input);
  const campaign = await db.campaign.findFirst({ where: { id: data.campaignId, tripId: t.trip.id, orgId: t.org.id } });
  if (!campaign) throw notFound("Campaign");
  const receiptToken = newToken();
  const donation = await db.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(tx, t.org.id);
    const d = await tx.donation.create({
      data: {
        orgId: t.org.id,
        tripId: t.trip.id,
        campaignId: campaign.id,
        donorName: data.donorName,
        donorEmail: data.donorEmail ?? null,
        isAnonymous: data.isAnonymous,
        amountCents: data.amount,
        currency: t.org.currency,
        method: data.method,
        status: "SUCCEEDED",
        receivedAt: data.receivedOn,
        recordedById: t.user.id,
        offlineReference: data.reference ?? null,
        receiptNumber,
        receiptTokenHash: hashToken(receiptToken),
      },
    });
    await insertLedger(tx, {
      orgId: t.org.id,
      tripId: t.trip.id,
      campaignId: campaign.id,
      donationId: d.id,
      type: "DONATION",
      amountCents: data.amount,
      restriction: campaign.restriction,
      occurredAt: data.receivedOn,
      memo: `${data.method === "CHECK" ? "Check" : data.method === "CASH" ? "Cash" : "Offline"} gift${data.reference ? ` (${data.reference})` : ""}`,
      createdById: t.user.id,
      sourceRef: `manual:donation:${d.id}`,
    });
    await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "donation.offline_recorded", entityType: "Donation", entityId: d.id, metadata: { amountCents: data.amount, method: data.method } }, tx);
    return d;
  });
  await afterDonationReceived(donation.id, receiptToken);
  return donation;
}

// ───────────────────────────── Reconciliation ─────────────────────────────

/**
 * Safety net for missed webhooks: asks Stripe about gifts that have been
 * pending for a while and applies the real outcome.
 */
export async function reconcilePendingDonations(gateway: PaymentGateway, olderThanMinutes = 30) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const pending = await db.donation.findMany({
    where: { status: "PENDING", method: "CARD_ONLINE", stripeCheckoutSessionId: { not: null }, createdAt: { lt: cutoff } },
    take: 100,
  });
  const out = { checked: pending.length, received: 0, expired: 0, errors: 0 };
  for (const d of pending) {
    try {
      const s = await gateway.retrieveCheckoutSession(d.stripeCheckoutSessionId!, d.stripeAccountId);
      if (s.paymentStatus === "paid" && s.paymentIntentId) {
        const r = await markDonationReceived(gateway, d.id, s.paymentIntentId);
        if (r.changed) out.received++;
      } else if (s.status === "expired") {
        await markCheckoutExpired(d.id);
        out.expired++;
      }
    } catch (e) {
      out.errors++;
      console.error("[reconcile] failed for donation", d.id, e);
    }
  }
  return out;
}

// ───────────────────────────── Receipts ─────────────────────────────

/** A receipt can be opened by its donor (signed in with a verified matching email), church admins, or the emailed link. */
export async function loadReceipt(donationId: string, opts: { token?: string | null; userId?: string | null; userEmail?: string | null; userVerified?: boolean }) {
  const d = await db.donation.findUnique({
    where: { id: donationId },
    include: { org: true, campaign: { select: { title: true, restriction: true, designationNote: true } }, trip: { select: { name: true } } },
  });
  if (!d || d.receiptNumber == null) return null;
  const byToken = !!opts.token && !!d.receiptTokenHash && hashToken(opts.token) === d.receiptTokenHash;
  const byDonor = !!opts.userId && (d.donorUserId === opts.userId || (!!opts.userVerified && !!d.donorEmail && d.donorEmail === opts.userEmail));
  let byAdmin = false;
  if (opts.userId && !byToken && !byDonor) {
    const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: d.orgId, userId: opts.userId } } });
    byAdmin = m?.role === "ADMIN";
  }
  if (!byToken && !byDonor && !byAdmin) return null;
  return d;
}
