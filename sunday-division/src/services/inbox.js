'use strict';
/**
 * Studio inbox — one list of everything waiting on the studio, read from the same tables as the
 * Approvals and Operations pages. Nothing here writes: actions in the inbox post to the existing
 * routes, which keep their own permission checks, confirmations and audit entries.
 *
 * Groups:
 *   decision    a person must approve, issue, release or answer before work continues
 *   inquiry     new or in-review inquiries from the website
 *   agent       agent hand-offs (human tasks) and failed agent jobs
 *   production  INDEX V3 / FORM jobs and production hand-offs
 *   waiting     waiting on the client (deposit, open invoices, sent quotes) — no studio action
 */
const { money, titleCase } = require('../lib/util');

const GROUPS = [
  ['all', 'All'], ['decision', 'Decisions'], ['inquiry', 'Inquiries'],
  ['agent', 'Agents'], ['production', 'Production'], ['waiting', 'Waiting on client'],
];
const PRODUCT = { index_v3: 'INDEX V3', form: 'FORM' };

function approvalQueues(app) {
  const { db } = app;
  const join = 'JOIN projects p ON p.id = x.project_id';
  return {
    quotes: db.all(`SELECT x.*, p.code, p.name AS project_name FROM quotes x ${join} WHERE x.status = 'draft' ORDER BY x.id`),
    invoices: db.all(`SELECT x.*, p.code, p.name AS project_name FROM invoices x ${join} WHERE x.status = 'draft' ORDER BY x.id`),
    deliverables: db.all(`SELECT x.*, p.code, p.name AS project_name FROM deliverables x ${join} WHERE x.status IN ('in_review','approved') ORDER BY x.id`),
    updates: db.all(`SELECT x.*, p.code, p.name AS project_name FROM status_updates x ${join} WHERE x.status = 'draft' ORDER BY x.id`),
    revisions: db.all(`SELECT x.*, p.code, p.name AS project_name FROM revisions x ${join} WHERE x.status = 'open' ORDER BY x.id`),
    briefs: db.all("SELECT id AS project_id, code, name, brief_source, brief, updated_at FROM projects WHERE brief_status = 'draft' AND status != 'cancelled'"),
    assignments: db.all("SELECT x.*, p.code, c.name AS contractor_name, t.title AS task_title FROM assignments x JOIN projects p ON p.id = x.project_id JOIN contractors c ON c.id = x.contractor_id JOIN tasks t ON t.id = x.task_id WHERE x.status = 'recommended' ORDER BY x.id"),
    messages: db.all("SELECT x.*, p.code FROM messages x LEFT JOIN projects p ON p.id = x.project_id WHERE x.status = 'draft' ORDER BY x.id"),
    tasks: db.all(`SELECT x.project_id, p.code, p.name AS project_name, COUNT(*) AS n, MAX(x.created_at) AS created_at FROM tasks x ${join} WHERE x.status = 'proposed' GROUP BY x.project_id`),
    payments: app.billing.paymentsNeedingReview(),
  };
}

function items(app) {
  const { db } = app;
  const q = approvalQueues(app);
  const out = [];
  const add = (it) => out.push({ tone: 'decision', ...it });
  const proj = (r, anchor) => `/admin/projects/${r.project_id}#${anchor}`;

  // ── Decisions ──
  for (const r of q.quotes) add({ key: `quote-${r.id}`, group: 'decision', kind: 'quote', title: `Approve quote v${r.version}`, sub: `${r.code} · ${r.project_name} · ${money(r.total_cents)}`, code: r.code, at: r.created_at, href: proj(r, 'quote'), row: r });
  for (const r of q.invoices) add({ key: `invoice-${r.id}`, group: 'decision', kind: 'invoice', title: `Issue ${r.number}`, sub: `${r.code} · ${titleCase(r.kind)} · ${money(r.amount_cents)}`, code: r.code, at: r.created_at, href: proj(r, 'billing'), row: r });
  for (const r of q.deliverables) add({ key: `deliverable-${r.id}`, group: 'decision', kind: 'deliverable', title: r.status === 'in_review' ? `Review ${r.title}` : `Release ${r.title}`, sub: `${r.code} · ${r.project_name}`, code: r.code, at: r.created_at, href: proj(r, 'deliverables'), row: r });
  for (const r of q.updates) add({ key: `update-${r.id}`, group: 'decision', kind: 'update', title: 'Publish client update', sub: `${r.code} · ${String(r.body || '').slice(0, 70)}`, code: r.code, at: r.created_at, href: proj(r, 'updates'), row: r });
  for (const r of q.revisions) add({ key: `revision-${r.id}`, group: 'decision', kind: 'revision', title: 'Answer a revision request', sub: `${r.code} · ${String(r.notes || '').slice(0, 70)}`, code: r.code, at: r.created_at, href: proj(r, 'deliverables'), row: r });
  for (const r of q.briefs) add({ key: `brief-${r.project_id}`, group: 'decision', kind: 'brief', title: 'Approve the project brief', sub: `${r.code} · ${r.name}`, code: r.code, at: r.updated_at, href: proj(r, 'brief'), row: r });
  for (const r of q.assignments) add({ key: `assignment-${r.id}`, group: 'decision', kind: 'assignment', title: `Approve ${r.contractor_name}`, sub: `${r.code} · ${r.task_title} · ${money(r.fee_cents)}`, code: r.code, at: r.created_at, href: proj(r, 'production'), row: r });
  for (const r of q.messages) add({ key: `message-${r.id}`, group: 'decision', kind: 'message', title: `Approve message · ${r.subject}`, sub: `${r.code ? `${r.code} · ` : ''}to ${r.recipient_type}`, code: r.code || '', at: r.created_at, href: `/admin/messages#m${r.id}`, row: r });
  for (const r of q.tasks) add({ key: `tasks-${r.project_id}`, group: 'decision', kind: 'tasks', title: `Confirm ${r.n} proposed ${r.n === 1 ? 'task' : 'tasks'}`, sub: `${r.code} · ${r.project_name}`, code: r.code, at: r.created_at, href: proj(r, 'tasks'), row: r });
  for (const r of q.payments) add({ key: `payment-${r.id}`, group: 'decision', kind: 'payment', tone: 'attention', title: `Check payment on ${r.number}`, sub: `${titleCase(r.status)}${r.note ? ` · ${r.note}` : ''}`, code: '', at: r.created_at, href: `/admin/projects/${r.project_id}#billing`, row: r });

  // ── Inquiries ──
  for (const r of db.all("SELECT * FROM inquiries WHERE status IN ('new','reviewing') ORDER BY created_at DESC LIMIT 100")) {
    const who = r.brand_name || r.contact_name;
    add({ key: `inquiry-${r.id}`, group: 'inquiry', kind: 'inquiry', tone: r.status === 'new' ? 'decision' : 'quiet', title: r.kind === 'contact' ? `Message from ${who}` : `${who} · ${r.garment_category || 'new project'}`, sub: `${r.ref} · ${titleCase(r.status)}${r.budget ? ` · ${r.budget}` : ''}`, code: r.ref, at: r.created_at, href: `/admin/leads/${r.id}`, row: r });
  }

  // ── Agents ──
  for (const r of db.all("SELECT h.*, p.code FROM human_tasks h LEFT JOIN projects p ON p.id = h.project_id WHERE h.status = 'open' AND h.kind != 'production' ORDER BY h.created_at DESC LIMIT 100")) {
    add({ key: `handoff-${r.id}`, group: 'agent', kind: 'handoff', tone: r.kind === 'escalation' ? 'attention' : 'decision', title: r.title, sub: `${r.code ? `${r.code} · ` : ''}${titleCase(r.kind)} · from ${r.created_by}`, code: r.code || '', at: r.created_at, href: `/admin/ops/tasks/${r.id}`, row: r });
  }
  for (const r of db.all("SELECT j.*, p.code FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE j.status = 'failed' ORDER BY j.finished_at DESC LIMIT 50")) {
    add({ key: `job-${r.id}`, group: 'agent', kind: 'job', tone: 'danger', title: `${titleCase(r.agent)} could not ${String(r.action).replace(/_/g, ' ')}`, sub: `${r.code ? `${r.code} · ` : ''}${r.error_kind ? titleCase(r.error_kind) : 'Failed'} · ${r.attempts} of ${r.max_attempts} attempts`, code: r.code || '', at: r.finished_at || r.created_at, href: r.workflow_id ? `/admin/ops/workflows/${r.workflow_id}` : '/admin/ops', row: r });
  }

  // ── Production ──
  for (const r of db.all("SELECT h.*, p.code FROM human_tasks h LEFT JOIN projects p ON p.id = h.project_id WHERE h.status = 'open' AND h.kind = 'production' ORDER BY h.created_at DESC LIMIT 100")) {
    add({ key: `handoff-${r.id}`, group: 'production', kind: 'handoff', title: r.title, sub: `${r.code ? `${r.code} · ` : ''}Production hand-off`, code: r.code || '', at: r.created_at, href: `/admin/ops/tasks/${r.id}`, row: r });
  }
  for (const r of db.all("SELECT ij.*, p.code, p.name AS project_name FROM integration_jobs ij JOIN projects p ON p.id = ij.project_id WHERE ij.status IN ('needs_human','failed','queued','running') ORDER BY ij.updated_at DESC LIMIT 100")) {
    const tone = r.status === 'failed' ? 'danger' : r.status === 'needs_human' ? 'decision' : 'quiet';
    add({ key: `integration-${r.id}`, group: 'production', kind: 'integration', tone, title: `${PRODUCT[r.product] || r.product} · ${titleCase(r.job_type)}`, sub: `${r.code} · ${titleCase(r.status)} · ${r.mode === 'manual' ? 'manual hand-off' : 'connected service'}`, code: r.code, at: r.updated_at, href: `/admin/projects/${r.project_id}#production`, row: r });
  }

  // ── Waiting on the client ──
  for (const r of db.all("SELECT p.*, c.brand_name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.status = 'awaiting_deposit' ORDER BY p.updated_at DESC")) {
    add({ key: `deposit-${r.id}`, group: 'waiting', kind: 'deposit', tone: 'quiet', title: `Deposit from ${r.client_name}`, sub: `${r.code} · ${r.name}`, code: r.code, at: r.updated_at, href: `/admin/projects/${r.id}#billing`, row: r });
  }
  for (const r of db.all("SELECT x.*, p.code FROM invoices x JOIN projects p ON p.id = x.project_id WHERE x.status = 'open' ORDER BY x.id DESC")) {
    add({ key: `open-invoice-${r.id}`, group: 'waiting', kind: 'open-invoice', tone: 'quiet', title: `${r.number} unpaid`, sub: `${r.code} · ${money(r.amount_cents)}`, code: r.code, at: r.approved_at || r.created_at, href: `/admin/projects/${r.project_id}#billing`, row: r });
  }
  for (const r of db.all("SELECT x.*, p.code, p.name AS project_name FROM quotes x JOIN projects p ON p.id = x.project_id WHERE x.status = 'sent' ORDER BY x.id DESC")) {
    add({ key: `sent-quote-${r.id}`, group: 'waiting', kind: 'sent-quote', tone: 'quiet', title: `Quote v${r.version} with the client`, sub: `${r.code} · ${money(r.total_cents)}`, code: r.code, at: r.created_at, href: `/admin/projects/${r.project_id}#quote`, row: r });
  }
  return out;
}

/** Items for one filter, newest first within each urgency band (danger → attention → decision → quiet). */
function view(app, { filter = 'all', key = '' } = {}) {
  const all = items(app);
  const counts = Object.fromEntries(GROUPS.map(([g]) => [g, g === 'all' ? all.filter((i) => i.group !== 'waiting').length : all.filter((i) => i.group === g).length]));
  const rank = { danger: 0, attention: 1, decision: 2, quiet: 3 };
  const list = all
    .filter((i) => (filter === 'all' ? i.group !== 'waiting' : i.group === filter))
    .sort((a, b) => (rank[a.tone] - rank[b.tone]) || String(b.at || '').localeCompare(String(a.at || '')));
  const selected = list.find((i) => i.key === key) || null;
  return { list, counts, selected, groups: GROUPS };
}

module.exports = { approvalQueues, items, view, GROUPS };
