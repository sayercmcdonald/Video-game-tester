import "server-only";
import Stripe from "stripe";
import { env } from "../env";

// A narrow interface over the Stripe calls we make. The real implementation
// talks to Stripe; tests use a fake. This keeps payment logic testable
// without ever faking a successful payment in the running app.

export type ChargeFacts = {
  id: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  feeCents: number | null; // null when Stripe hasn't settled the fee yet
};

export type PaymentIntentFacts = {
  id: string;
  status: string;
  amountReceived: number;
  currency: string;
  charge: ChargeFacts | null;
};

export type CheckoutSessionFacts = {
  id: string;
  status: string | null; // "open" | "complete" | "expired"
  paymentStatus: string; // "paid" | "unpaid" | "no_payment_required"
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
};

export interface PaymentGateway {
  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
    opts: { idempotencyKey: string; account: string | null },
  ): Promise<{ id: string; url: string }>;
  retrieveCheckoutSession(id: string, account: string | null): Promise<CheckoutSessionFacts>;
  retrievePaymentIntent(id: string, account: string | null): Promise<PaymentIntentFacts>;
  createRefund(
    params: { paymentIntentId: string; amountCents: number; reason?: "requested_by_customer" | "duplicate" | "fraudulent" },
    opts: { idempotencyKey: string; account: string | null },
  ): Promise<{ id: string; status: string | null }>;
  /** Connect onboarding */
  createConnectedAccount(params: { email: string; name: string }): Promise<{ id: string }>;
  createOnboardingLink(account: string, returnUrl: string, refreshUrl: string): Promise<string>;
  retrieveAccountChargesEnabled(account: string): Promise<boolean>;
}

let stripeClient: Stripe | null = null;

export function stripeConfigured(): boolean {
  return env().STRIPE_SECRET_KEY.length > 0;
}

function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY is empty).");
  stripeClient ??= new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "mission-trips" } });
  return stripeClient;
}

export function stripeSdk(): Stripe {
  return stripe();
}

function ctx(account: string | null): Stripe.RequestOptions {
  return account ? { stripeContext: account } : {};
}

function chargeFacts(charge: Stripe.Charge): ChargeFacts {
  const bt = charge.balance_transaction;
  return {
    id: charge.id,
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
    currency: charge.currency,
    feeCents: bt && typeof bt === "object" ? bt.fee : null,
  };
}

export const stripeGateway: PaymentGateway = {
  async createCheckoutSession(params, opts) {
    const s = await stripe().checkout.sessions.create(params, { idempotencyKey: opts.idempotencyKey, ...ctx(opts.account) });
    if (!s.url) throw new Error("Stripe did not return a checkout URL.");
    return { id: s.id, url: s.url };
  },
  async retrieveCheckoutSession(id, account) {
    const s = await stripe().checkout.sessions.retrieve(id, {}, ctx(account));
    return {
      id: s.id,
      status: s.status,
      paymentStatus: s.payment_status,
      paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
      amountTotal: s.amount_total,
      currency: s.currency,
    };
  },
  async retrievePaymentIntent(id, account) {
    const pi = await stripe().paymentIntents.retrieve(id, { expand: ["latest_charge.balance_transaction"] }, ctx(account));
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? chargeFacts(pi.latest_charge) : null;
    return { id: pi.id, status: pi.status, amountReceived: pi.amount_received, currency: pi.currency, charge };
  },
  async createRefund(params, opts) {
    const r = await stripe().refunds.create(
      { payment_intent: params.paymentIntentId, amount: params.amountCents, reason: params.reason },
      { idempotencyKey: opts.idempotencyKey, ...ctx(opts.account) },
    );
    return { id: r.id, status: r.status };
  },
  async createConnectedAccount({ email, name }) {
    // Standard-style account: the church owns its Stripe account and dashboard,
    // and Stripe handles identity verification and payouts directly with them.
    const a = await stripe().accounts.create({
      email,
      business_profile: { name },
      controller: {
        stripe_dashboard: { type: "full" },
        fees: { payer: "account" },
        losses: { payments: "stripe" },
        requirement_collection: "stripe",
      },
    });
    return { id: a.id };
  },
  async createOnboardingLink(account, returnUrl, refreshUrl) {
    const link = await stripe().accountLinks.create({ account, return_url: returnUrl, refresh_url: refreshUrl, type: "account_onboarding" });
    return link.url;
  },
  async retrieveAccountChargesEnabled(account) {
    const a = await stripe().accounts.retrieve(account);
    return a.charges_enabled;
  },
};

/** Extracts what we need from a Charge in a webhook payload. */
export function chargeFactsFromEvent(charge: Stripe.Charge): ChargeFacts {
  return chargeFacts(charge);
}
