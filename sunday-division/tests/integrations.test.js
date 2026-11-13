'use strict';
/**
 * INDEX V3 in API mode against a mock server that implements docs/INTEGRATIONS.md.
 * Proves the contract end to end and that generated output still needs human review.
 */
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Browser, PNG, INQUIRY, signInAdmin } = require('./helpers');

function mockIndexV3() {
  const seen = { files: [], jobs: [], auth: new Set() };
  const output = Buffer.from('%PDF-1.7 generated tech pack ............');
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.auth.add(req.headers.authorization);
      const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'POST' && req.url === '/v1/files') { seen.files.push({ type: req.headers['content-type'], size: Buffer.concat(chunks).length }); return json(201, { id: `file_${seen.files.length}` }); }
      if (req.method === 'POST' && req.url === '/v1/jobs') { seen.jobs.push({ body: JSON.parse(Buffer.concat(chunks)), key: req.headers['idempotency-key'] }); return json(202, { id: 'job_42', status: 'queued' }); }
      if (req.method === 'GET' && req.url === '/v1/jobs/job_42') {
        return json(200, { id: 'job_42', status: 'completed', validation: { status: 'passed', checks: [] }, outputs: [{ id: 'out_1', filename: 'tech-pack.pdf', content_type: 'application/pdf' }] });
      }
      if (req.method === 'GET' && req.url === '/v1/jobs/job_42/outputs/out_1') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(output); }
      json(404, { error: 'not found' });
    });
  });
  return { server, seen, output };
}

test('INDEX V3 API mode: job submission, polling and review-gated import', async (t) => {
  const mock = mockIndexV3();
  await new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
  const { app, base, close } = await startApp({ INDEX_V3_API_URL: `http://127.0.0.1:${mock.server.address().port}`, INDEX_V3_API_KEY: 'test-key' });
  t.after(async () => { await close(); mock.server.close(); });
  const { db } = app;

  // Fast-forward a project to "deposit paid" using the real services.
  await new Browser(base).upload('/start', INQUIRY, [{ field: 'references', name: 'ref.png', data: PNG, type: 'image/png' }]);
  const admin = await signInAdmin(base);
  const inquiry = app.intake.get(1);
  const project = app.projects.createFromInquiry(inquiry, 'test');
  const user = db.get('SELECT * FROM users');
  const quoteId = app.quotes.saveDraft(project.id, { scope: 'Tech pack', line_items: [{ description: 'Tech pack', quantity: 1, unit_cents: 200000 }], deposit_percent: 50 }, { actor: 'test' });
  app.quotes.approveAndSend(quoteId, user);
  const { invoiceId } = app.quotes.respond(quoteId, project.client_id, { accept: true, signedName: 'Jordan Reyes' });
  app.billing.recordManualPayment(invoiceId, 'WIRE-001', user);
  assert.equal(app.projects.get(project.id).status, 'active');

  const page = await admin.open(`/admin/projects/${project.id}`);
  assert.match(page.text, /Connected/);
  assert.equal((await admin.post(`/admin/projects/${project.id}/integrations`, { product: 'index_v3', job_type: 'tech_pack', notes: 'Base size M' })).status, 303);
  const job = db.get('SELECT * FROM integration_jobs');
  assert.deepEqual([job.mode, job.status, job.external_id], ['api', 'queued', 'job_42']);
  assert.deepEqual([...mock.seen.auth], ['Bearer test-key']);
  assert.equal(mock.seen.files.length, 1, 'reference image was uploaded');
  assert.equal(mock.seen.jobs[0].body.job_type, 'tech_pack');
  assert.deepEqual(mock.seen.jobs[0].body.input_file_ids, ['file_1']);
  assert.equal(mock.seen.jobs[0].body.client_reference, project.code);
  assert.ok(!JSON.stringify(mock.seen.jobs[0].body).includes(INQUIRY.email), 'client contact details are not sent');

  await admin.open(`/admin/projects/${project.id}`);
  assert.equal((await admin.post(`/admin/jobs/${job.id}/refresh`)).status, 303);
  assert.equal(db.get('SELECT status FROM integration_jobs').status, 'completed');
  const deliverable = db.get('SELECT * FROM deliverables');
  assert.deepEqual([deliverable.source, deliverable.status, deliverable.version], ['index_v3', 'in_review', 1]);
  assert.match(deliverable.notes, /Validation: passed/);
  assert.equal(db.get('SELECT size FROM files WHERE id = ?', deliverable.file_id).size, mock.output.length);
  // Passing validation upstream does not skip the human gate.
  assert.throws(() => app.projects.releaseDeliverable(deliverable.id, user), /approved by a reviewer/);

  // FORM is not configured in this test, so it stays in manual mode.
  await admin.post(`/admin/projects/${project.id}/integrations`, { product: 'form', job_type: 'product_imagery' });
  assert.equal(db.get("SELECT mode FROM integration_jobs WHERE product = 'form'").mode, 'manual');
});
