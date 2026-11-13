'use strict';
const { hmacSha256, safeEqual } = require('../lib/crypto');
const { HttpError } = require('../lib/util');

/**
 * Verify a Stripe webhook signature (scheme v1: HMAC-SHA256 over "<timestamp>.<raw body>").
 * Returns the parsed event, or throws a 400 when the signature is missing, wrong or stale.
 */
function verifyWebhook(rawBody, header, secret, toleranceSeconds = 300) {
  if (!secret) throw new HttpError(500, 'Webhook secret is not configured.');
  const parts = String(header || '').split(',').map((p) => p.trim().split('='));
  const timestamp = (parts.find(([k]) => k === 't') || [])[1];
  const candidates = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || !candidates.length) throw new HttpError(400, 'Missing webhook signature.');
  const expected = hmacSha256(secret, `${timestamp}.${rawBody.toString('utf8')}`);
  if (!candidates.some((sig) => safeEqual(sig, expected))) throw new HttpError(400, 'Invalid webhook signature.');
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) throw new HttpError(400, 'Webhook timestamp outside tolerance.');
  try { return JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpError(400, 'Malformed webhook payload.'); }
}

function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${payload}`)}`;
}

/** Stripe's REST API takes form-encoded bodies with bracketed nesting. */
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') formEncode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

/**
 * Stripe Checkout (hosted payment page). Card details are entered on Stripe's domain and
 * never reach this server; we only keep the session id and the outcome reported by webhook.
 */
function createStripeProvider(config) {
  const { stripeSecretKey, stripeWebhookSecret, stripeApiBase } = config.payments;

  async function api(path, params, idempotencyKey) {
    const res = await fetch(`${stripeApiBase}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: formEncode(params),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[stripe]', res.status, data.error && data.error.message);
      throw new HttpError(502, 'The payment provider could not start checkout. Please try again shortly.');
    }
    return data;
  }

  return {
    name: 'stripe',
    async createCheckoutSession({ invoice, project, client, successUrl, cancelUrl, attempt }) {
      const session = await api('/v1/checkout/sessions', {
        mode: 'payment',
        client_reference_id: invoice.number,
        customer_email: client.email,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: invoice.currency,
            unit_amount: invoice.amount_cents,
            product_data: { name: `${invoice.number} — ${invoice.description || project.name}` },
          },
        }],
        metadata: { invoice_id: invoice.id, invoice_number: invoice.number, project_code: project.code },
        payment_intent_data: { description: `Sunday Division ${invoice.number}`, metadata: { invoice_number: invoice.number } },
      }, `sd-checkout-${invoice.id}-${attempt}`);
      return {
        sessionId: session.id,
        url: session.url,
        expiresAt: new Date((session.expires_at || Math.floor(Date.now() / 1000) + 23 * 3600) * 1000).toISOString(),
      };
    },
    verifyWebhook: (rawBody, header) => verifyWebhook(rawBody, header, stripeWebhookSecret),
  };
}

module.exports = { createStripeProvider, verifyWebhook, signPayload, formEncode };
