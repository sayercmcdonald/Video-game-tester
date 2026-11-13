'use strict';
const { token } = require('../lib/crypto');
const { verifyWebhook, signPayload } = require('./stripe');

/**
 * Development/test stand-in for Stripe Checkout. It never touches real money and is refused
 * in production (see config). It produces Stripe-shaped, signed webhook events so the exact
 * same verification and fulfilment code runs as with the real provider.
 */
function createSimulatedProvider(config) {
  const secret = config.payments.stripeWebhookSecret;
  return {
    name: 'simulated',
    async createCheckoutSession() {
      const sessionId = `cs_sim_${token(18)}`;
      return {
        sessionId,
        url: `${config.baseUrl}/dev/checkout/${sessionId}`,
        expiresAt: new Date(Date.now() + 23 * 3600e3).toISOString(),
      };
    },
    verifyWebhook: (rawBody, header) => verifyWebhook(rawBody, header, secret),
    /** Build the signed event Stripe would send when this session is paid. */
    buildPaidEvent(session, invoice) {
      const payload = JSON.stringify({
        id: `evt_sim_${token(12)}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: session.session_id, object: 'checkout.session', payment_status: 'paid',
            amount_total: session.amount_cents, currency: invoice.currency,
            payment_intent: `pi_sim_${token(12)}`, client_reference_id: invoice.number,
            metadata: { invoice_id: String(invoice.id) },
          },
        },
      });
      return { payload, signature: signPayload(payload, secret) };
    },
  };
}

module.exports = { createSimulatedProvider };
