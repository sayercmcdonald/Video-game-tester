'use strict';
const { money } = require('../lib/util');
const { createCommandMetrics } = require('./metrics');
const { createFacts } = require('./facts');
const { createWebPush } = require('./webpush');
const { createNotifications } = require('./notifications');
const { createActions } = require('./actions');
const { createBrief } = require('./brief');
const { createChat } = require('./chat');

const SWEEP_MS = 5 * 60e3;
const BRIEF_CHECK_MS = 60e3;

/**
 * Sunday Division Command — the founder's application. Composes the founder-only services:
 * metrics (read-only numbers), verified facts, notifications and push, the action registry,
 * the Morning Brief and Command Chat. It runs inside the same process as everything else and
 * reaches the business only through the existing services.
 */
function createCommand(app) {
  const command = {};
  command.metrics = createCommandMetrics(app);
  command.facts = createFacts(app);
  command.push = createWebPush(app);
  command.notifications = createNotifications(app);
  command.actions = createActions(app);
  command.brief = createBrief(app);
  command.chat = createChat(app);

  /** Everything waiting for the founder's decision, with the action that decides it. */
  command.approvals = () => {
    const { db } = app;
    const items = [];
    for (const q of db.all(`SELECT q.*, p.code, p.name, c.brand_name FROM quotes q JOIN projects p ON p.id = q.project_id JOIN clients c ON c.id = p.client_id
        WHERE q.status = 'draft' AND p.status = 'scoping' AND q.total_cents > 0 ORDER BY q.id`)) {
      items.push({ group: 'quotes', type: 'send_quote', targetId: q.id, projectId: q.project_id, title: `Quote v${q.version} for ${q.brand_name || q.name}`, detail: `${q.code} · ${String(q.scope).slice(0, 140)}`, amount: money(q.total_cents), since: q.created_at, source: q.source });
    }
    for (const a of db.all(`SELECT a.*, c.name AS contractor, t.title AS task, p.code FROM assignments a JOIN contractors c ON c.id = a.contractor_id
        JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = a.project_id WHERE a.status = 'recommended' ORDER BY a.id`)) {
      items.push({ group: 'contractors', type: 'approve_assignment', alt: 'reject_assignment', targetId: a.id, projectId: a.project_id, title: `${a.contractor} for “${a.task}”`, detail: `${a.code} · ${a.estimated_hours} h · ${String(a.rationale).slice(0, 140)}`, amount: money(a.fee_cents), since: a.created_at, source: a.recommended_by });
    }
    for (const i of db.all(`SELECT i.*, p.code, c.brand_name FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = p.client_id WHERE i.status = 'draft' ORDER BY i.id`)) {
      items.push({ group: 'finance', type: 'issue_invoice', targetId: i.id, projectId: i.project_id, title: `${i.kind[0].toUpperCase()}${i.kind.slice(1)} invoice ${i.number}`, detail: `${i.code} · ${i.brand_name}`, amount: money(i.amount_cents), since: i.created_at });
    }
    for (const t of db.all("SELECT * FROM human_tasks WHERE status = 'open' AND (dedupe_key LIKE '%payment_exception%' OR dedupe_key LIKE '%deposit_mismatch%') ORDER BY id")) {
      items.push({ group: 'finance', type: 'resolve_exception', needsNote: true, targetId: t.id, projectId: t.project_id, title: t.title, detail: t.detail, since: t.created_at, exception: true });
    }
    for (const d of db.all(`SELECT d.*, p.code, (SELECT result FROM deliverable_qa WHERE deliverable_id = d.id AND version = d.version ORDER BY id DESC LIMIT 1) AS qa
        FROM deliverables d JOIN projects p ON p.id = d.project_id WHERE d.status = 'in_review' AND d.file_id IS NOT NULL ORDER BY d.id`)) {
      items.push({ group: 'deliverables', type: 'sign_off_deliverable', targetId: d.id, projectId: d.project_id, title: `Sign off “${d.title}” v${d.version}`, detail: `${d.code} · QA ${d.qa ? d.qa.toUpperCase() : 'pending'}`, since: d.created_at, qa: d.qa });
    }
    for (const d of db.all(`SELECT d.*, p.code FROM deliverables d JOIN projects p ON p.id = d.project_id WHERE d.status = 'approved' ORDER BY d.id`)) {
      if (d.stage === 'final' && app.billing.balanceDue(d.project_id) > 0) continue;
      items.push({ group: 'deliverables', type: 'release_deliverable', targetId: d.id, projectId: d.project_id, title: `Release “${d.title}” v${d.version}`, detail: `${d.code} · ${d.stage}`, since: d.approved_at });
    }
    for (const m of db.all('SELECT m.*, p.code FROM messages m LEFT JOIN projects p ON p.id = m.project_id WHERE m.status = \'draft\' ORDER BY m.id')) {
      items.push({ group: 'messages', type: 'send_message', alt: 'discard_message', targetId: m.id, projectId: m.project_id, title: m.subject, detail: `To the ${m.recipient_type}${m.code ? ` · ${m.code}` : ''} · ${String(m.body).slice(0, 120)}`, since: m.created_at, source: m.prepared_by });
    }
    return items;
  };

  command.onEvent = (ev) => command.notifications.onEvent(ev);
  command.afterJob = (job) => { if (job && job.agent === 'command') command.brief.finalize(job); };

  let lastSweep = 0;
  let lastBriefCheck = 0;
  /** Called from the orchestrator's loop: the daily brief and the notification sweep. */
  command.tick = () => {
    const t = app.orchestrator.clock();
    try {
      if (t - lastBriefCheck >= BRIEF_CHECK_MS) { lastBriefCheck = t; command.brief.due(); }
      if (t - lastSweep >= SWEEP_MS) { lastSweep = t; command.notifications.sweep(); }
    } catch (err) {
      console.error('[command] tick failed:', err);
    }
  };

  /** FOUNDER_EMAIL, when set, is the authoritative list of founder accounts. */
  command.syncFounders = () => {
    const emails = app.config.command.founderEmails;
    if (!emails.length) return;
    for (const u of app.db.all('SELECT id, email, founder FROM users')) {
      const want = emails.includes(u.email.toLowerCase()) ? 1 : 0;
      if (want === u.founder) continue;
      app.db.run('UPDATE users SET founder = ? WHERE id = ?', want, u.id);
      if (!want) app.sessions.endAllFor('founder', u.id);
      app.audit.log('system:config', want ? 'founder.granted' : 'founder.revoked', { entity: 'user', entityId: u.id, detail: `${u.email} via FOUNDER_EMAIL` });
    }
  };

  return command;
}

module.exports = { createCommand };
