'use strict';
/**
 * The first agent workflow, end to end through the real routes, with a SIMULATED model in
 * place of Claude and simulated message delivery:
 *
 * new inquiry → Sales Agent qualifies and drafts brief + quote → staff approve the quote →
 * Client Success prepares the notice → staff approve the message → client accepts → verified
 * deposit → Project Manager creates production tasks → Production writes briefs and routes →
 * Talent recommends an approved contractor → staff approve the assignment (offer sent) →
 * contractor accepts and submits in the portal → QA Agent inspects the file → technical
 * reviewer signs off → … → final payment → release → completion.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Browser, PNG, INQUIRY, signInAdmin } = require('./helpers');
const { simulatedModel } = require('./support/simulated-model');
const { REGISTRY } = require('../src/agents/definitions');

test('agent workflow: inquiry to technical sign-off and completion', async (t) => {
  const { app, base, close } = await startApp();
  t.after(close);
  const { db } = app;
  const model = simulatedModel();
  app.agentModel.use(model, { simulated: true });
  const visitor = new Browser(base);
  let admin; let client; let contractor; let wfId; let projectId; let quoteId; let samId;
  const wf = () => db.get('SELECT * FROM workflows WHERE id = ?', wfId);
  const job = (agent, action) => db.get('SELECT * FROM jobs WHERE workflow_id = ? AND agent = ? AND action = ? ORDER BY id', wfId, agent, action);
  const open = (pattern) => db.all("SELECT * FROM human_tasks WHERE status = 'open' AND dedupe_key LIKE ?", `%${pattern}%`);
  const assignments = () => db.all('SELECT * FROM assignments ORDER BY id');
  const drain = () => app.orchestrator.drain();

  await t.test('staff set up an approved contractor and an unapproved candidate', async () => {
    admin = await signInAdmin(base);
    await admin.open('/admin/contractors');
    const skills = ['technical_flats', 'tech_pack', 'garment_3d'];
    await admin.post('/admin/contractors', { name: 'Sam Okafor', email: 'sam@contractor.test', discipline: 'Technical design', rate: '60', capacity: '3', skills, categories: ['Outerwear'], status: 'approved' });
    await admin.post('/admin/contractors', { name: 'Robin Vale', email: 'robin@contractor.test', discipline: 'Technical design', rate: '40', capacity: '3', skills });
    const rows = db.all('SELECT * FROM contractors ORDER BY id');
    samId = rows[0].id;
    assert.deepEqual(rows.map((c) => c.status), ['approved', 'candidate']);
  });

  await t.test('Sales Agent qualifies the inquiry and drafts brief and quote through tools', async () => {
    await visitor.upload('/start', INQUIRY, [{ field: 'references', name: 'ref.png', data: PNG, type: 'image/png' }]);
    await drain();
    const w = db.get('SELECT * FROM workflows');
    wfId = w.id; projectId = w.project_id;
    assert.equal(w.state, 'awaiting_quote_approval');
    for (const [agent, action] of [['sales', 'qualify'], ['sales', 'draft_proposal']]) {
      const j = job(agent, action);
      assert.equal(j.status, 'succeeded', `${agent}.${action}: ${j.error}`);
      const s = app.agentRuntime.session(j.id);
      assert.deepEqual([s.brain, s.status], ['model', 'done']);
      assert.ok(s.turns >= 3);
    }
    // What the model was given: its system prompt and exactly its allowed tools, in strict mode.
    const req = model.calls.find((c) => c.key === 'sales.draft_proposal').req;
    assert.equal(req.system, REGISTRY.sales.systemPrompt);
    assert.deepEqual(req.tools.map((x) => x.name).sort(), [...REGISTRY.sales.actions.draft_proposal.tools].sort());
    assert.ok(req.tools.every((x) => x.strict === true && !JSON.stringify(x.input_schema).includes('maxLength')));
    // What it did: real records, labelled as simulated model output.
    const quote = db.get('SELECT * FROM quotes WHERE project_id = ?', projectId);
    quoteId = quote.id;
    assert.deepEqual([quote.status, quote.source, quote.total_cents], ['draft', 'simulated', 240000]);
    assert.equal(db.get('SELECT triage_source FROM inquiries').triage_source, 'simulated');
    const runs = db.all("SELECT * FROM agent_runs WHERE agent = 'sales'");
    assert.ok(runs.length >= 6 && runs.every((r) => r.provider === 'simulated' && r.model_served === 'simulated-model' && r.cost_micros > 0));
    // The approval request is created by the orchestrator, with the agent's flag on it.
    const approval = open('approve_quote')[0];
    assert.match(approval.detail, /Confirm the base size/);
  });

  await t.test('staff approve the quote; Client Success prepares the notice; staff approve the message', async () => {
    await admin.open(`/admin/projects/${projectId}`);
    await admin.post(`/admin/projects/${projectId}/quote`, { quote_id: quoteId, action: 'send', scope: 'Field jacket development.', item_description: ['Design finalisation', 'Technical flats and tech pack', '3D visualisation'], item_quantity: ['1', '1', '1'], item_unit: ['600', '1400', '400'], deposit_percent: '50', terms: '' });
    await drain();
    assert.equal(wf().state, 'awaiting_client_acceptance');
    const msg = db.get("SELECT * FROM messages WHERE purpose = 'quote_ready'");
    assert.deepEqual([msg.status, msg.recipient_type, msg.to_address, msg.prepared_by], ['draft', 'client', INQUIRY.email, 'agent:client_success']);
    assert.ok(open(`approve_message:m${msg.id}`).length);
    assert.ok(open('portal_key:c').length, 'staff asked to issue portal access');
    await admin.open('/admin/messages');
    assert.equal((await admin.post(`/admin/messages/${msg.id}/approve`, { body: msg.body })).status, 303);
    const sent = db.get('SELECT * FROM messages WHERE id = ?', msg.id);
    assert.deepEqual([sent.status, sent.channel, sent.provider_ref], ['sent', 'simulated', `SIMULATED-${msg.id}`]);
    assert.ok(db.get("SELECT 1 FROM audit_log WHERE action = 'message.sent_simulated'"));
  });

  await t.test('client accepts and pays the deposit; agents plan, brief, route and recommend', async () => {
    await admin.post(`/admin/projects/${projectId}/portal-key`);
    const key = /data-select>([^<]+)</.exec((await admin.open(`/admin/projects/${projectId}`)).text)[1];
    client = new Browser(base);
    await client.post('/portal/access', { key });
    await client.open('/portal/home');
    await client.post(`/portal/quotes/${quoteId}/respond`, { decision: 'accept', agree: 'yes', signed_name: 'Jordan Reyes' });
    await drain();
    assert.equal(wf().state, 'awaiting_deposit');
    const inv = db.get("SELECT * FROM invoices WHERE kind = 'deposit'");
    const pay = await client.post(`/portal/invoices/${inv.id}/pay`);
    await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
    await drain();
    assert.equal(wf().state, 'in_production');
    const prod = app.projects.productionTasks(projectId);
    assert.deepEqual(prod.map((x) => x.job_type).sort(), ['garment_3d', 'tech_pack', 'technical_flats']);
    assert.ok(prod.every((x) => x.route === 'contractor' && x.brief.includes('TASK') && x.checklist.includes('Files named with the project code')));
    const recs = assignments();
    assert.equal(recs.length, 3);
    assert.ok(recs.every((a) => a.status === 'recommended' && a.contractor_id === samId && a.fee_cents === 45000), JSON.stringify(recs));
    assert.equal(open('approve_assignment:a').length, 3);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE recipient_type = 'contractor'").n, 0, 'nobody contacted before approval');
    assert.ok(open('confirm_due_date').length, 'delivery date proposed, not set');
    assert.equal(db.get('SELECT due_date FROM projects WHERE id = ?', projectId).due_date, null);
  });

  await t.test('no contractor response is invented while waiting', async () => {
    for (let i = 0; i < 3; i++) { app.orchestrator.sweep(); await drain(); }
    assert.ok(assignments().every((a) => a.status === 'recommended'));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'assignment.accepted%' OR action LIKE 'assignment.declined%'").n, 0);
  });

  await t.test('staff approve one assignment and reject another; Talent escalates when nobody else fits', async () => {
    const [a1, a2] = assignments();
    await admin.open(`/admin/projects/${projectId}`);
    assert.equal((await admin.post(`/admin/assignments/${a1.id}/approve`, { fee: '450.00', due_date: '2026-12-01' })).status, 303);
    assert.equal(db.get('SELECT status FROM assignments WHERE id = ?', a1.id).status, 'offered');
    const offer = db.get("SELECT * FROM messages WHERE purpose = 'assignment_offer'");
    assert.deepEqual([offer.status, offer.channel, offer.to_address], ['sent', 'simulated', 'sam@contractor.test']);
    await admin.post(`/admin/assignments/${a2.id}/reject`, { note: 'Want a specialist for this one.' });
    await drain();
    const retry = db.all("SELECT * FROM jobs WHERE agent = 'talent' AND input LIKE ? ORDER BY id", `%"task_id":${a2.task_id}}%`);
    assert.equal(retry.length, 2, 'a second recommendation was attempted');
    assert.equal(JSON.parse(retry[1].output).escalated, true, 'the unapproved candidate is never recommended');
    assert.ok(db.get("SELECT 1 FROM human_tasks WHERE status = 'open' AND kind = 'escalation' AND title LIKE 'Find a contractor%'"));
  });

  await t.test('the contractor sees only their own offer, accepts and submits', async () => {
    await admin.open('/admin/contractors');
    await admin.post(`/admin/contractors/${samId}/portal-key`);
    const key = /data-select>([^<]+)</.exec((await admin.open('/admin/contractors')).text)[1];
    contractor = new Browser(base);
    assert.equal((await contractor.post('/contractor/access', { key: 'wrong' })).status, 401);
    await contractor.post('/contractor/access', { key });
    const home = await contractor.open('/contractor/home');
    const [a1, , a3] = assignments();
    assert.match(home.text, /Technical brief/);
    assert.match(home.text, new RegExp(`id="a${a1.id}"`));
    assert.doesNotMatch(home.text, new RegExp(`id="a${a3.id}"`), 'unapproved recommendation is not visible');
    for (const secret of [INQUIRY.email, INQUIRY.contact_name, INQUIRY.brand_name, '$2,400', '$1,200']) assert.ok(!home.text.includes(secret), `contractor sees ${secret}`);
    const ref = db.get("SELECT id FROM files WHERE kind = 'reference'");
    assert.equal((await contractor.get(`/contractor/files/${ref.id}?a=${a1.id}`)).status, 200);
    assert.equal((await contractor.get('/admin')).location, '/admin/login');
    assert.equal((await contractor.get('/portal/home')).location, '/portal');
    assert.equal((await contractor.post(`/contractor/assignments/${a1.id}/respond`, { decision: 'accept' })).status, 400, 'must confirm fee and date');
    await contractor.post(`/contractor/assignments/${a1.id}/respond`, { decision: 'accept', agree: 'yes', note: 'Happy to.' });
    assert.equal(db.get('SELECT status FROM assignments WHERE id = ?', a1.id).status, 'accepted');
    await contractor.open('/contractor/home');
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type /Page>> endobj technical flats front back details');
    assert.equal((await contractor.upload(`/contractor/assignments/${a1.id}/submit`, { note: 'Flats attached.' }, [{ field: 'file', name: 'flats.pdf', data: pdf, type: 'application/pdf' }])).status, 303);
    const d = db.get('SELECT * FROM deliverables WHERE assignment_id = ?', a1.id);
    assert.deepEqual([d.status, d.version, d.task_id], ['in_review', 1, a1.task_id]);
    assert.equal(db.get('SELECT status FROM assignments WHERE id = ?', a1.id).status, 'submitted');
  });

  await t.test('QA Agent reads the file and prepares the technical sign-off; only a reviewer can sign off', async () => {
    await drain();
    const a1 = assignments()[0];
    const d = db.get('SELECT * FROM deliverables WHERE assignment_id = ?', a1.id);
    const qaJob = db.get("SELECT * FROM jobs WHERE agent = 'qa' AND action = 'check'");
    assert.equal(qaJob.status, 'succeeded', qaJob.error);
    const qaReq = model.calls.filter((c) => c.key === 'qa.check').pop().req;
    assert.ok(JSON.stringify(qaReq.messages).includes('"type":"document"'), 'the PDF was attached for the model to read');
    const report = db.get('SELECT * FROM deliverable_qa WHERE deliverable_id = ?', d.id);
    assert.equal(report.result, 'pass');
    assert.ok(JSON.parse(report.checks).checks.some((c) => c.name === 'Files named with the project code'));
    const signOff = open(`review:d${d.id}:v1`)[0];
    assert.match(signOff.title, /^Technical sign-off/);
    assert.match(signOff.detail, /Qualified reviewers: Studio Admin/);
    assert.equal(db.get('SELECT status FROM deliverables WHERE id = ?', d.id).status, 'in_review', 'QA never approves');

    // A staff member who is not a technical reviewer cannot sign off.
    const { hashPassword } = require('../src/lib/crypto');
    db.insert('users', { email: 'ops@example.test', name: 'Ops', password_hash: hashPassword('another-long-password'), technical_reviewer: 0, created_at: new Date().toISOString() });
    const ops = new Browser(base);
    await ops.get('/admin/login');
    await ops.post('/admin/login', { email: 'ops@example.test', password: 'another-long-password' });
    await ops.open(`/admin/projects/${projectId}`);
    assert.equal((await ops.post(`/admin/deliverables/${d.id}/approve`)).status, 403);

    await admin.open(`/admin/projects/${projectId}`);
    assert.equal((await admin.post(`/admin/deliverables/${d.id}/approve`)).status, 303);
    assert.equal(db.get('SELECT status FROM assignments WHERE id = ?', a1.id).status, 'signed_off');
    assert.equal(db.get('SELECT status FROM tasks WHERE id = ?', a1.task_id).status, 'done');
    const cost = db.get('SELECT * FROM costs WHERE contractor_id = ?', samId);
    assert.equal(cost.amount_cents, 45000);
    assert.match(cost.description, /pay outside the system/);
    await drain();
    assert.equal(open(`review:d${d.id}:v1`).length, 0);
  });

  await t.test('remaining production closes out; final payment; release; completion', async () => {
    const [, a2, a3] = assignments();
    await admin.open(`/admin/projects/${projectId}`);
    // Task 2 had no available contractor: staff route it to the studio and complete it.
    await admin.post(`/admin/tasks/${a2.task_id}/route`, { route: 'studio' });
    await drain();
    assert.ok(open(`studio:t${a2.task_id}`).length);
    await admin.open(`/admin/projects/${projectId}`);
    await admin.post(`/admin/tasks/${a2.task_id}`, { status: 'done' });
    // Task 3: approve, contractor accepts and submits, QA, sign-off.
    await admin.post(`/admin/assignments/${a3.id}/approve`, {});
    await contractor.open('/contractor/home');
    await contractor.post(`/contractor/assignments/${a3.id}/respond`, { decision: 'accept', agree: 'yes' });
    await contractor.open('/contractor/home');
    await contractor.upload(`/contractor/assignments/${a3.id}/submit`, { note: '3D model.' }, [{ field: 'file', name: 'jacket.glb', data: Buffer.concat([Buffer.from('glTF'), Buffer.alloc(64, 1)]) }]);
    await drain();
    const d3 = db.get('SELECT * FROM deliverables WHERE assignment_id = ?', a3.id);
    await admin.open(`/admin/projects/${projectId}`);
    await admin.post(`/admin/deliverables/${d3.id}/approve`);
    await drain();
    assert.equal(wf().state, 'awaiting_final_payment', wf().blocked_reason || '');
    const final = db.get("SELECT * FROM invoices WHERE kind = 'final'");
    assert.deepEqual([final.status, final.amount_cents], ['draft', 120000]);
    await admin.open(`/admin/projects/${projectId}`);
    await admin.post(`/admin/invoices/${final.id}/approve`);
    await client.open('/portal/home');
    const pay = await client.post(`/portal/invoices/${final.id}/pay`);
    await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
    await drain();
    assert.equal(wf().state, 'ready_for_release');
    await admin.open(`/admin/projects/${projectId}`);
    for (const d of db.all("SELECT * FROM deliverables WHERE project_id = ? AND status = 'approved'", projectId)) await admin.post(`/admin/deliverables/${d.id}/release`);
    await drain();
    assert.equal(wf().state, 'completed');
    const money = app.projects.profitability(projectId);
    assert.equal(money.manualCosts, 45000 + 45000, 'both contractor fees recorded as costs');
    assert.ok(money.automationCosts > 0, 'simulated model usage is costed like real usage');
  });

  await t.test('every gate was passed by a person; dashboards render', async () => {
    const gates = db.all("SELECT actor, action FROM audit_log WHERE action IN ('quote.approved_and_sent','message.approved','assignment.approved','assignment.rejected','deliverable.approved','deliverable.released','invoice.approved')");
    assert.ok(gates.length >= 8);
    assert.ok(gates.every((g) => g.actor.startsWith('staff:')), JSON.stringify(gates));
    const contractorActs = db.all("SELECT actor FROM audit_log WHERE action IN ('assignment.accepted','assignment.submitted')");
    assert.ok(contractorActs.length >= 4 && contractorActs.every((g) => g.actor === `contractor:${samId}`));
    const someTask = db.get("SELECT id FROM jobs WHERE agent = 'qa'").id;
    for (const path of ['/admin/ops', '/admin/ops/tasks?status=all', `/admin/ops/tasks/${someTask}`, '/admin/ops/agents', `/admin/ops/workflows/${wfId}`, '/admin/messages', '/admin/contractors', '/admin/approvals', `/admin/projects/${projectId}`]) {
      const res = await admin.get(path);
      assert.equal(res.status, 200, path);
    }
    const history = await admin.get(`/admin/ops/tasks/${someTask}`);
    assert.match(history.text, /Simulated model/);
    assert.match(history.text, /inspect_deliverable/);
    assert.match((await admin.get('/admin/messages')).text, /Simulated/);
  });
});
