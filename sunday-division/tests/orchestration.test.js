'use strict';
/**
 * Milestone 1 through the real routes: new inquiry → AI triage → draft quote → human
 * approval → client acceptance → verified deposit → automated project setup → production
 * routing — then on through QA, final invoice, final payment, release and completion.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Browser, PNG, INQUIRY, signInAdmin } = require('./helpers');

test('autonomous project lifecycle with human gates', async (t) => {
  const { app, base, close } = await startApp();
  t.after(close);
  const { db } = app;
  const visitor = new Browser(base);
  let admin; let client; let wfId; let projectId; let quoteId;
  const wf = () => db.get('SELECT * FROM workflows WHERE id = ?', wfId);
  const job = (agent, action) => db.get('SELECT * FROM jobs WHERE workflow_id = ? AND agent = ? AND action = ? ORDER BY id', wfId, agent, action);
  const openTask = (key) => db.get("SELECT * FROM human_tasks WHERE dedupe_key = ? AND status = 'open'", `wf${wfId}:${key}`);
  const counts = () => ({
    jobs: db.get('SELECT COUNT(*) AS n FROM jobs').n, transitions: db.get('SELECT COUNT(*) AS n FROM workflow_transitions').n,
    tasks: db.get('SELECT COUNT(*) AS n FROM tasks').n, integration: db.get('SELECT COUNT(*) AS n FROM integration_jobs').n,
    human: db.get('SELECT COUNT(*) AS n FROM human_tasks').n, quotes: db.get('SELECT COUNT(*) AS n FROM quotes').n,
    invoices: db.get('SELECT COUNT(*) AS n FROM invoices').n, updates: db.get('SELECT COUNT(*) AS n FROM status_updates').n,
  });

  await t.test('new inquiry is triaged, scoped and a draft quote waits for staff approval', async () => {
    const res = await visitor.upload('/start', INQUIRY, [{ field: 'references', name: 'ref.png', data: PNG, type: 'image/png' }]);
    assert.equal(res.status, 303);
    await app.orchestrator.drain();
    const w = db.get('SELECT * FROM workflows');
    wfId = w.id; projectId = w.project_id;
    assert.equal(w.state, 'awaiting_quote_approval');
    assert.deepEqual(db.all('SELECT to_state FROM workflow_transitions WHERE workflow_id = ? ORDER BY id', wfId).map((r) => r.to_state), ['triage', 'scoping', 'awaiting_quote_approval']);

    const triage = job('sales_intake', 'triage');
    assert.equal(triage.status, 'succeeded');
    const out = JSON.parse(triage.output);
    assert.equal(out.qualified, true);
    assert.deepEqual(out.services.sort(), ['3d', 'technical']);
    assert.ok(JSON.parse(db.get('SELECT triage FROM inquiries').triage).summary, 'triage notes saved on the lead');

    const quote = db.get('SELECT * FROM quotes WHERE project_id = ?', projectId);
    quoteId = quote.id;
    assert.deepEqual([quote.status, quote.source], ['draft', 'rules']);
    assert.equal(db.get('SELECT brief_status FROM projects WHERE id = ?', projectId).brief_status, 'draft');
    assert.ok(openTask('approve_quote'), 'approval task created for staff');

    const runs = db.all("SELECT * FROM agent_runs WHERE agent = 'sales_intake'");
    assert.ok(runs.length >= 3, 'triage, brief and quote drafting recorded');
    assert.ok(runs.every((r) => r.provider === 'rules' && r.model_served === 'rules@1' && r.agent_version === '1.0.0'));
  });

  await t.test('nothing moves past the quote gate without a person', async () => {
    const before = counts();
    for (let i = 0; i < 3; i++) { app.orchestrator.sweep(); await app.orchestrator.drain(); }
    assert.equal(wf().state, 'awaiting_quote_approval');
    assert.deepEqual(counts(), before, 'repeated evaluation creates no extra work');
    assert.equal(db.get('SELECT status FROM quotes WHERE id = ?', quoteId).status, 'draft');
  });

  await t.test('staff approve and send the quote; Client Success hands the notice to staff', async () => {
    admin = await signInAdmin(base);
    await admin.open(`/admin/projects/${projectId}`);
    const sent = await admin.post(`/admin/projects/${projectId}/quote`, {
      quote_id: quoteId, action: 'send', scope: 'Field jacket: design finalisation, flats, tech pack and 3D.',
      item_description: ['Design finalisation', 'Technical flats and tech pack', '3D visualisation'], item_quantity: ['1', '1', '1'],
      item_unit: ['600', '1400', '400'], deposit_percent: '50', terms: '',
    });
    assert.equal(sent.status, 303);
    await app.orchestrator.drain();
    assert.equal(wf().state, 'awaiting_client_acceptance');
    assert.equal(openTask('approve_quote'), undefined, 'approval task closed itself once the quote was sent');
    assert.equal(job('client_success', 'quote_notice').status, 'succeeded');
    const notice = openTask(`notify_quote:q${quoteId}`);
    assert.equal(notice.kind, 'communication');
    assert.match(notice.title, /Issue a portal key/);
  });

  await t.test('client accepts; Finance verifies the deposit invoice; work waits for payment', async () => {
    await admin.post(`/admin/projects/${projectId}/portal-key`);
    const key = /data-select>([^<]+)</.exec((await admin.open(`/admin/projects/${projectId}`)).text)[1];
    client = new Browser(base);
    await client.post('/portal/access', { key });
    await client.open('/portal/home');
    await client.post(`/portal/quotes/${quoteId}/respond`, { decision: 'accept', agree: 'yes', signed_name: 'Jordan Reyes' });
    await app.orchestrator.drain();
    assert.equal(wf().state, 'awaiting_deposit');
    const verify = job('finance_ops', 'verify_deposit_invoice');
    assert.equal(JSON.parse(verify.output).amount_ok, true);
    assert.equal(openTask(`notify_quote:q${quoteId}`), undefined);
    assert.equal(job('project_manager', 'plan'), undefined, 'no planning before the deposit');
  });

  await t.test('verified deposit triggers automated setup and production routing', async () => {
    const invoice = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'deposit'", projectId);
    const pay = await client.post(`/portal/invoices/${invoice.id}/pay`);
    await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
    await app.orchestrator.drain();
    assert.equal(wf().state, 'in_production');
    for (const [agent, action] of [['project_manager', 'plan'], ['index_coordinator', 'route'], ['form_coordinator', 'route'], ['client_success', 'kickoff_update']]) {
      assert.equal(job(agent, action).status, 'succeeded', `${agent}.${action}`);
    }
    const plan = JSON.parse(job('project_manager', 'plan').output);
    assert.ok(plan.tasks_created >= 6);
    assert.deepEqual(plan.production_plan.map((p) => p.job_type).sort(), ['garment_3d', 'tech_pack', 'technical_flats']);
    assert.ok(db.get("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status = 'todo'", projectId).n >= 6, 'internal plan created');

    // Autonomous production is off by default: every INDEX item goes to the human queue.
    const routed = JSON.parse(job('index_coordinator', 'route').output);
    assert.deepEqual([routed.submitted, routed.routed_to_human], [0, 3]);
    assert.ok(routed.items.every((i) => i.reason === 'autonomous production is off'));
    const ij = db.all('SELECT * FROM integration_jobs WHERE project_id = ?', projectId);
    assert.equal(ij.length, 3);
    assert.ok(ij.every((j) => j.mode === 'manual' && j.status === 'needs_human' && j.idempotency_key));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM human_tasks WHERE workflow_id = ? AND kind = 'production' AND status = 'open'", wfId).n, 3);

    // Commitments to the client stay with people.
    assert.equal(db.get('SELECT due_date FROM projects WHERE id = ?', projectId).due_date, null, 'agent did not set a delivery date');
    assert.ok(openTask('confirm_due_date'));
    const update = db.get('SELECT * FROM status_updates WHERE project_id = ?', projectId);
    assert.equal(update.status, 'draft');
    assert.ok(openTask(`publish_update:u${update.id}`));
    assert.doesNotMatch((await client.open('/portal/home')).text, /Work is under way/);
  });

  await t.test('duplicate events, webhook replays and sweeps change nothing', async () => {
    const before = counts();
    const invoice = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'deposit'", projectId);
    const session = db.get('SELECT * FROM checkout_sessions WHERE invoice_id = ?', invoice.id);
    const replay = app.billing.provider.buildPaidEvent(session, invoice);
    for (let i = 0; i < 2; i++) await fetch(`${base}/webhooks/stripe`, { method: 'POST', body: replay.payload, headers: { 'Stripe-Signature': replay.signature } });
    app.events.emit('invoice.paid', { projectId, invoiceId: invoice.id, key: `invoice.paid:${invoice.id}` }); // same key → ignored
    app.events.emit('invoice.paid', { projectId, invoiceId: invoice.id, key: 'forged-duplicate-1' });
    app.events.emit('quote.accepted', { projectId, key: 'forged-duplicate-2' });
    app.orchestrator.sweep();
    await app.orchestrator.drain();
    const after = counts();
    assert.equal(after.jobs, before.jobs);
    assert.equal(after.transitions, before.transitions);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.integration, before.integration);
    assert.equal(after.invoices, before.invoices);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM payments WHERE status = 'succeeded'").n, 1);
    db.run("DELETE FROM payments WHERE status = 'duplicate'");
    db.run("UPDATE human_tasks SET status = 'dismissed' WHERE dedupe_key LIKE 'payment_exception:%'");
  });

  await t.test('QA agents check every uploaded version but only people approve', async () => {
    await admin.open(`/admin/projects/${projectId}`);
    const files = {
      'Technical flats': ['flats', Buffer.from('%PDF-1.7\n1 0 obj <</Type /Page>> endobj flats ..........')],
      'Tech pack': ['techpack', Buffer.from('%PDF-1.7\n1 0 obj <</Type /Page>> endobj 2 0 obj <</Type /Page>> endobj pack')],
      '3D garment': ['3d', Buffer.concat([Buffer.from('glTF'), Buffer.alloc(40, 1)])],
    };
    for (const [title, [type, data]] of Object.entries(files)) {
      await admin.post(`/admin/projects/${projectId}/deliverables`, { title, type, stage: 'final' });
      const d = db.get('SELECT * FROM deliverables WHERE project_id = ? AND title = ?', projectId, title);
      await admin.upload(`/admin/deliverables/${d.id}/upload`, {}, [{ field: 'file', name: `${type}.bin`, data }]);
    }
    await app.orchestrator.drain();
    const qa = db.all('SELECT * FROM deliverable_qa');
    assert.equal(qa.length, 3);
    assert.ok(qa.every((r) => r.agent === 'technical_qa' && r.result === 'pass'), JSON.stringify(qa.map((r) => [r.result, r.checks])));
    assert.ok(db.all('SELECT status FROM deliverables WHERE project_id = ?', projectId).every((d) => d.status === 'in_review'), 'QA never approves');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM human_tasks WHERE workflow_id = ? AND kind = 'review' AND status = 'open'", wfId).n, 3);

    // A new version gets its own QA run.
    const flats = db.get("SELECT * FROM deliverables WHERE project_id = ? AND type = 'flats'", projectId);
    await admin.upload(`/admin/deliverables/${flats.id}/upload`, {}, [{ field: 'file', name: 'flats-v2.pdf', data: Buffer.from('%PDF-1.7 /Encrypt <<>> /Type /Page v2') }]);
    await app.orchestrator.drain();
    const v2 = db.get('SELECT * FROM deliverable_qa WHERE deliverable_id = ? AND version = 2', flats.id);
    assert.equal(v2.result, 'fail', 'encrypted PDF fails QA');
    assert.ok(openTask(`review:d${flats.id}:v2`));
    assert.equal(openTask(`review:d${flats.id}:v1`), undefined, 'superseded review task closed');
  });

  await t.test('production complete → Finance drafts the final invoice for staff approval', async () => {
    for (const d of db.all('SELECT * FROM deliverables WHERE project_id = ?', projectId)) await admin.post(`/admin/deliverables/${d.id}/approve`);
    await app.orchestrator.drain();
    assert.equal(wf().state, 'in_production', 'still waiting: manual production requests are open');
    for (const ij of db.all('SELECT * FROM integration_jobs WHERE project_id = ?', projectId)) await admin.post(`/admin/jobs/${ij.id}/complete`);
    await app.orchestrator.drain();
    assert.equal(wf().state, 'awaiting_final_payment');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM human_tasks WHERE workflow_id = ? AND kind = 'production' AND status = 'open'", wfId).n, 0);
    const final = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'final'", projectId);
    assert.deepEqual([final.status, final.amount_cents], ['draft', 120000], 'exact remaining balance, as a draft');
    assert.ok(openTask(`approve_invoice:i${final.id}`));
    assert.doesNotMatch((await client.open('/portal/home')).text, new RegExp(final.number), 'draft invoice invisible to client');
  });

  await t.test('final payment verified → release task; staff release → completion summary', async () => {
    const final = db.get("SELECT * FROM invoices WHERE project_id = ? AND kind = 'final'", projectId);
    await admin.open(`/admin/projects/${projectId}`);
    await admin.post(`/admin/invoices/${final.id}/approve`);
    await app.orchestrator.drain();
    assert.equal(wf().state, 'awaiting_final_payment', 'issued but unpaid');
    await client.open('/portal/home');
    const pay = await client.post(`/portal/invoices/${final.id}/pay`);
    await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
    await app.orchestrator.drain();
    assert.equal(wf().state, 'ready_for_release');
    assert.ok(openTask('release'));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM deliverables WHERE project_id = ? AND status = 'released'", projectId).n, 0, 'nothing released automatically');

    await admin.open(`/admin/projects/${projectId}`);
    for (const d of db.all('SELECT * FROM deliverables WHERE project_id = ?', projectId)) await admin.post(`/admin/deliverables/${d.id}/release`);
    await app.orchestrator.drain();
    assert.equal(wf().state, 'completed');
    assert.equal(db.get('SELECT status FROM projects WHERE id = ?', projectId).status, 'delivered');
    const summary = JSON.parse(wf().summary);
    assert.match(summary.summary, /Delivered 3 file\(s\)/);
    assert.equal(summary.performance.collected_cents, 240000);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM human_tasks WHERE workflow_id = ? AND status = 'open'", wfId).n, 0, 'queue is clear');

    // Every gate was passed by a person, never by an agent.
    const gates = db.all("SELECT actor, action FROM audit_log WHERE action IN ('quote.approved_and_sent','invoice.approved','deliverable.approved','deliverable.released','status_update.published')");
    assert.ok(gates.length >= 8);
    assert.ok(gates.every((g) => g.actor.startsWith('staff:')), JSON.stringify(gates));
  });

  await t.test('operations pages render for staff only', async () => {
    for (const path of ['/admin/ops', `/admin/ops/workflows/${wfId}`, '/admin/ops/agents', '/admin/ops/settings', `/admin/projects/${projectId}`]) {
      const res = await admin.get(path);
      assert.equal(res.status, 200, path);
    }
    const ops = await admin.get('/admin/ops');
    assert.match(ops.text, /Automation rate/);
    assert.match((await admin.get('/admin/ops/agents')).text, /Finance Operations Agent/);
    assert.equal((await client.get('/admin/ops')).location, '/admin/login');
    assert.equal((await visitor.get(`/admin/ops/workflows/${wfId}`)).location, '/admin/login');
    assert.equal((await admin.post(`/admin/ops/workflows/${wfId}/pause`, {}, { csrf: false })).status, 403);
    await admin.get('/admin/ops');
    assert.equal((await admin.post('/admin/ops/run')).status, 303, 'manual run returns immediately');
    await app.orchestrator.drain();
  });
});

test('agents never overwrite a quote a person already drafted, but still route it for approval', async (t) => {
  const { app, base, close } = await startApp();
  t.after(close);
  const { db } = app;
  await new Browser(base).upload('/start', INQUIRY);
  app.orchestrator.processEvents(); // workflow created, triage queued
  const inquiry = db.get('SELECT * FROM inquiries');
  const project = app.projects.createFromInquiry(app.intake.get(inquiry.id), 'staff:studio@example.test');
  const quoteId = app.quotes.saveDraft(project.id, { scope: 'Hand-written scope.', line_items: [{ description: 'Bespoke', quantity: 1, unit_cents: 310000 }], deposit_percent: 40 }, { actor: 'staff:studio@example.test' });
  await app.orchestrator.drain();
  const quotes = app.quotes.forProject(project.id);
  assert.equal(quotes.length, 1);
  assert.deepEqual([quotes[0].id, quotes[0].source, quotes[0].total_cents, quotes[0].scope], [quoteId, 'manual', 310000, 'Hand-written scope.']);
  const wf = db.get('SELECT * FROM workflows');
  assert.equal(wf.state, 'awaiting_quote_approval');
  assert.ok(db.get("SELECT 1 FROM human_tasks WHERE dedupe_key = ? AND status = 'open'", `wf${wf.id}:approve_quote`));
});
