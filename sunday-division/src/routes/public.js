'use strict';
const views = require('../views/public');
const { HttpError, str } = require('../lib/util');

function register(router, app) {
  router.get('/', (ctx) => ctx.html(views.home(ctx)));
  router.get('/services', (ctx) => ctx.html(views.services(ctx)));
  router.get('/portfolio', (ctx) => ctx.html(views.portfolio(ctx)));
  router.get('/about', (ctx) => ctx.html(views.about(ctx)));
  router.get('/privacy', (ctx) => ctx.html(views.privacy(ctx)));
  router.get('/healthz', (ctx) => {
    app.db.get('SELECT 1');
    ctx.json({ ok: true });
  });
  router.get('/robots.txt', (ctx) => ctx.send(200, 'User-agent: *\nDisallow: /admin\nDisallow: /portal\nDisallow: /dev\n', { 'Content-Type': 'text/plain' }));

  // ── Intake ────────────────────────────────────────────────────────────
  router.get('/start', (ctx) => ctx.html(views.start(ctx, { values: { package_interest: str(ctx.query.get('package'), 30) } })));
  router.get('/start/received', (ctx) => {
    const ref = str(ctx.query.get('ref'), 12);
    ctx.html(views.received(ctx, /^SD-[A-Z0-9]{6}$/.test(ref) ? ref : ''));
  });
  router.post('/start', { maxBody: 52 * 1024 * 1024 }, (ctx) => {
    // Honeypot: bots fill every field. Pretend success and store nothing.
    if (ctx.body.company_url) return ctx.redirect('/start/received');
    const uploads = ctx.files.filter((f) => f.field === 'references');
    const { values, errors } = app.intake.validateProject(ctx.body, uploads);
    if (!Object.keys(errors).length && !app.rateLimit.take(`intake:${ctx.ip}`, 6, 3600e3)) {
      errors._form = 'Too many submissions from this connection. Please try again in an hour.';
    }
    if (Object.keys(errors).length) return ctx.html(views.start(ctx, { values, errors }), 422);
    const inquiry = app.intake.createProjectInquiry(values, uploads);
    ctx.redirect(`/start/received?ref=${inquiry.ref}`);
  });

  // ── Contact ───────────────────────────────────────────────────────────
  router.get('/contact', (ctx) => ctx.html(views.contact(ctx, { sent: ctx.query.get('sent') === '1' })));
  router.post('/contact', (ctx) => {
    if (ctx.body.company_url) return ctx.redirect('/contact?sent=1');
    if (!app.rateLimit.take(`contact:${ctx.ip}`, 6, 3600e3)) {
      return ctx.html(views.contact(ctx, { values: ctx.body, errors: { _form: 'Too many messages from this connection. Please try again later.' } }), 429);
    }
    const result = app.intake.createContactMessage(ctx.body);
    if (result.errors) {
      const values = { name: result.values.contact_name, email: result.values.email, message: result.values.description };
      return ctx.html(views.contact(ctx, { values, errors: result.errors }), 422);
    }
    ctx.redirect('/contact?sent=1');
  });

  // ── Simulated checkout (development and tests only) ───────────────────
  if (app.billing.providerName === 'simulated') {
    const dev = require('../views/dev');
    const load = (ctx) => {
      const session = app.billing.checkoutSession(ctx.params.id);
      if (!session) throw new HttpError(404, 'Checkout session not found.');
      return { session, invoice: app.billing.mustGet(session.invoice_id) };
    };
    router.get('/dev/checkout/:id', (ctx) => ctx.html(dev.checkout(ctx, load(ctx))));
    router.post('/dev/checkout/:id', (ctx) => {
      const { session, invoice } = load(ctx);
      if (ctx.body.outcome !== 'pay') return ctx.redirect(`/portal/home?cancelled=${invoice.number}`);
      const event = app.billing.provider.buildPaidEvent(session, invoice);
      app.billing.handleWebhook(Buffer.from(event.payload), event.signature);
      ctx.redirect(`/portal/home?paid=${invoice.number}`);
    });
  }
}

module.exports = { register };
