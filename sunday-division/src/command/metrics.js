'use strict';
const { period, localDate, addDays, midnight } = require('./time');

/**
 * Read-only business numbers for the founder app. Every figure is computed from the
 * system of record (payments, invoices, costs, model runs, workflows) — nothing here is
 * estimated by a model, and nothing here writes.
 */
function createCommandMetrics(app) {
  const { db } = app;
  const n = (sql, ...p) => db.get(sql, ...p).n;
  const tz = () => app.settings.get('timezone');
  const nowMs = () => app.orchestrator.clock();
  const today = () => localDate(nowMs(), tz());

  /** Cash basis: verified payments received minus recorded costs, for [from, to). */
  function money(from, to) {
    const revenue = n("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE status = 'succeeded' AND received_at >= ? AND received_at < ?", from, to);
    const simulatedRevenue = n("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE status = 'succeeded' AND provider = 'simulated' AND received_at >= ? AND received_at < ?", from, to);
    const recordedCosts = n('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM costs WHERE created_at >= ? AND created_at < ?', from, to);
    const contractorCosts = n('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM costs WHERE contractor_id IS NOT NULL AND created_at >= ? AND created_at < ?', from, to);
    const aiMicros = n("SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE provider IN ('claude','openai','simulated') AND created_at >= ? AND created_at < ?", from, to);
    const externalMicros = n("SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE provider = 'integration' AND created_at >= ? AND created_at < ?", from, to);
    const automation = Math.ceil((aiMicros + externalMicros) / 1e4);
    const expenses = recordedCosts + automation;
    const booked = n("SELECT COALESCE(SUM(total_cents), 0) AS n FROM quotes WHERE status = 'accepted' AND responded_at >= ? AND responded_at < ?", from, to);
    const payments = n("SELECT COUNT(*) AS n FROM payments WHERE status = 'succeeded' AND received_at >= ? AND received_at < ?", from, to);
    return {
      from, to, revenue, simulatedRevenue, expenses, recordedCosts, contractorCosts, otherCosts: recordedCosts - contractorCosts,
      aiCents: Math.ceil(aiMicros / 1e4), externalCents: Math.ceil(externalMicros / 1e4),
      profit: revenue - expenses, margin: revenue ? (revenue - expenses) / revenue : null, booked, payments,
    };
  }
  const forPeriod = (name) => { const p = period(name, nowMs(), tz()); return { ...money(p.from, p.to), label: p.label, period: name }; };

  function projectCounts() {
    const rows = db.all('SELECT status, COUNT(*) AS n FROM projects GROUP BY status');
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return { scoping: by.scoping || 0, awaitingDeposit: by.awaiting_deposit || 0, inProduction: by.active || 0, delivered: by.delivered || 0, active: (by.active || 0) + (by.awaiting_deposit || 0) + (by.scoping || 0) };
  }

  /** Each check: ok | watch | act, with the reason and where to look. */
  function health() {
    const t = today();
    const nowIso = new Date(nowMs()).toISOString();
    const hoursAgo = (h) => new Date(nowMs() - h * 3600e3).toISOString();
    const checks = [];
    const add = (id, label, status, detail, link) => checks.push({ id, label, status, detail, link });

    const approvals = db.get("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM human_tasks WHERE status = 'open' AND kind IN ('approval','review')");
    add('approvals', 'Approvals', approvals.n === 0 ? 'ok' : approvals.oldest < hoursAgo(48) ? 'act' : 'watch',
      approvals.n === 0 ? 'Nothing waiting for you' : `${approvals.n} waiting${approvals.oldest < hoursAgo(48) ? ', oldest over 2 days' : ''}`, '/command/approvals');

    const failed = n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed'");
    const blocked = n("SELECT COUNT(*) AS n FROM workflows WHERE blocked_reason IS NOT NULL AND state NOT IN ('completed','cancelled','lost')");
    const paused = app.settings.get('orchestrator_paused');
    add('automation', 'Agents', failed || blocked ? 'act' : paused ? 'watch' : 'ok',
      failed || blocked ? `${failed} failed task(s), ${blocked} blocked workflow(s)` : paused ? 'Automation is paused' : 'Running normally', '/command/agents');

    const overdueTasks = n("SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ? AND p.status = 'active'", t);
    const overdueAssign = n("SELECT COUNT(*) AS n FROM assignments WHERE status IN ('offered','accepted','changes_requested') AND due_date IS NOT NULL AND due_date < ?", t);
    const atRisk = atRiskProjects().length;
    add('delivery', 'Delivery', overdueTasks + overdueAssign ? 'act' : atRisk ? 'watch' : 'ok',
      overdueTasks + overdueAssign ? `${overdueTasks + overdueAssign} overdue task(s)` : atRisk ? `${atRisk} project(s) due within 5 days with work open` : 'On schedule', '/command/projects?filter=attention');

    const exceptions = n("SELECT COUNT(*) AS n FROM human_tasks WHERE status = 'open' AND (dedupe_key LIKE '%payment_exception%' OR dedupe_key LIKE '%deposit_mismatch%')");
    const staleInvoices = n("SELECT COUNT(*) AS n FROM invoices WHERE status = 'open' AND COALESCE(approved_at, created_at) < ?", new Date(nowMs() - 14 * 864e5).toISOString());
    add('cash', 'Cash', exceptions ? 'act' : staleInvoices ? 'watch' : 'ok',
      exceptions ? `${exceptions} payment exception(s) to review` : staleInvoices ? `${staleInvoices} invoice(s) unpaid after 14 days` : 'No payment issues', '/command/approvals#finance');

    const spent = app.budget.aiSpentThisMonth() / 1e6;
    const budget = app.settings.get('ai_monthly_budget_usd');
    const ratio = budget ? spent / budget : 0;
    add('spend', 'AI spend', ratio >= 0.9 ? 'act' : ratio >= 0.75 ? 'watch' : 'ok', `$${spent.toFixed(2)} of $${budget} this month`, '/command/settings#budgets');

    const unanswered = n("SELECT COUNT(*) AS n FROM assignments WHERE status = 'offered' AND offered_at < ?", hoursAgo(48));
    add('contractors', 'Contractors', unanswered ? 'watch' : 'ok', unanswered ? `${unanswered} offer(s) unanswered for 2+ days` : 'No delays', '/command/projects?filter=attention');

    const rank = { ok: 0, watch: 1, act: 2 };
    const overall = checks.reduce((w, c) => (rank[c.status] > rank[w] ? c.status : w), 'ok');
    return { overall, label: { ok: 'Healthy', watch: 'Watch', act: 'Needs you' }[overall], checks, at: nowIso };
  }

  function atRiskProjects() {
    const t = today();
    const soon = addDays(t, 5);
    return db.all(`SELECT p.id, p.code, p.name, p.due_date,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND kind = 'production' AND status != 'done') AS open_work
      FROM projects p WHERE p.status = 'active' AND p.due_date IS NOT NULL AND p.due_date <= ?`, soon).filter((p) => p.open_work > 0);
  }

  function urgent() {
    const items = db.all(`SELECT h.id, h.kind, h.title, h.detail, h.created_at, h.project_id, p.code AS project_code FROM human_tasks h
      LEFT JOIN projects p ON p.id = h.project_id WHERE h.status = 'open' AND h.kind = 'escalation' ORDER BY h.id DESC LIMIT 6`)
      .map((h) => ({ title: h.title, detail: h.detail, at: h.created_at, project: h.project_code, link: h.project_id ? `/command/projects/${h.project_id}` : '/command/agents' }));
    for (const p of atRiskProjects()) items.push({ title: `${p.code} due ${p.due_date} with ${p.open_work} production task(s) open`, detail: p.name, link: `/command/projects/${p.id}`, project: p.code });
    return items;
  }

  /** Workflow state per project, for stage labels. */
  const STATES = () => app.orchestrator.STATES;
  function stageOf(p) {
    const wf = p.workflow_state ? STATES()[p.workflow_state] : null;
    return wf ? wf.label : ({ scoping: 'Scoping', awaiting_deposit: 'Deposit', active: 'Production', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled' })[p.status] || p.status;
  }

  function projects(filter = 'active') {
    const t = today();
    const rows = db.all(`SELECT p.*, c.brand_name, w.state AS workflow_state, w.blocked_reason, w.paused AS workflow_paused, w.id AS workflow_id,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND kind = 'production') AS prod_total,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND kind = 'production' AND status = 'done') AS prod_done,
        (SELECT COUNT(*) FROM human_tasks WHERE project_id = p.id AND status = 'open') AS open_actions,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'done' AND due_date IS NOT NULL AND due_date < ?) AS overdue
      FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN workflows w ON w.project_id = p.id
      ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'awaiting_deposit' THEN 1 WHEN 'scoping' THEN 2 ELSE 3 END, p.id DESC`, t);
    const out = rows.map((p) => ({ ...p, stage: stageOf(p), attention: Boolean(p.blocked_reason || p.overdue || p.open_actions) }));
    if (filter === 'all') return out;
    if (filter === 'attention') return out.filter((p) => p.attention && !['closed', 'cancelled'].includes(p.status));
    if (filter === 'done') return out.filter((p) => ['delivered', 'closed', 'cancelled'].includes(p.status));
    return out.filter((p) => ['scoping', 'awaiting_deposit', 'active'].includes(p.status));
  }

  function project(id) {
    const p = db.get(`SELECT p.*, c.brand_name, w.state AS workflow_state, w.blocked_reason, w.paused AS workflow_paused, w.id AS workflow_id
      FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN workflows w ON w.project_id = p.id WHERE p.id = ?`, id);
    if (!p) return null;
    const qa = (d) => db.get('SELECT result, checks FROM deliverable_qa WHERE deliverable_id = ? AND version = ? ORDER BY id DESC', d.id, d.version);
    return {
      ...p,
      stage: stageOf(p),
      timeline: p.workflow_id ? db.all('SELECT to_state, created_at, reason FROM workflow_transitions WHERE workflow_id = ? ORDER BY id', p.workflow_id).map((t) => ({ ...t, label: (STATES()[t.to_state] || {}).label || t.to_state })) : [],
      tasks: db.all("SELECT * FROM tasks WHERE project_id = ? AND kind = 'production' ORDER BY sort, id", id),
      assignments: db.all('SELECT a.*, c.name AS contractor_name, t.title AS task_title FROM assignments a JOIN contractors c ON c.id = a.contractor_id JOIN tasks t ON t.id = a.task_id WHERE a.project_id = ? ORDER BY a.id DESC', id),
      deliverables: db.all('SELECT * FROM deliverables WHERE project_id = ? ORDER BY id', id).map((d) => ({ ...d, qa: qa(d) })),
      invoices: db.all('SELECT * FROM invoices WHERE project_id = ? ORDER BY id', id),
      quote: db.get("SELECT * FROM quotes WHERE project_id = ? AND status IN ('accepted','sent','draft') ORDER BY CASE status WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, version DESC", id),
      money: app.projects.profitability(id),
      openActions: db.all("SELECT * FROM human_tasks WHERE project_id = ? AND status = 'open' ORDER BY id", id),
      activity: db.all('SELECT * FROM audit_log WHERE project_id = ? ORDER BY id DESC LIMIT 12', id),
    };
  }

  function weeklyRevenue(weeks = 12) {
    const tzName = tz();
    const p = period('this_week', nowMs(), tzName);
    const monday = localDate(Date.parse(p.from) + 12 * 3600e3, tzName);
    const out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = addDays(monday, -7 * i);
      const from = new Date(midnight(start, tzName)).toISOString();
      const to = i === 0 ? new Date(nowMs()).toISOString() : new Date(midnight(addDays(start, 7), tzName)).toISOString();
      const m = money(from, to);
      out.push({ week: start, revenue: m.revenue, expenses: m.expenses, partial: i === 0 });
    }
    return out;
  }

  function monthly(months = 6) {
    const tzName = tz();
    const [y, m] = localDate(nowMs(), tzName).split('-').map(Number);
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 10);
      const next = new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 10);
      const to = i === 0 ? new Date(nowMs()).toISOString() : new Date(midnight(next, tzName)).toISOString();
      out.push({ month: start.slice(0, 7), ...money(new Date(midnight(start, tzName)).toISOString(), to), partial: i === 0 });
    }
    return out;
  }

  function efficiency() {
    const firstQa = db.all('SELECT result FROM deliverable_qa WHERE version = 1');
    const submitted = n("SELECT COUNT(DISTINCT json_extract(payload, '$.assignmentId')) AS n FROM events WHERE type = 'assignment.submitted'");
    const changed = n("SELECT COUNT(DISTINCT json_extract(payload, '$.assignmentId')) AS n FROM events WHERE type = 'assignment.changes_requested'");
    const delivered = db.all("SELECT due_date, submitted_at FROM assignments WHERE status IN ('submitted','signed_off') AND due_date IS NOT NULL AND submitted_at IS NOT NULL");
    const offers = db.all("SELECT offered_at, responded_at FROM assignments WHERE offered_at IS NOT NULL AND responded_at IS NOT NULL");
    const ops = require('../orchestrator/metrics').createMetrics(app).overview();
    const days = (h) => (h === null ? null : h / 24);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      qaFirstPass: firstQa.length ? firstQa.filter((r) => r.result === 'pass').length / firstQa.length : null, qaSample: firstQa.length,
      revisionRate: submitted ? changed / submitted : null, revisionSample: submitted,
      onTime: delivered.length ? delivered.filter((a) => a.submitted_at.slice(0, 10) <= a.due_date).length / delivered.length : null, onTimeSample: delivered.length,
      offerResponseHours: avg(offers.map((o) => (Date.parse(o.responded_at) - Date.parse(o.offered_at)) / 3600e3)), offerSample: offers.length,
      automationRate: ops.automationRate, automationBasis: ops.automationBasis,
      turnaround: {
        inquiryToQuote: days(ops.turnaround.toQuoteSent),
        depositToProduction: days(ops.turnaround.depositToProduction),
        inquiryToCompletion: days(ops.turnaround.toCompletion),
      },
    };
  }

  function approvalsCount() {
    return n("SELECT COUNT(*) AS n FROM quotes q JOIN projects p ON p.id = q.project_id WHERE q.status = 'draft' AND p.status = 'scoping' AND q.total_cents > 0")
      + n("SELECT COUNT(*) AS n FROM assignments WHERE status = 'recommended'")
      + n("SELECT COUNT(*) AS n FROM messages WHERE status = 'draft'")
      + n("SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'")
      + n("SELECT COUNT(*) AS n FROM deliverables WHERE status = 'in_review' AND file_id IS NOT NULL")
      + n("SELECT COUNT(*) AS n FROM human_tasks WHERE status = 'open' AND (dedupe_key LIKE '%payment_exception%' OR dedupe_key LIKE '%deposit_mismatch%')");
  }

  function agents() {
    const stats = require('../orchestrator/metrics').createMetrics(app).agentStats();
    const ids = ['sales', 'project_manager', 'talent', 'production', 'qa', 'client_success', 'command', 'orchestrator'];
    return ids.map((id) => {
      const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM jobs WHERE agent = ? GROUP BY status', id).map((r) => [r.status, r.n]));
      const last = db.get("SELECT id, action, error, finished_at FROM jobs WHERE agent = ? AND status = 'failed' ORDER BY id DESC LIMIT 1", id);
      const month = new Date(Date.UTC(new Date(nowMs()).getUTCFullYear(), new Date(nowMs()).getUTCMonth(), 1)).toISOString();
      const cost = n('SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE agent = ? AND created_at >= ?', id, month);
      const mode = app.settings.agentMode(id);
      const running = counts.running || 0;
      const queued = counts.queued || 0;
      const failed = counts.failed || 0;
      const state = mode === 'paused' ? 'paused' : failed ? 'failing' : running ? 'working' : queued ? 'queued' : 'idle';
      return { id, mode, state, running, queued, failed, succeeded: counts.succeeded || 0, lastFailure: last, costMonthMicros: cost, stats: (stats.runs || {})[id] || null };
    });
  }

  return { money, forPeriod, projectCounts, health, urgent, projects, project, weeklyRevenue, monthly, efficiency, approvalsCount, agents, atRiskProjects, today };
}

module.exports = { createCommandMetrics };
