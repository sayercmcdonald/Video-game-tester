'use strict';
const { money, str, now } = require('../lib/util');
const { addDays } = require('./time');
const { sha256 } = require('../lib/crypto');

const KIND_LABEL = {
  paid_project: 'New paid project', approval: 'Pending approval', workflow_failed: 'Workflow failure', contractor_delay: 'Contractor delay',
  project_risk: 'Project risk', unusual_expense: 'Unusual expense', brief: 'Morning Brief',
};

/**
 * The founder's notification centre. Notifications are created by deterministic triggers —
 * application events, new human tasks and a periodic sweep — never by a model. Each one is
 * keyed, so the same fact notifies once. Push delivery follows the founder's preferences.
 */
function createNotifications(app) {
  const { db } = app;
  const nowMs = () => app.orchestrator.clock();

  function create({ kind, severity = 'info', title, body = '', link = '', key, projectId = null }) {
    const id = db.insertIgnore('notifications', { kind, severity, title: str(title, 160), body: str(body, 600), link: str(link, 200), dedupe_key: key, project_id: projectId, created_at: new Date(nowMs()).toISOString() });
    if (!id) return null;
    if (!app.settings.get(`push_${kind}`)) { db.run("UPDATE notifications SET push_status = 'off' WHERE id = ?", id); return id; }
    if (!db.get('SELECT 1 FROM push_subscriptions LIMIT 1')) return id;
    const delivery = app.command.push.notifyAll({ urgency: severity === 'urgent' ? 'high' : 'normal' })
      .then((n) => { db.run('UPDATE notifications SET push_status = ? WHERE id = ?', n ? 'sent' : 'failed', id); return n; })
      .catch((err) => { console.error('[notify] push failed:', err.message); return 0; });
    pending.add(delivery);
    delivery.finally(() => pending.delete(delivery));
    return id;
  }
  const pending = new Set();

  function onEvent(ev) {
    const payload = JSON.parse(ev.payload || '{}');
    if (ev.type === 'invoice.paid') {
      const inv = db.get('SELECT i.*, p.code, p.name FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = ?', payload.invoiceId);
      // Only a verified deposit makes a "paid project" (signed webhook + matching payment + unlocked).
      if (inv && inv.kind === 'deposit' && app.billing.depositVerified(inv.project_id)) {
        create({ kind: 'paid_project', title: `New paid project: ${inv.code}`, body: `${inv.name} — deposit of ${money(inv.amount_cents)} verified. Production is starting.`, link: `/command/projects/${inv.project_id}`, key: `paid_project:p${inv.project_id}`, projectId: inv.project_id });
      }
    }
  }

  function onHumanTask(t) {
    const k = t.dedupe_key;
    const link = t.project_id ? `/command/projects/${t.project_id}` : '/command/approvals';
    if (/payment_exception|deposit_mismatch/.test(k)) return create({ kind: 'approval', severity: 'urgent', title: `Financial exception: ${t.title}`, body: t.detail, link: '/command/approvals#finance', key: `ht:${t.id}`, projectId: t.project_id });
    if (t.kind === 'approval' || t.kind === 'review') return create({ kind: 'approval', severity: 'attention', title: t.title, body: t.detail, link: '/command/approvals', key: `ht:${t.id}`, projectId: t.project_id });
    if (/job_failed/.test(k)) return create({ kind: 'workflow_failed', severity: 'urgent', title: t.title, body: t.detail, link: '/command/agents', key: `ht:${t.id}`, projectId: t.project_id });
    if (/overdue/.test(k)) return create({ kind: 'project_risk', severity: 'attention', title: t.title, body: t.detail, link, key: `ht:${t.id}`, projectId: t.project_id });
    return null;
  }

  /** Periodic checks for conditions no single event announces. */
  function sweep() {
    const nowIso = new Date(nowMs()).toISOString();
    const today = app.command.metrics.today();
    const twoDaysAgo = new Date(nowMs() - 48 * 3600e3).toISOString();
    const assignmentSql = 'SELECT a.*, c.name, t.title, p.code FROM assignments a JOIN contractors c ON c.id = a.contractor_id JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = a.project_id';
    for (const a of db.all(`${assignmentSql} WHERE a.status = 'offered' AND a.offered_at < ?`, twoDaysAgo)) {
      create({ kind: 'contractor_delay', severity: 'attention', title: `${a.name} hasn't answered an offer`, body: `${a.code}: "${a.title}" was offered over 2 days ago.`, link: `/command/projects/${a.project_id}`, key: `delay:offer:a${a.id}`, projectId: a.project_id });
    }
    for (const a of db.all(`${assignmentSql} WHERE a.status IN ('accepted','changes_requested') AND a.due_date IS NOT NULL AND a.due_date < ?`, today)) {
      create({ kind: 'contractor_delay', severity: 'urgent', title: `${a.name} is past due on ${a.code}`, body: `"${a.title}" was due ${a.due_date} and nothing has been submitted.`, link: `/command/projects/${a.project_id}`, key: `delay:due:a${a.id}:${a.due_date}`, projectId: a.project_id });
    }
    for (const p of app.command.metrics.atRiskProjects()) {
      create({ kind: 'project_risk', severity: 'attention', title: `${p.code} is due ${p.due_date}`, body: `${p.open_work} production task(s) are still open.`, link: `/command/projects/${p.id}`, key: `risk:due:p${p.id}:${p.due_date}`, projectId: p.id });
    }
    for (const q of db.all("SELECT q.*, d.title, d.project_id, p.code FROM deliverable_qa q JOIN deliverables d ON d.id = q.deliverable_id JOIN projects p ON p.id = d.project_id WHERE q.result = 'fail' AND q.created_at >= ?", addDays(today, -7))) {
      create({ kind: 'project_risk', severity: 'urgent', title: `QA failed: ${q.title} (${q.code})`, body: `Version ${q.version} failed automated checks. A reviewer needs to look before anything moves on.`, link: `/command/projects/${q.project_id}`, key: `risk:qa:q${q.id}`, projectId: q.project_id });
    }
    for (const w of db.all("SELECT w.*, p.code FROM workflows w LEFT JOIN projects p ON p.id = w.project_id WHERE w.blocked_reason IS NOT NULL AND w.state NOT IN ('completed','cancelled','lost')")) {
      create({ kind: 'workflow_failed', severity: 'urgent', title: `Workflow blocked${w.code ? `: ${w.code}` : ''}`, body: w.blocked_reason, link: '/command/agents', key: `blocked:wf${w.id}:${sha256(w.blocked_reason).slice(0, 12)}`, projectId: w.project_id });
    }
    const threshold = Math.round(app.settings.get('unusual_expense_usd') * 100);
    for (const c of db.all('SELECT c.*, p.code FROM costs c JOIN projects p ON p.id = c.project_id WHERE c.amount_cents > ? AND c.created_at >= ?', threshold, addDays(today, -30))) {
      create({ kind: 'unusual_expense', severity: 'attention', title: `Cost of ${money(c.amount_cents)} on ${c.code}`, body: `${c.description} — above your ${money(threshold)} flag.`, link: `/command/projects/${c.project_id}`, key: `expense:c${c.id}`, projectId: c.project_id });
    }
    const spent = app.budget.aiSpentThisMonth() / 1e6;
    const budget = app.settings.get('ai_monthly_budget_usd');
    if (budget > 0 && spent >= 0.8 * budget) {
      const full = spent >= budget;
      create({ kind: 'unusual_expense', severity: full ? 'urgent' : 'attention', title: `AI spend at ${Math.round((spent / budget) * 100)}% of budget`, body: `$${spent.toFixed(2)} of $${budget} this month. Agents fall back to rules when the budget is reached.`, link: '/command/settings#budgets', key: `expense:ai:${nowIso.slice(0, 7)}:${full ? 100 : 80}` });
    }
    const cap = app.settings.get('external_project_budget_usd');
    for (const p of db.all("SELECT DISTINCT r.project_id, p.code FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE r.provider = 'integration'")) {
      const used = app.budget.externalSpentForProject(p.project_id) / 1e6;
      if (cap > 0 && used >= 0.8 * cap) {
        create({ kind: 'unusual_expense', severity: 'attention', title: `External services at ${Math.round((used / cap) * 100)}% of budget on ${p.code}`, body: `$${used.toFixed(2)} of $${cap}.`, link: `/command/projects/${p.project_id}`, key: `expense:ext:p${p.project_id}:80`, projectId: p.project_id });
      }
    }
  }

  return {
    KIND_LABEL, create, onEvent, onHumanTask, sweep,
    /** Resolves when in-flight push deliveries finish (tests and shutdown). */
    settled: () => Promise.allSettled([...pending]),
    list: (limit = 60) => db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', limit),
    unreadCount: () => db.get('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').n,
    latestUnread: () => db.get('SELECT * FROM notifications WHERE read_at IS NULL ORDER BY id DESC LIMIT 1'),
    markRead: (id) => (id ? db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL', now(), id) : db.run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL', now())),
  };
}

module.exports = { createNotifications, KIND_LABEL };
