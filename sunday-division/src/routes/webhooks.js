'use strict';

function register(router, app) {
  // Stripe posts here. The body is kept raw because the signature covers the exact bytes.
  router.post('/webhooks/stripe', { raw: true, maxBody: 1024 * 1024 }, (ctx) => {
    const result = app.billing.handleWebhook(ctx.rawBody, ctx.req.headers['stripe-signature']);
    ctx.json(result);
  });
}

module.exports = { register };
