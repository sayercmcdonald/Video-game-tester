import "server-only";
import type Stripe from "stripe";
import { db } from "../db";
import { env } from "../env";
import { stripeSdk, chargeFactsFromEvent, type PaymentGateway } from "./gateway";
import {
  applyChargeRefundTotal,
  applyDisputeClosed,
  applyDisputeOpened,
  markAsyncPaymentFailed,
  markCheckoutExpired,
  markDonationReceived,
  noteFailedAttempt,
  recordChargeFee,
} from "../services/donations";

export type WebhookOutcome = { status: 200 | 400 | 500; body: string };

/** Verifies Stripe's signature. Unsigned or tampered requests are rejected. */
export function verifyStripeEvent(rawBody: string, signature: string | null): Stripe.Event | null {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;
  try {
    return stripeSdk().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return null;
  }
}

/**
 * Records the event, skips it if already processed, and otherwise applies it.
 * On failure we return 500 so Stripe retries later (it retries for 3 days).
 */
export async function handleStripeWebhook(gateway: PaymentGateway, rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const event = verifyStripeEvent(rawBody, signature);
  if (!event) return { status: 400, body: "invalid signature" };

  const existing = await db.stripeEvent.findUnique({ where: { id: event.id } });
  if (existing?.processedAt) return { status: 200, body: "duplicate" };
  if (!existing) {
    await db.stripeEvent
      .create({
        data: { id: event.id, type: event.type, accountId: event.account ?? null, livemode: event.livemode, payload: JSON.parse(rawBody) },
      })
      .catch(() => undefined); // a concurrent delivery inserted it first; processing below is idempotent
  }

  try {
    await processStripeEvent(gateway, event);
    await db.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    return { status: 200, body: "ok" };
  } catch (err) {
    console.error(`[stripe] failed to process ${event.type} ${event.id}`, err);
    await db.stripeEvent
      .update({ where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: String(err).slice(0, 2000) } })
      .catch(() => undefined);
    return { status: 500, body: "processing failed" };
  }
}

function donationIdFrom(obj: { metadata?: Stripe.Metadata | null; client_reference_id?: string | null }): string | null {
  return obj.metadata?.donationId ?? obj.client_reference_id ?? null;
}

/** Guards against an event for a donation being applied under the wrong Stripe account. */
async function donationMatchesAccount(donationId: string, account: string | undefined) {
  const d = await db.donation.findUnique({ where: { id: donationId }, select: { stripeAccountId: true } });
  if (!d) return false;
  return (d.stripeAccountId ?? null) === (account ?? null);
}

export async function processStripeEvent(gateway: PaymentGateway, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const donationId = donationIdFrom(s);
      if (!donationId || !(await donationMatchesAccount(donationId, event.account))) return;
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (!pi) return;
      await db.donation.updateMany({ where: { id: donationId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: pi } });
      // For delayed methods (bank debits) "completed" arrives with payment_status "unpaid";
      // the gift stays pending until async_payment_succeeded.
      if (s.payment_status === "paid") await markDonationReceived(gateway, donationId, pi);
      return;
    }
    case "checkout.session.async_payment_failed": {
      const s = event.data.object;
      const donationId = donationIdFrom(s);
      if (donationId && (await donationMatchesAccount(donationId, event.account))) {
        await markAsyncPaymentFailed(donationId, "The bank payment did not go through.");
      }
      return;
    }
    case "checkout.session.expired": {
      const donationId = donationIdFrom(event.data.object);
      if (donationId && (await donationMatchesAccount(donationId, event.account))) await markCheckoutExpired(donationId);
      return;
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      const donationId = pi.metadata?.donationId;
      if (donationId && (await donationMatchesAccount(donationId, event.account))) {
        await noteFailedAttempt(donationId, pi.last_payment_error?.message ?? "Payment was declined.");
      }
      return;
    }
    case "charge.succeeded":
    case "charge.updated": {
      await recordChargeFee(chargeFactsFromEvent(event.data.object));
      return;
    }
    case "charge.refunded": {
      await applyChargeRefundTotal(chargeFactsFromEvent(event.data.object));
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
      const fee = (dispute.balance_transactions ?? []).reduce((sum, bt) => sum + (bt.fee ?? 0), 0);
      await applyDisputeOpened({ disputeId: dispute.id, chargeId, amountCents: dispute.amount, feeCents: fee });
      return;
    }
    case "charge.dispute.closed": {
      const dispute = event.data.object;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
      await applyDisputeClosed({ disputeId: dispute.id, chargeId, amountCents: dispute.amount, won: dispute.status === "won" });
      return;
    }
    case "account.updated": {
      const account = event.data.object;
      await db.organization.updateMany({ where: { stripeAccountId: account.id }, data: { stripeChargesEnabled: account.charges_enabled } });
      return;
    }
    default:
      return; // events we don't use are acknowledged and ignored
  }
}
