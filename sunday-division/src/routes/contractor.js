'use strict';
const views = require('../views/contractor');
const { HttpError, int, str } = require('../lib/util');

/**
 * Contractor portal. A signed-in contractor sees only assignments offered to them, the brief
 * for each, and the reference files of those projects — never client details, prices charged
 * to the client, other contractors or other projects.
 */
function register(router, app) {
  const { db } = app;
  const C = { auth: 'contractor' };
  const own = (ctx, id) => {
    const a = app.assignments.get(int(id));
    if (!a || a.contractor_id !== ctx.contractor.id || !['offered', 'accepted', 'submitted', 'changes_requested', 'signed_off'].includes(a.status)) throw new HttpError(404, 'Not found.');
    return a;
  };

  router.get('/contractor', (ctx) => (ctx.contractor ? ctx.redirect('/contractor/home') : ctx.html(views.access(ctx))));
  router.post('/contractor/access', (ctx) => {
    if (!app.rateLimit.take(`contractor:${ctx.ip}`, 10, 15 * 60e3)) return ctx.html(views.access(ctx, { error: 'Too many attempts. Please wait fifteen minutes and try again.' }), 429);
    const c = app.contractors.byPortalKey(str(ctx.body.key, 200));
    if (!c) return ctx.html(views.access(ctx, { error: 'That access key was not recognised.' }), 401);
    ctx.setCookies.push(app.sessions.start('contractor', c.id));
    app.audit.log(`contractor:${c.id}`, 'contractor.signed_in', { entity: 'contractor', entityId: c.id });
    ctx.redirect('/contractor/home');
  });
  router.post('/contractor/logout', C, (ctx) => { ctx.setCookies.push(app.sessions.end('contractor', ctx.cookies)); ctx.redirect('/contractor'); });

  router.get('/contractor/home', C, (ctx) => {
    const assignments = app.assignments.forContractor(ctx.contractor.id);
    const filesFor = (a) => (['offered', 'accepted', 'submitted', 'changes_requested'].includes(a.status) ? app.files.forProject(a.project_id).filter((f) => f.kind === 'reference') : []);
    const historyFor = (a) => db.all("SELECT body FROM messages WHERE assignment_id = ? AND purpose = 'changes_requested' AND status = 'sent' ORDER BY id", a.id);
    ctx.html(views.home(ctx, { assignments, filesFor, historyFor }));
  });

  router.post('/contractor/assignments/:id/respond', C, (ctx) => {
    const a = own(ctx, ctx.params.id);
    const accept = ctx.body.decision === 'accept';
    if (accept && ctx.body.agree !== 'yes') throw new HttpError(400, 'Tick the box to confirm the fee and due date.');
    app.assignments.respond(a.id, ctx.contractor.id, { accept, note: ctx.body.note });
    ctx.redirect('/contractor/home', accept ? 'Assignment accepted. Thank you.' : 'Offer declined. Thank you for letting us know.');
  });

  router.post('/contractor/assignments/:id/submit', { auth: 'contractor', maxBody: app.config.limits.adminFileBytes + 1024 * 1024 }, (ctx) => {
    const a = own(ctx, ctx.params.id);
    const file = ctx.files.find((f) => f.field === 'file');
    app.assignments.submit(a.id, ctx.contractor.id, file, ctx.body.note);
    ctx.redirect('/contractor/home', 'Submitted. The studio will review it and let you know.');
  });

  router.get('/contractor/files/:id', C, (ctx) => {
    const a = own(ctx, ctx.query.get('a'));
    const file = app.files.get(int(ctx.params.id));
    if (!file || file.project_id !== a.project_id || file.kind !== 'reference' || !['offered', 'accepted', 'submitted', 'changes_requested'].includes(a.status)) throw new HttpError(404, 'Not found.');
    app.files.send(ctx, file);
  });
}

module.exports = { register };
