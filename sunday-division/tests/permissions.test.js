'use strict';
/**
 * Security policy (15 Nov 2026), enforced on the server:
 *   1. Founder only: manual payments, payment overrides, final file release, role and agent-permission
 *      changes, agent spending limits.
 *   2. Anyone signed in drafts; sending to clients or contractors needs the founder or a studio manager.
 *   3. Technical files need a technical reviewer; commercial completion needs the founder or a studio manager.
 *   4. Agents hold no role: they cannot approve, override, change permissions or release anything.
 *   5. Every refusal is audited; allowed actions keep their own audit entries.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Browser, ADMIN, PNG, driveWorkflow, signInAdmin } = require('./helpers');
const { hashPassword } = require('../src/lib/crypto');
const { POLICY } = require('../src/lib/permissions');
const { TOOLS } = require('../src/agents/tools');

const PASSWORD = 'correct-horse-staple';

test('security policy: roles enforced on the server, refusals audited, agents hold no role', async (t) => {
  const { app, base, close } = await startApp();
  t.after(close);
  const { db } = app;
  const make = (email, flags = {}) => {
    db.insert('users', { email, name: email.split('@')[0], password_hash: hashPassword(PASSWORD), created_at: new Date().toISOString(), technical_reviewer: 0, studio_manager: 0, ...flags });
    return db.get('SELECT * FROM users WHERE email = ?', email);
  };
  const staff = make('staff@studio.test');
  const manager = make('manager@studio.test', { studio_manager: 1 });
  const tech = make('tech@studio.test', { technical_reviewer: 1 });
  const founder = db.get('SELECT * FROM users WHERE founder = 1');
  assert.equal(founder.email, ADMIN.email);
  const signIn = async (email) => {
    const b = new Browser(base);
    await b.get('/admin/login');
    assert.equal((await b.post('/admin/login', { email, password: PASSWORD })).status, 303);
    await b.open('/admin');
    return b;
  };
  const denials = (perm) => db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'permission.denied' AND detail = ?", perm).n;
  const asStaff = await signIn(staff.email);
  const asManager = await signIn(manager.email);
  const asFounder = await signInAdmin(base);

  // A project past its deposit, so files, invoices and completion are all in play.
  const live = await driveWorkflow(app, base, 'production');
  const pid = live.projectId;

  await t.test('2. drafting is open to staff; sending needs the founder or a studio manager', async () => {
    const inv = app.billing.createInvoice({ projectId: pid, kind: 'other', amountCents: 25000, description: 'Extra colourway', actor: `staff:${staff.email}` });
    const before = denials('client.send');
    let res = await asStaff.post(`/admin/invoices/${inv}/approve`);
    assert.equal(res.status, 403);
    assert.equal(app.billing.get(inv).status, 'draft', 'nothing was issued');
    assert.equal(denials('client.send'), before + 1, 'the refusal is in the audit log');
    res = await asManager.post(`/admin/invoices/${inv}/approve`);
    assert.equal(res.status, 303);
    assert.equal(app.billing.get(inv).status, 'open');
    assert.ok(db.get("SELECT 1 FROM audit_log WHERE action = 'invoice.approved' AND entity_id = ? AND actor = ?", inv, `staff:${manager.email}`));
    // The page shows staff who can send, instead of a button the server would refuse.
    const page = await asStaff.open(`/admin/projects/${pid}`);
    assert.match(page.text, /Founder only/);
  });

  await t.test('1. founder only: manual payments and voiding an issued invoice', async () => {
    const inv = db.get("SELECT id FROM invoices WHERE project_id = ? AND status = 'open' ORDER BY id DESC", pid).id;
    for (const b of [asStaff, asManager]) {
      assert.equal((await b.post(`/admin/invoices/${inv}/manual-payment`, { reference: 'BANK-1' })).status, 403);
      assert.equal((await b.post(`/admin/invoices/${inv}/void`)).status, 403);
    }
    assert.equal(app.billing.get(inv).status, 'open');
    assert.ok(denials('payment.record_manual') >= 2 && denials('payment.override') >= 2);
    assert.equal((await asFounder.post(`/admin/invoices/${inv}/manual-payment`, { reference: 'BANK-1' })).status, 303);
    assert.equal(app.billing.get(inv).status, 'paid');
  });

  const deliverable = (type, stage) => {
    const id = app.projects.addDeliverable(pid, { title: `${type} ${stage}`, type, stage }, { actor: `staff:${staff.email}` });
    const file = app.files.storeStaffUpload({ data: PNG, filename: `${type}.png` }, { projectId: pid, uploadedBy: `staff:${staff.email}`, kind: 'deliverable' });
    app.projects.attachDeliverableFile(id, file, `staff:${staff.email}`);
    return id;
  };

  await t.test('3. technical files need a technical reviewer; an agent can never approve its own output', async () => {
    const flats = deliverable('flats', 'final');
    assert.equal((await asStaff.post(`/admin/deliverables/${flats}/approve`)).status, 403);
    assert.equal((await asManager.post(`/admin/deliverables/${flats}/approve`)).status, 403, 'a studio manager is not a technical reviewer');
    assert.throws(() => app.projects.approveDeliverable(flats, { email: 'agent:qa' }), /technical reviewer/);
    assert.equal(app.projects.getDeliverable(flats).status, 'in_review');
    app.projects.approveDeliverable(flats, tech);
    assert.equal(app.projects.getDeliverable(flats).status, 'approved');
    // Even an ordinary file needs a real account: a pseudo-user cannot approve.
    const other = deliverable('other', 'preview');
    assert.throws(() => app.projects.approveDeliverable(other, { email: 'agent:production' }), /member of staff/);
  });

  await t.test('1. final files are released by the founder only; a payment gate is overridden by the founder only', async () => {
    const final = deliverable('other', 'final');
    app.projects.approveDeliverable(final, staff);
    assert.equal((await asManager.post(`/admin/deliverables/${final}/release`)).status, 403);
    assert.throws(() => app.projects.releaseDeliverable(final, manager, { overrideBalance: true }), /founder/i);
    assert.equal(app.projects.getDeliverable(final).status, 'approved');
    // A preview is ordinary client communication: a studio manager may release it.
    const preview = deliverable('other', 'preview');
    app.projects.approveDeliverable(preview, staff);
    assert.equal((await asStaff.post(`/admin/deliverables/${preview}/release`)).status, 403);
    assert.equal((await asManager.post(`/admin/deliverables/${preview}/release`)).status, 303);
    assert.equal(app.projects.getDeliverable(preview).status, 'released');
    // The founder can release the final file, overriding the unpaid balance knowingly.
    app.projects.releaseDeliverable(final, founder, { overrideBalance: true });
    assert.match(db.get("SELECT detail FROM audit_log WHERE action = 'deliverable.released' AND entity_id = ?", final).detail, /balance override/);
  });

  await t.test('3. commercial completion needs the founder or a studio manager', async () => {
    app.projects.setStatus(pid, 'delivered', `staff:${staff.email}`);
    assert.equal((await asStaff.post(`/admin/projects/${pid}/status`, { status: 'closed' })).status, 403);
    assert.equal(app.projects.get(pid).status, 'delivered');
    assert.equal((await asManager.post(`/admin/projects/${pid}/status`, { status: 'closed' })).status, 303);
    assert.equal(app.projects.get(pid).status, 'closed');
  });

  await t.test('1. agent spending limits and permissions are the founder’s; any staff may pause automation', async () => {
    const budget = app.settings.get('ai_monthly_budget_usd');
    assert.equal((await asManager.post('/admin/ops/settings', { section: 'budgets', ai_monthly_budget_usd: '9999' })).status, 403);
    assert.equal(app.settings.get('ai_monthly_budget_usd'), budget);
    assert.equal((await asStaff.post('/admin/ops/settings', { section: 'flags', orchestrator_paused: 'true' })).status, 303, 'pausing is a safety stop');
    assert.equal(app.settings.get('orchestrator_paused'), true);
    assert.equal((await asStaff.post('/admin/ops/settings', { section: 'flags' })).status, 403, 'resuming is not');
    assert.equal(app.settings.get('orchestrator_paused'), true);
    assert.throws(() => app.settings.set('agent_mode_sales', 'paused', manager), /founder/i);
    app.settings.set('orchestrator_paused', false, founder);
    assert.equal(app.settings.get('orchestrator_paused'), false);
  });

  await t.test('1. roles change only through the founder, and are re-read on every request', async () => {
    const { update_roles: roles } = app.command.actions.ACTIONS;
    assert.throws(() => roles.execute(app, { user_id: staff.id, studio_manager: true, technical_reviewer: false }, manager), /founder/i);
    assert.equal(db.get('SELECT studio_manager FROM users WHERE id = ?', staff.id).studio_manager, 0);
    roles.execute(app, { user_id: staff.id, studio_manager: true, technical_reviewer: false }, founder);
    assert.ok(db.get("SELECT 1 FROM audit_log WHERE action = 'user.roles_changed' AND entity_id = ?", staff.id));
    // The same signed-in session can now send: roles are not cached in the session.
    const inv = app.billing.createInvoice({ projectId: live.projectId, kind: 'other', amountCents: 1000, description: 'x', actor: 'test' });
    assert.equal((await asStaff.post(`/admin/invoices/${inv}/approve`)).status, 303);
    roles.execute(app, { user_id: staff.id, studio_manager: false, technical_reviewer: false }, founder);
    // Non-founders cannot open Command at all.
    const cmd = await asManager.get('/command');
    assert.notEqual(cmd.status, 200);
  });

  await t.test('1. payment exceptions are closed by the founder only', async () => {
    app.humanTasks.create({ kind: 'escalation', title: 'Payment amount mismatch', detail: 'Paid 90 of 100', key: 'payment_exception:test:1', projectId: pid, createdBy: 'system:webhook' });
    const id = db.get("SELECT id FROM human_tasks WHERE dedupe_key = 'payment_exception:test:1'").id;
    assert.equal((await asManager.post(`/admin/ops/tasks/${id}/done`)).status, 403);
    assert.equal(app.humanTasks.get(id).status, 'open');
  });

  await t.test('4. no agent identity passes any check, and no agent tool can do these things', () => {
    for (const perm of Object.keys(POLICY)) {
      for (const agent of [{ email: 'agent:sales' }, { id: 'agent', email: 'agent:qa' }, null]) {
        assert.throws(() => app.permissions.authorize(agent, perm), (e) => e.status === 403, `${perm} refused`);
      }
    }
    const forbidden = /approve|release|send_message|record_payment|override|set_setting|change_role|permission|budget/;
    assert.deepEqual(Object.keys(TOOLS).filter((n) => forbidden.test(n)), []);
  });
});
