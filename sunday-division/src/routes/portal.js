'use strict';
const views = require('../views/portal');
const publicViews = require('../views/public');
const { HttpError, int, str } = require('../lib/util');

function register(router, app) {
  const { db } = app;

  /** A project the signed-in client owns, or 404 — never reveal other clients' records. */
  function ownProject(ctx, projectId) {
    const project = app.projects.get(projectId);
    if (!project || project.client_id !== ctx.client.id || project.status === 'cancelled') throw new HttpError(404, 'Not found.');
    return project;
  }

  router.get('/portal', (ctx) => (ctx.client ? ctx.redirect('/portal/home') : ctx.html(publicViews.portalAccess(ctx))));

  router.post('/portal/access', (ctx) => {
    if (!app.rateLimit.take(`portal:${ctx.ip}`, 10, 15 * 60e3)) {
      return ctx.html(publicViews.portalAccess(ctx, { error: 'Too many attempts. Please wait fifteen minutes and try again.' }), 429);
    }
    const client = app.projects.clientByPortalKey(str(ctx.body.key, 200));
    if (!client) return ctx.html(publicViews.portalAccess(ctx, { error: 'That access key was not recognised. Check the key or contact the studio.' }), 401);
    ctx.setCookies.push(app.sessions.start('portal', client.id));
    app.audit.log(`client:${client.id}`, 'portal.signed_in', { entity: 'client', entityId: client.id });
    ctx.redirect('/portal/home');
  });

  router.post('/portal/logout', { auth: 'portal' }, (ctx) => {
    ctx.setCookies.push(app.sessions.end('portal', ctx.cookies));
    ctx.redirect('/portal');
  });

  router.get('/portal/home', { auth: 'portal' }, (ctx) => {
    const projects = app.projects.forClient(ctx.client.id).map((p) => ({
      ...p,
      brief: p.brief_status === 'approved' ? p.brief : '',
      quote: app.quotes.clientVisible(p.id),
      invoices: app.billing.clientVisible(p.id),
      updates: app.projects.statusUpdates(p.id, true),
      deliverables: app.projects.deliverables(p.id).filter((d) => d.status === 'released'),
      files: app.files.forProject(p.id).filter((f) => f.uploaded_by === 'client'),
    }));
    let notice = '';
    const paidRef = str(ctx.query.get('paid'), 20);
    if (paidRef) {
      const invoice = projects.flatMap((p) => p.invoices).find((i) => i.number === paidRef);
      if (invoice) {
        notice = invoice.status === 'paid'
          ? `Payment received for ${invoice.number}. Thank you.`
          : `Thank you. Your payment for ${invoice.number} is being confirmed — refresh this page in a moment.`;
      }
    } else if (ctx.query.get('cancelled')) {
      notice = 'Checkout was cancelled. No payment was taken.';
    }
    ctx.html(views.home(ctx, { projects, paymentsEnabled: app.billing.providerName !== 'none', notice }));
  });

  router.post('/portal/quotes/:id/respond', { auth: 'portal' }, (ctx) => {
    const accept = ctx.body.decision === 'accept';
    if (accept && ctx.body.agree !== 'yes') throw new HttpError(400, 'Tick the box to confirm you accept the quote and its terms.');
    const result = app.quotes.respond(int(ctx.params.id), ctx.client.id, { accept, signedName: ctx.body.signed_name });
    ctx.redirect('/portal/home', result.accepted ? 'Quote accepted. Your deposit invoice is ready below.' : 'Quote declined. The studio has been notified.');
  });

  router.post('/portal/invoices/:id/pay', { auth: 'portal' }, async (ctx) => {
    const url = await app.billing.startCheckout(int(ctx.params.id), ctx.client);
    ctx.redirect(url);
  });

  router.post('/portal/deliverables/:id/revision', { auth: 'portal' }, (ctx) => {
    const d = app.projects.getDeliverable(int(ctx.params.id));
    if (!d || d.status !== 'released') throw new HttpError(404, 'Not found.');
    ownProject(ctx, d.project_id);
    app.projects.requestRevision(d.id, ctx.body.notes, `client:${ctx.client.id}`);
    ctx.redirect('/portal/home', 'Revision request sent to the studio.');
  });

  router.post('/portal/projects/:id/files', { auth: 'portal', maxBody: 52 * 1024 * 1024 }, (ctx) => {
    const project = ownProject(ctx, int(ctx.params.id));
    const uploads = ctx.files.filter((f) => f.field === 'references');
    if (!uploads.length) throw new HttpError(400, 'Choose at least one file.');
    if (uploads.length > app.config.limits.intakeFiles) throw new HttpError(400, `Upload up to ${app.config.limits.intakeFiles} files at a time.`);
    db.tx(() => uploads.forEach((u) => app.files.storeClientUpload(u, { projectId: project.id, inquiryId: project.inquiry_id, uploadedBy: 'client' })));
    app.files.organize(project);
    app.audit.log(`client:${ctx.client.id}`, 'files.uploaded', { entity: 'project', entityId: project.id, projectId: project.id, detail: `${uploads.length} file(s)` });
    ctx.redirect('/portal/home', 'Files uploaded.');
  });

  router.get('/portal/files/:id', { auth: 'portal' }, (ctx) => {
    const file = app.files.get(int(ctx.params.id));
    if (!file || !file.project_id) throw new HttpError(404, 'Not found.');
    ownProject(ctx, file.project_id);
    // Clients may fetch what they uploaded, and studio files only once released.
    const released = db.get("SELECT 1 FROM deliverables WHERE file_id = ? AND status = 'released'", file.id);
    if (file.uploaded_by !== 'client' && !released) throw new HttpError(404, 'Not found.');
    app.files.send(ctx, file);
  });
}

module.exports = { register };
