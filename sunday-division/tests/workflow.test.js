'use strict';
/**
 * End-to-end: a visitor submits an inquiry and the studio takes it all the way to a
 * paid, delivered project — exercising every human-approval gate on the way.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Browser, PNG, INQUIRY, signInAdmin } = require('./helpers');
const { signPayload } = require('../src/payments/stripe');

test('inquiry → quote → deposit → delivery → final payment', async (t) => {
  const { app, base, close } = await startApp();
  t.after(close);
  const { db } = app;
  const visitor = new Browser(base);
  let admin; let client; let projectId; let ref; let portalKey;
  const projectPage = () => admin.open(`/admin/projects/${projectId}`);
  const project = () => db.get('SELECT * FROM projects WHERE id = ?', projectId);

  await t.test('public pages render', async () => {
    for (const path of ['/', '/services', '/portfolio', '/about', '/start', '/contact', '/portal', '/privacy']) {
      const res = await visitor.get(path);
      assert.equal(res.status, 200, path);
      assert.match(res.text, /Sunday Division/);
    }
    const portfolio = await visitor.get('/portfolio');
    assert.match(portfolio.text, /Concept study · not client work/);
    assert.equal((await visitor.get('/missing')).status, 404);
  });

  await t.test('intake rejects invalid submissions and stores nothing', async () => {
    const empty = await visitor.upload('/start', { brand_name: 'X' });
    assert.equal(empty.status, 422);
    const fake = await visitor.upload('/start', INQUIRY, [{ field: 'references', name: 'photo.png', data: Buffer.from('<script>alert(1)</script> not an image'), type: 'image/png' }]);
    assert.equal(fake.status, 422);
    assert.match(fake.text, /must be JPG, PNG, WebP or PDF/);
    const bot = await visitor.upload('/start', { ...INQUIRY, company_url: 'http://spam.example' });
    assert.equal(bot.status, 303);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM inquiries').n, 0);
  });

  await t.test('intake stores a valid submission with its reference image', async () => {
    const res = await visitor.upload('/start', INQUIRY, [{ field: 'references', name: 'jacket ref.png', data: PNG, type: 'image/png' }]);
    assert.equal(res.status, 303);
    ref = /ref=(SD-[A-Z0-9]{6})/.exec(res.location)[1];
    const row = db.get('SELECT * FROM inquiries WHERE ref = ?', ref);
    assert.equal(row.brand_name, INQUIRY.brand_name);
    assert.equal(row.status, 'new');
    const file = db.get('SELECT * FROM files WHERE inquiry_id = ?', row.id);
    assert.equal(file.mime, 'image/png');
    assert.notEqual(file.storage_name, file.original_name);
    assert.match((await visitor.get(res.location)).text, new RegExp(ref));
    // Uploaded files are never reachable without a session.
    assert.equal((await visitor.get(`/admin/files/${file.id}`)).status, 303);
  });

  await t.test('dashboard requires sign-in and rejects bad credentials', async () => {
    const anon = await visitor.get('/admin');
    assert.equal(anon.location, '/admin/login');
    const wrong = await new Browser(base).post('/admin/login', { email: 'studio@example.test', password: 'wrong-password' });
    assert.equal(wrong.status, 401);
    admin = await signInAdmin(base);
    assert.match((await admin.get('/admin')).text, /Overview/);
  });

  await t.test('lead is organised automatically and converts to a project', async () => {
    // Triage runs on the orchestrator (timer disabled in tests, so drive it here).
    await app.orchestrator.drain();
    const inquiry = db.get('SELECT * FROM inquiries WHERE ref = ?', ref);
    const page = await admin.get(`/admin/leads/${inquiry.id}`);
    assert.match(page.text, /Triage/);
    assert.match(page.text, /Suggested package/);
    assert.ok(JSON.parse(inquiry.triage).suggested_package);
    const res = await admin.post(`/admin/leads/${inquiry.id}/convert`);
    projectId = Number(/projects\/(\d+)/.exec(res.location)[1]);
    assert.equal(project().status, 'scoping');
    assert.equal(db.get('SELECT project_id FROM files WHERE inquiry_id = ?', inquiry.id).project_id, projectId);
    assert.match((await projectPage()).text, /Work is locked until the deposit is received/);
  });

  await t.test('automation drafts a brief and a quote, but nothing reaches the client unapproved', async () => {
    await admin.post(`/admin/projects/${projectId}/automate`, { task: 'brief' });
    assert.equal(project().brief_status, 'draft');
    await admin.post(`/admin/projects/${projectId}/automate`, { task: 'quote' });
    const draft = db.get("SELECT * FROM quotes WHERE project_id = ? AND status = 'draft'", projectId);
    assert.ok(draft.total_cents >= 200000, 'development quote respects the package floor');

    // Issue portal access and sign the client in.
    await admin.post(`/admin/projects/${projectId}/portal-key`);
    portalKey = /data-select>([^<]+)</.exec((await projectPage()).text)[1];
    assert.doesNotMatch((await projectPage()).text, new RegExp(portalKey), 'key is shown once only');
    const stored = db.get('SELECT portal_key_hash FROM clients').portal_key_hash;
    assert.notEqual(stored, portalKey);

    client = new Browser(base);
    assert.equal((await client.post('/portal/access', { key: 'not-the-key' })).status, 401);
    assert.equal((await client.post('/portal/access', { key: portalKey })).status, 303);
    const home = await client.open('/portal/home');
    assert.match(home.text, /We are scoping your project/);
    assert.doesNotMatch(home.text, /Accept quote/);
    assert.doesNotMatch(home.text, /OBJECTIVE/, 'draft brief is not visible to the client');
  });

  await t.test('staff approve the brief and send the quote; client accepts', async () => {
    await projectPage();
    await admin.post(`/admin/projects/${projectId}/brief`, { brief: project().brief, action: 'approve' });
    const draft = db.get("SELECT * FROM quotes WHERE project_id = ? AND status = 'draft'", projectId);
    const sent = await admin.post(`/admin/projects/${projectId}/quote`, {
      quote_id: draft.id, action: 'send', scope: 'Field jacket: design finalisation, technical flats, tech pack and 3D visualisation.',
      item_description: ['Design finalisation', 'Technical flats and tech pack', '3D visualisation'],
      item_quantity: ['1', '1', '1'], item_unit: ['600', '1,400.00', '400'], deposit_percent: '50', terms: '',
    });
    assert.equal(sent.status, 303);
    const quote = db.get('SELECT * FROM quotes WHERE id = ?', draft.id);
    assert.equal(quote.status, 'sent');
    assert.equal(quote.total_cents, 240000);
    assert.equal(quote.deposit_cents, 120000);
    assert.ok(quote.approved_by, 'approval is attributed to a person');

    const home = await client.open('/portal/home');
    assert.match(home.text, /Accept quote/);
    assert.match(home.text, /\$2,400\.00/);
    assert.match(home.text, /OBJECTIVE/, 'approved brief is visible');
    assert.equal((await client.post(`/portal/quotes/${quote.id}/respond`, { decision: 'accept', agree: 'yes', signed_name: '' })).status, 400);
    assert.equal((await client.post(`/portal/quotes/${quote.id}/respond`, { decision: 'accept', agree: 'yes', signed_name: 'Jordan Reyes' })).status, 303);
    assert.equal(project().status, 'awaiting_deposit');
    const invoice = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'deposit'", projectId);
    assert.equal(invoice.status, 'open');
    assert.equal(invoice.amount_cents, 120000);
  });

  await t.test('work cannot start before the deposit is received', async () => {
    await projectPage();
    await admin.post(`/admin/projects/${projectId}/tasks`, { title: 'Kickoff call' });
    const task = db.get('SELECT * FROM tasks WHERE project_id = ?', projectId);
    assert.equal((await admin.post(`/admin/tasks/${task.id}`, { status: 'doing' })).status, 409);
    assert.equal((await admin.post(`/admin/projects/${projectId}/deliverables`, { title: 'Tech pack' })).status, 409);
    assert.equal((await admin.post(`/admin/projects/${projectId}/integrations`, { product: 'index_v3', job_type: 'tech_pack' })).status, 409);
    assert.equal((await admin.post(`/admin/projects/${projectId}/status`, { status: 'active' })).status, 409, 'staff cannot bypass the deposit by editing status');
    assert.equal(project().status, 'awaiting_deposit');
  });

  await t.test('webhooks are signature-checked, replay-safe and amount-checked', async () => {
    const invoice = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'deposit'", projectId);
    await client.open('/portal/home');
    const pay = await client.post(`/portal/invoices/${invoice.id}/pay`);
    assert.match(pay.location, /\/dev\/checkout\/cs_sim_/);
    const session = db.get('SELECT * FROM checkout_sessions WHERE invoice_id = ?', invoice.id);
    const send = (payload, signature) => fetch(`${base}/webhooks/stripe`, { method: 'POST', body: payload, headers: { 'Stripe-Signature': signature, 'Content-Type': 'application/json' } });
    const event = (amount, id) => JSON.stringify({ id, type: 'checkout.session.completed', data: { object: { id: session.session_id, payment_status: 'paid', amount_total: amount, currency: 'usd', payment_intent: 'pi_test' } } });
    const secret = app.config.payments.stripeWebhookSecret;

    assert.equal((await send(event(120000, 'evt_forged'), 't=1,v1=deadbeef')).status, 400, 'forged signature');
    assert.equal((await send(event(120000, 'evt_unsigned'), '')).status, 400, 'missing signature');
    const stale = event(120000, 'evt_stale');
    assert.equal((await send(stale, signPayload(stale, secret, Math.floor(Date.now() / 1000) - 3600))).status, 400, 'stale timestamp');
    assert.equal(project().status, 'awaiting_deposit');

    const wrong = event(100, 'evt_underpaid');
    assert.equal((await (await send(wrong, signPayload(wrong, secret))).json()).outcome, 'mismatch');
    assert.equal(db.get('SELECT status FROM invoices WHERE id = ?', invoice.id).status, 'open', 'underpayment does not settle the invoice');
    assert.equal(project().status, 'awaiting_deposit');
    db.run("UPDATE checkout_sessions SET status = 'open' WHERE id = ?", session.id);
    db.run("DELETE FROM payments WHERE status = 'mismatch'");
  });

  await t.test('client pays the deposit through hosted checkout and work unlocks', async () => {
    const invoice = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'deposit'", projectId);
    const pay = await client.post(`/portal/invoices/${invoice.id}/pay`);
    const checkout = await client.get(pay.location);
    assert.match(checkout.text, /Simulated checkout/);
    const done = await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
    assert.match(done.location, /paid=SD-INV-0001/);
    assert.match((await client.open(done.location)).text, /Payment received for SD-INV-0001/);
    assert.equal(db.get('SELECT status FROM invoices WHERE id = ?', invoice.id).status, 'paid');
    assert.equal(project().status, 'active');
    assert.ok(project().started_at);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?', invoice.id).n, 1);

    // Replaying the provider's event must not double-count.
    const session = db.get('SELECT * FROM checkout_sessions WHERE invoice_id = ?', invoice.id);
    const replay = app.billing.provider.buildPaidEvent(session, invoice);
    const first = await fetch(`${base}/webhooks/stripe`, { method: 'POST', body: replay.payload, headers: { 'Stripe-Signature': replay.signature } });
    assert.equal((await first.json()).outcome, 'duplicate');
    const second = await fetch(`${base}/webhooks/stripe`, { method: 'POST', body: replay.payload, headers: { 'Stripe-Signature': replay.signature } });
    assert.equal((await second.json()).duplicate, true);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ? AND status = 'succeeded'", invoice.id).n, 1);
    assert.equal((await client.post(`/portal/invoices/${invoice.id}/pay`)).status, 409, 'a paid invoice cannot be paid again');
    db.run("DELETE FROM payments WHERE status = 'duplicate'");
  });

  await t.test('tasks, contractors and costs', async () => {
    await projectPage();
    await admin.post(`/admin/projects/${projectId}/automate`, { task: 'tasks' });
    assert.ok(db.get("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status = 'proposed'", projectId).n >= 6);
    await admin.post(`/admin/projects/${projectId}/tasks/proposed`, { decision: 'accept' });
    assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status = 'proposed'", projectId).n, 0);

    await admin.post('/admin/contractors', { name: 'Sam Okafor', discipline: 'Technical design', rate: '60' });
    const contractor = db.get('SELECT * FROM contractors');
    const task = db.get('SELECT * FROM tasks WHERE project_id = ? ORDER BY id', projectId);
    assert.equal((await admin.post(`/admin/tasks/${task.id}`, { status: 'done', contractor_id: contractor.id })).status, 303);
    assert.equal(db.get('SELECT contractor_id FROM tasks WHERE id = ?', task.id).contractor_id, contractor.id);
    await admin.post(`/admin/projects/${projectId}/costs`, { description: 'Tech pack drafting', contractor_id: contractor.id, hours: '8' });
    await admin.post(`/admin/projects/${projectId}/costs`, { description: '3D render time', amount: '120' });
    const money = app.projects.profitability(projectId);
    assert.deepEqual([money.quoted, money.collected, money.costs, money.projectedProfit], [240000, 120000, 60000, 180000]);
  });

  await t.test('deliverables need review, and final files wait for the balance', async () => {
    await projectPage();
    await admin.post(`/admin/projects/${projectId}/integrations`, { product: 'index_v3', job_type: 'tech_pack' });
    const job = db.get('SELECT * FROM integration_jobs WHERE project_id = ?', projectId);
    assert.deepEqual([job.mode, job.status], ['manual', 'needs_human'], 'INDEX V3 falls back to a human designer');

    await admin.post(`/admin/projects/${projectId}/deliverables`, { title: 'Field jacket tech pack', type: 'techpack', stage: 'final' });
    const d = db.get('SELECT * FROM deliverables WHERE project_id = ?', projectId);
    const pdf = Buffer.from('%PDF-1.7 field jacket tech pack v1 ................');
    await admin.upload(`/admin/deliverables/${d.id}/upload`, {}, [{ field: 'file', name: 'tech-pack.pdf', data: pdf, type: 'application/pdf' }]);
    const fileId = db.get('SELECT file_id FROM deliverables WHERE id = ?', d.id).file_id;
    assert.equal(db.get('SELECT status FROM deliverables WHERE id = ?', d.id).status, 'in_review');

    assert.equal((await client.get(`/portal/files/${fileId}`)).status, 404, 'unreleased file is not downloadable');
    assert.equal((await admin.post(`/admin/deliverables/${d.id}/release`)).status, 409, 'cannot release before review');
    await admin.post(`/admin/deliverables/${d.id}/approve`);
    assert.equal((await admin.post(`/admin/deliverables/${d.id}/release`)).status, 409, 'final file held while balance is unpaid');

    // Final invoice: drafted, invisible until approved, then paid by the client.
    await admin.post(`/admin/projects/${projectId}/invoices`, { kind: 'final', amount: '1200.00', description: 'Final balance' });
    const invoice = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'final'", projectId);
    assert.equal(invoice.status, 'draft');
    assert.doesNotMatch((await client.open('/portal/home')).text, /SD-INV-0002/);
    assert.equal((await client.post(`/portal/invoices/${invoice.id}/pay`)).status, 409, 'draft invoice is not payable');
    await admin.post(`/admin/invoices/${invoice.id}/approve`);
    assert.match((await client.open('/portal/home')).text, /SD-INV-0002/);
    const pay = await client.post(`/portal/invoices/${invoice.id}/pay`);
    await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
    assert.equal(app.billing.balanceDue(projectId), 0);

    assert.equal((await admin.post(`/admin/deliverables/${d.id}/release`)).status, 303);
    const home = await client.open('/portal/home');
    assert.match(home.text, /Field jacket tech pack/);
    const download = await client.get(`/portal/files/${fileId}`);
    assert.equal(download.status, 200);
    assert.ok(download.bytes.equals(pdf));
    assert.match(download.headers.get('content-disposition'), /^attachment/);

    await client.open('/portal/home');
    await client.post(`/portal/deliverables/${d.id}/revision`, { notes: 'Please add the hood attachment detail to page 3.' });
    const revision = db.get('SELECT * FROM revisions WHERE deliverable_id = ?', d.id);
    assert.equal(revision.status, 'open');
    // A new version withdraws the earlier approval and release.
    await projectPage();
    await admin.upload(`/admin/deliverables/${d.id}/upload`, {}, [{ field: 'file', name: 'tech-pack-v2.pdf', data: Buffer.from('%PDF-1.7 v2 with hood detail ........'), type: 'application/pdf' }]);
    assert.deepEqual({ ...db.get('SELECT status, version FROM deliverables WHERE id = ?', d.id) }, { status: 'in_review', version: 2 });
    assert.doesNotMatch((await client.open('/portal/home')).text, /Field jacket tech pack/);
    await admin.post(`/admin/revisions/${revision.id}/resolve`);
  });

  await t.test('status updates are drafted by automation and published by a person', async () => {
    await projectPage();
    await admin.post(`/admin/projects/${projectId}/automate`, { task: 'status' });
    const update = db.get('SELECT * FROM status_updates WHERE project_id = ?', projectId);
    assert.equal(update.status, 'draft');
    assert.doesNotMatch((await client.open('/portal/home')).text, /Completed so far/);
    await admin.post(`/admin/updates/${update.id}`, { action: 'publish', body: update.body });
    assert.match((await client.open('/portal/home')).text, /Completed so far/);
  });

  await t.test('clients are isolated from each other; forms are CSRF-protected', async () => {
    // A second client with their own project.
    await visitor.upload('/start', { ...INQUIRY, brand_name: 'Other Label', email: 'other@label.test' });
    const second = db.get("SELECT * FROM inquiries WHERE email = 'other@label.test'");
    await projectPage();
    const converted = await admin.post(`/admin/leads/${second.id}/convert`);
    const otherProjectId = Number(/projects\/(\d+)/.exec(converted.location)[1]);
    await admin.post(`/admin/projects/${otherProjectId}/portal-key`);
    const otherKey = /data-select>([^<]+)</.exec((await admin.open(`/admin/projects/${otherProjectId}`)).text)[1];
    const other = new Browser(base);
    await other.post('/portal/access', { key: otherKey });
    const otherHome = await other.open('/portal/home');
    assert.doesNotMatch(otherHome.text, /Northfield/);

    const firstFile = db.get('SELECT id FROM files WHERE project_id = ? AND uploaded_by = ?', projectId, 'client');
    const firstQuote = db.get('SELECT id FROM quotes WHERE project_id = ?', projectId);
    const firstInvoice = db.get('SELECT id FROM invoices WHERE project_id = ?', projectId);
    assert.equal((await other.get(`/portal/files/${firstFile.id}`)).status, 404);
    assert.equal((await other.post(`/portal/quotes/${firstQuote.id}/respond`, { decision: 'decline' })).status, 404);
    assert.equal((await other.post(`/portal/invoices/${firstInvoice.id}/pay`)).status, 404);
    assert.equal((await other.upload(`/portal/projects/${projectId}/files`, {}, [{ field: 'references', name: 'x.png', data: PNG }])).status, 404);
    assert.equal((await other.get('/admin')).location, '/admin/login', 'a client session grants no dashboard access');

    assert.equal((await admin.post(`/admin/projects/${projectId}/status`, { status: 'delivered' }, { csrf: false })).status, 403, 'missing CSRF token');
    assert.equal((await admin.post(`/admin/projects/${projectId}/status`, { status: 'delivered' }, { headers: { Origin: 'https://evil.example' } })).status, 403, 'cross-site post');
    assert.equal(project().status, 'active');
  });

  await t.test('project closes out with a complete audit trail', async () => {
    await projectPage();
    assert.equal((await admin.post(`/admin/projects/${projectId}/status`, { status: 'delivered' })).status, 303);
    assert.equal((await admin.post(`/admin/projects/${projectId}/status`, { status: 'closed' })).status, 303);
    const money = app.projects.profitability(projectId);
    assert.deepEqual([money.collected, money.outstanding, money.cashPosition], [240000, 0, 180000]);
    const actions = db.all('SELECT action FROM audit_log WHERE project_id = ?', projectId).map((r) => r.action);
    for (const expected of ['quote.approved_and_sent', 'quote.accepted', 'invoice.paid', 'project.work_unlocked', 'deliverable.approved', 'deliverable.released', 'status_update.published']) {
      assert.ok(actions.includes(expected), `audit log has ${expected}`);
    }
    for (const path of ['/admin', '/admin/leads', '/admin/projects', '/admin/approvals', '/admin/invoices', '/admin/contractors', `/admin/projects/${projectId}`]) {
      assert.equal((await admin.get(path)).status, 200, path);
    }
  });
});
