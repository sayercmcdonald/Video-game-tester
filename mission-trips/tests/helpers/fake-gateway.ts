import Stripe from "stripe";
import type { PaymentGateway, PaymentIntentFacts, CheckoutSessionFacts } from "@/server/payments/gateway";

/** An in-memory stand-in for Stripe's API, used only by tests. */
export class FakeGateway implements PaymentGateway {
  sessions = new Map<string, CheckoutSessionFacts & { account: string | null }>();
  intents = new Map<string, PaymentIntentFacts>();
  refunds: { paymentIntentId: string; amountCents: number; idempotencyKey: string; account: string | null }[] = [];
  createdSessions: { params: Stripe.Checkout.SessionCreateParams; idempotencyKey: string; account: string | null }[] = [];
  failNextCheckout = false;
  private n = 0;

  async createCheckoutSession(params: Stripe.Checkout.SessionCreateParams, opts: { idempotencyKey: string; account: string | null }) {
    if (this.failNextCheckout) {
      this.failNextCheckout = false;
      throw new Error("stripe down");
    }
    const id = `cs_test_${++this.n}`;
    this.createdSessions.push({ params, ...opts });
    this.sessions.set(id, {
      id,
      status: "open",
      paymentStatus: "unpaid",
      paymentIntentId: null,
      amountTotal: params.line_items?.[0]?.price_data?.unit_amount ?? null,
      currency: params.line_items?.[0]?.price_data?.currency ?? null,
      account: opts.account,
    });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }

  async retrieveCheckoutSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }

  async retrievePaymentIntent(id: string) {
    const pi = this.intents.get(id);
    if (!pi) throw new Error(`no such payment intent ${id}`);
    return pi;
  }

  async createRefund(params: { paymentIntentId: string; amountCents: number }, opts: { idempotencyKey: string; account: string | null }) {
    this.refunds.push({ ...params, ...opts });
    return { id: `re_${++this.n}`, status: "pending" };
  }

  async createConnectedAccount() {
    return { id: `acct_${++this.n}` };
  }
  async createOnboardingLink(account: string) {
    return `https://connect.stripe.test/${account}`;
  }
  async retrieveAccountChargesEnabled() {
    return true;
  }

  /** Simulates the donor paying: Stripe now has a succeeded payment intent with a charge and fee. */
  pay(sessionId: string, opts: { fee?: number; amount?: number; feeKnown?: boolean } = {}) {
    const s = this.sessions.get(sessionId)!;
    const piId = `pi_${sessionId}`;
    const amount = opts.amount ?? s.amountTotal!;
    this.intents.set(piId, {
      id: piId,
      status: "succeeded",
      amountReceived: amount,
      currency: s.currency!,
      charge: { id: `ch_${sessionId}`, amount, amountRefunded: 0, currency: s.currency!, feeCents: opts.feeKnown === false ? null : (opts.fee ?? Math.round(amount * 0.029) + 30) },
    });
    s.status = "complete";
    s.paymentStatus = "paid";
    s.paymentIntentId = piId;
    return { paymentIntentId: piId, chargeId: `ch_${sessionId}` };
  }
}

const sdk = new Stripe("sk_test_dummy_for_tests");

let evtSeq = 0;

/** Builds a webhook body + valid signature exactly as Stripe would send it. */
export function signedEvent(type: string, object: Record<string, unknown>, opts: { id?: string; account?: string | null; secret?: string } = {}) {
  const event = {
    id: opts.id ?? `evt_test_${Date.now()}_${++evtSeq}`,
    object: "event",
    type,
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    ...(opts.account ? { account: opts.account } : {}),
    data: { object },
  };
  const payload = JSON.stringify(event);
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? "whsec_test_secret" });
  return { payload, signature, id: event.id };
}

export function sessionObject(sessionId: string, donationId: string, paymentIntentId: string | null, paymentStatus: "paid" | "unpaid") {
  return {
    id: sessionId,
    object: "checkout.session",
    client_reference_id: donationId,
    metadata: { donationId },
    payment_intent: paymentIntentId,
    payment_status: paymentStatus,
  };
}

export function chargeObject(chargeId: string, amount: number, amountRefunded: number, fee: number | null = null) {
  return {
    id: chargeId,
    object: "charge",
    amount,
    amount_refunded: amountRefunded,
    currency: "usd",
    balance_transaction: fee == null ? "txn_x" : { id: "txn_x", object: "balance_transaction", fee },
  };
}
