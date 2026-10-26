import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { handleStripeWebhook } from "@/server/payments/webhooks";
import {
  givingAvailability,
  loadReceipt,
  reconcilePendingDonations,
  recordOfflineDonation,
  requestRefund,
  startCheckout,
} from "@/server/services/donations";
import { ledgerTotals } from "@/server/services/ledger";
import { FakeGateway, chargeObject, sessionObject, signedEvent } from "./helpers/fake-gateway";
import { addTripMember, makeOrg, makeTrip, makeUser, resetDb, tripCtxFor } from "./helpers/factory";
import { tripContextFor } from "@/server/context";

let gw: FakeGateway;
beforeEach(async () => {
  await resetDb();
  gw = new FakeGateway();
});

const form = (amount = "100.00") => ({ amount, donorName: "Dana Donor", donorEmail: "Dana@Example.test" });

async function setup() {
  const o = await makeOrg({ stripe: true });
  const { trip, fund } = await makeTrip(o.org.id);
  return { ...o, trip, fund };
}

async function giveAndPay(s: Awaited<ReturnType<typeof setup>>, amount = "100.00", fee = 320) {
  const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form(amount) });
  const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
  const { paymentIntentId, chargeId } = gw.pay(d.stripeCheckoutSessionId!, { fee });
  const evt = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), {
    account: s.org.stripeAccountId,
  });
  const res = await handleStripeWebhook(gw, evt.payload, evt.signature);
  return { donationId, paymentIntentId, chargeId, evt, res };
}

describe("starting a gift", () => {
  it("creates a pending donation without counting any money", async () => {
    const s = await setup();
    const { donationId, url } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form("250") });
    expect(url).toContain("checkout.stripe.test");
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    expect(d).toMatchObject({ status: "PENDING", amountCents: 25000, donorEmail: "dana@example.test", stripeAccountId: s.org.stripeAccountId });
    expect((await ledgerTotals({ tripId: s.trip.id })).raised).toBe(0);
    // Charged on the church's own Stripe account, with an idempotency key tied to the donation.
    expect(gw.createdSessions[0]).toMatchObject({ account: s.org.stripeAccountId, idempotencyKey: `checkout:${donationId}` });
  });

  it("rejects amounts outside the allowed range", async () => {
    const s = await setup();
    await expect(startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form("2") })).rejects.toThrow();
    await expect(startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form("abc") })).rejects.toThrow();
  });

  it("is unavailable until the church is approved and connected to Stripe", async () => {
    expect(givingAvailability({ status: "PENDING_REVIEW", stripeAccountId: "acct_1", stripeChargesEnabled: true }).enabled).toBe(false);
    expect(givingAvailability({ status: "ACTIVE", stripeAccountId: null, stripeChargesEnabled: false }).enabled).toBe(false);
    expect(givingAvailability({ status: "ACTIVE", stripeAccountId: "acct_1", stripeChargesEnabled: false }).enabled).toBe(false);
    expect(givingAvailability({ status: "ACTIVE", stripeAccountId: "acct_1", stripeChargesEnabled: true }).enabled).toBe(true);

    const pending = await makeOrg({ status: "PENDING_REVIEW", stripe: true });
    const { fund } = await makeTrip(pending.org.id);
    await expect(startCheckout(gw, { orgSlug: pending.org.slug, campaignSlug: fund.slug, form: form() })).rejects.toBeInstanceOf(AppError);
  });

  it("marks the donation failed if Stripe can't start checkout, and charges nothing", async () => {
    const s = await setup();
    gw.failNextCheckout = true;
    await expect(startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() })).rejects.toThrow(/No money was charged/);
    const d = await db.donation.findFirstOrThrow();
    expect(d.status).toBe("FAILED");
  });

  it("won't take gifts for closed campaigns or draft trips", async () => {
    const s = await setup();
    await db.campaign.update({ where: { id: s.fund.id }, data: { isClosed: true } });
    await expect(startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() })).rejects.toThrow(/not found/);
  });
});

describe("Stripe webhooks", () => {
  it("records a paid gift with its fee and a receipt number", async () => {
    const s = await setup();
    const { donationId, res } = await giveAndPay(s, "100.00", 320);
    expect(res.status).toBe(200);
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    expect(d).toMatchObject({ status: "SUCCEEDED", feeCents: 320, receiptNumber: 1 });
    expect(d.receivedAt).not.toBeNull();
    const totals = await ledgerTotals({ tripId: s.trip.id });
    expect(totals).toMatchObject({ donations: 10000, fees: 320, raised: 10000, netRaised: 9680 });
    // Receipt email queued for the donor
    expect(await db.emailOutbox.count({ where: { to: "dana@example.test", subject: { contains: "receipt" } } })).toBe(1);
  });

  it("rejects requests without a valid Stripe signature", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const { paymentIntentId } = gw.pay(d.stripeCheckoutSessionId!);
    const evt = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), {
      account: s.org.stripeAccountId,
      secret: "whsec_attacker",
    });
    expect((await handleStripeWebhook(gw, evt.payload, evt.signature)).status).toBe(400);
    expect((await handleStripeWebhook(gw, evt.payload, null)).status).toBe(400);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("PENDING");
  });

  it("ignores duplicate deliveries and overlapping events for the same payment", async () => {
    const s = await setup();
    const { donationId, paymentIntentId, evt } = await giveAndPay(s);
    // Same event delivered again
    expect((await handleStripeWebhook(gw, evt.payload, evt.signature)).body).toBe("duplicate");
    // A different event about the same payment
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const evt2 = signedEvent("checkout.session.async_payment_succeeded", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), {
      account: s.org.stripeAccountId,
    });
    expect((await handleStripeWebhook(gw, evt2.payload, evt2.signature)).status).toBe(200);
    expect((await ledgerTotals({ tripId: s.trip.id })).donations).toBe(10000);
    expect(await db.ledgerEntry.count({ where: { type: "DONATION" } })).toBe(1);
  });

  it("handles two deliveries of the same event processed at the same time", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const { paymentIntentId } = gw.pay(d.stripeCheckoutSessionId!);
    const evt = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), {
      account: s.org.stripeAccountId,
    });
    await Promise.all([handleStripeWebhook(gw, evt.payload, evt.signature), handleStripeWebhook(gw, evt.payload, evt.signature)]);
    expect(await db.ledgerEntry.count({ where: { type: "DONATION" } })).toBe(1);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).receiptNumber).toBe(1);
  });

  it("keeps bank-debit gifts pending until the money clears, then records failure correctly", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const completed = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, "pi_ach", "unpaid"), {
      account: s.org.stripeAccountId,
    });
    await handleStripeWebhook(gw, completed.payload, completed.signature);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("PENDING");

    const failed = signedEvent("checkout.session.async_payment_failed", sessionObject(d.stripeCheckoutSessionId!, donationId, "pi_ach", "unpaid"), {
      account: s.org.stripeAccountId,
    });
    await handleStripeWebhook(gw, failed.payload, failed.signature);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("FAILED");
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("marks abandoned checkouts as canceled", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const evt = signedEvent("checkout.session.expired", sessionObject(d.stripeCheckoutSessionId!, donationId, null, "unpaid"), { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, evt.payload, evt.signature);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("CANCELED");
  });

  it("refuses to record a payment whose amount doesn't match, and lets Stripe retry", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form("100") });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const { paymentIntentId } = gw.pay(d.stripeCheckoutSessionId!, { amount: 100 });
    const evt = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), {
      account: s.org.stripeAccountId,
    });
    const res = await handleStripeWebhook(gw, evt.payload, evt.signature);
    expect(res.status).toBe(500);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("PENDING");
    expect((await db.stripeEvent.findUniqueOrThrow({ where: { id: evt.id } })).lastError).toMatch(/mismatch/);
  });

  it("ignores an event that claims a donation from a different Stripe account", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const { paymentIntentId } = gw.pay(d.stripeCheckoutSessionId!);
    const evt = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), {
      account: "acct_someone_else",
    });
    await handleStripeWebhook(gw, evt.payload, evt.signature);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("PENDING");
  });

  it("records a fee that Stripe settles after the payment", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    const { paymentIntentId, chargeId } = gw.pay(d.stripeCheckoutSessionId!, { feeKnown: false });
    const evt = signedEvent("checkout.session.completed", sessionObject(d.stripeCheckoutSessionId!, donationId, paymentIntentId, "paid"), { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, evt.payload, evt.signature);
    expect((await ledgerTotals({ tripId: s.trip.id })).fees).toBe(0);
    const upd = signedEvent("charge.updated", chargeObject(chargeId, 10000, 0, 320), { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, upd.payload, upd.signature);
    const again = signedEvent("charge.updated", chargeObject(chargeId, 10000, 0, 320), { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, again.payload, again.signature);
    expect((await ledgerTotals({ tripId: s.trip.id })).fees).toBe(320);
  });
});

describe("refunds and disputes", () => {
  it("applies partial and full refunds correctly even when events arrive out of order or repeat", async () => {
    const s = await setup();
    const { donationId, chargeId } = await giveAndPay(s, "100.00", 320);
    const full = signedEvent("charge.refunded", chargeObject(chargeId, 10000, 10000), { account: s.org.stripeAccountId });
    const partial = signedEvent("charge.refunded", chargeObject(chargeId, 10000, 4000), { account: s.org.stripeAccountId });
    // Full-refund state arrives before the earlier partial one
    await handleStripeWebhook(gw, full.payload, full.signature);
    await handleStripeWebhook(gw, partial.payload, partial.signature);
    await handleStripeWebhook(gw, full.payload, full.signature);
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    expect(d).toMatchObject({ status: "REFUNDED", refundedCents: 10000 });
    const totals = await ledgerTotals({ tripId: s.trip.id });
    expect(totals).toMatchObject({ refunds: 10000, raised: 0 });
  });

  it("records a partial refund", async () => {
    const s = await setup();
    const { donationId, chargeId } = await giveAndPay(s, "100.00", 320);
    const partial = signedEvent("charge.refunded", chargeObject(chargeId, 10000, 2500), { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, partial.payload, partial.signature);
    expect(await db.donation.findUniqueOrThrow({ where: { id: donationId } })).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 2500 });
    expect((await ledgerTotals({ campaignId: s.fund.id })).raised).toBe(7500);
  });

  it("lets only church admins request refunds, within the remaining amount, idempotently", async () => {
    const s = await setup();
    const { donationId } = await giveAndPay(s);
    const leader = await makeUser();
    await addTripMember(s.trip, leader, "LEADER");
    const leaderCtx = await tripCtxFor(leader, s.org.slug, s.trip.id);
    await expect(requestRefund(gw, leaderCtx, donationId, { amount: "10" })).rejects.toThrow(/administrators/);

    const adminCtx = await tripContextFor(s.ctx, s.trip.id);
    await expect(requestRefund(gw, adminCtx, donationId, { amount: "150" })).rejects.toThrow(/at most/);
    const r = await requestRefund(gw, adminCtx, donationId, { amount: "25" });
    expect(r.pending).toBe(true);
    expect(gw.refunds[0]).toMatchObject({ amountCents: 2500, account: s.org.stripeAccountId, idempotencyKey: `refund:${donationId}:0:2500` });
    // Nothing is counted until Stripe confirms
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).refundedCents).toBe(0);
  });

  it("records chargebacks and reverses them when won", async () => {
    const s = await setup();
    const { donationId, chargeId } = await giveAndPay(s, "100.00", 320);
    const dispute = { id: "dp_1", object: "dispute", charge: chargeId, amount: 10000, status: "needs_response", balance_transactions: [{ fee: 1500 }] };
    const opened = signedEvent("charge.dispute.created", dispute, { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, opened.payload, opened.signature);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("DISPUTED");
    expect(await ledgerTotals({ tripId: s.trip.id })).toMatchObject({ raised: 0, fees: 1820 });

    const won = signedEvent("charge.dispute.closed", { ...dispute, status: "won" }, { account: s.org.stripeAccountId });
    await handleStripeWebhook(gw, won.payload, won.signature);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("SUCCEEDED");
    expect((await ledgerTotals({ tripId: s.trip.id })).raised).toBe(10000);
  });
});

describe("offline gifts, reconciliation, receipts", () => {
  it("lets admins record a check gift that counts immediately and gets a receipt", async () => {
    const s = await setup();
    const t = await tripContextFor(s.ctx, s.trip.id);
    const d = await recordOfflineDonation(t, { campaignId: s.fund.id, amount: "500", donorName: "Pat Giver", method: "CHECK", reference: "1042", receivedOn: "2027-01-15" });
    expect(d).toMatchObject({ status: "SUCCEEDED", method: "CHECK", receiptNumber: 1, recordedById: s.admin.id, donorEmail: null });
    expect((await ledgerTotals({ tripId: s.trip.id })).raised).toBe(50000);
    expect(await db.auditLog.count({ where: { action: "donation.offline_recorded" } })).toBe(1);
  });

  it("doesn't let participants record offline gifts", async () => {
    const s = await setup();
    const p = await makeUser();
    await addTripMember(s.trip, p);
    const t = await tripCtxFor(p, s.org.slug, s.trip.id);
    await expect(recordOfflineDonation(t, { campaignId: s.fund.id, amount: "500", donorName: "X", method: "CASH", receivedOn: "2027-01-15" })).rejects.toThrow();
  });

  it("refunds offline gifts directly in the ledger", async () => {
    const s = await setup();
    const t = await tripContextFor(s.ctx, s.trip.id);
    const d = await recordOfflineDonation(t, { campaignId: s.fund.id, amount: "500", donorName: "Pat", method: "CASH", receivedOn: "2027-01-15" });
    const r = await requestRefund(gw, t, d.id, { amount: "500" });
    expect(r.pending).toBe(false);
    expect((await db.donation.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("REFUNDED");
    expect((await ledgerTotals({ tripId: s.trip.id })).raised).toBe(0);
  });

  it("catches up on a missed webhook through reconciliation", async () => {
    const s = await setup();
    const { donationId } = await startCheckout(gw, { orgSlug: s.org.slug, campaignSlug: s.fund.slug, form: form() });
    const d = await db.donation.findUniqueOrThrow({ where: { id: donationId } });
    gw.pay(d.stripeCheckoutSessionId!);
    const result = await reconcilePendingDonations(gw, 0);
    expect(result.received).toBe(1);
    expect((await db.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe("SUCCEEDED");
    // Running again changes nothing
    await reconcilePendingDonations(gw, 0);
    expect(await db.ledgerEntry.count({ where: { type: "DONATION" } })).toBe(1);
  });

  it("only shows a receipt to its donor, the church's admins, or the emailed link", async () => {
    const s = await setup();
    const { donationId } = await giveAndPay(s);
    const stranger = await makeUser();
    expect(await loadReceipt(donationId, { userId: stranger.id, userEmail: stranger.email, userVerified: true })).toBeNull();
    expect(await loadReceipt(donationId, { token: "wrong" })).toBeNull();
    expect(await loadReceipt(donationId, { userId: s.admin.id })).not.toBeNull();
    const donor = await makeUser({ email: "dana@example.test" });
    expect(await loadReceipt(donationId, { userId: donor.id, userEmail: donor.email, userVerified: true })).not.toBeNull();
    // Unverified email ownership is not enough
    expect(await loadReceipt(donationId, { userId: donor.id, userEmail: donor.email, userVerified: false })).toBeNull();
    // Another church's admin can't see it
    const other = await makeOrg();
    expect(await loadReceipt(donationId, { userId: other.admin.id })).toBeNull();
  });

  it("numbers receipts sequentially per church", async () => {
    const s = await setup();
    await giveAndPay(s, "10");
    await giveAndPay(s, "20");
    const nums = (await db.donation.findMany({ orderBy: { receiptNumber: "asc" } })).map((d) => d.receiptNumber);
    expect(nums).toEqual([1, 2]);
  });
});

describe("ledger integrity", () => {
  it("refuses to edit or delete ledger rows", async () => {
    const s = await setup();
    await giveAndPay(s);
    const entry = await db.ledgerEntry.findFirstOrThrow();
    await expect(db.ledgerEntry.update({ where: { id: entry.id }, data: { amountCents: 1 } })).rejects.toThrow();
    await expect(db.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
  });

  it("refuses negative gifts and over-refunds at the database level", async () => {
    const s = await setup();
    await expect(
      db.donation.create({ data: { orgId: s.org.id, tripId: s.trip.id, campaignId: s.fund.id, donorName: "x", amountCents: -5 } }),
    ).rejects.toThrow();
    const { donationId } = await giveAndPay(s);
    await expect(db.donation.update({ where: { id: donationId }, data: { refundedCents: 999999 } })).rejects.toThrow();
  });
});
