'use strict';
const { money } = require('../lib/util');

const ASSIGNMENT_TEXT = {
  'assignment.recommended': (a) => `Talent Agent recommended ${a.contractor} for "${a.task}" (${a.hours}h, ${money(a.fee)}) — awaiting your approval`,
  'assignment.offered': (a) => `Offer sent to ${a.contractor} for "${a.task}" (${money(a.fee)}${a.due ? `, due ${a.due}` : ''})`,
  'assignment.accepted': (a) => `${a.contractor} accepted "${a.task}"`,
  'assignment.declined': (a) => `${a.contractor} declined "${a.task}"`,
  'assignment.submitted': (a) => `${a.contractor} submitted work for "${a.task}"`,
  'assignment.changes_requested': (a) => `Changes requested from ${a.contractor} on "${a.task}"`,
  'assignment.signed_off': (a) => `Work by ${a.contractor} on "${a.task}" signed off; fee ${money(a.fee)} recorded as a cost`,
  'assignment.rejected': (a) => `Recommendation of ${a.contractor} for "${a.task}" was rejected`,
  'assignment.cancelled': (a) => `Assignment of "${a.task}" to ${a.contractor} was cancelled`,
};

/**
 * Verified facts: short sentences built by code from database records, each with an id
 * and a link to its source. The Morning Brief and Command Chat may only restate these.
 */
function createFacts(app) {
  const { db } = app;

  function collect(from, to, { limit = 80 } = {}) {
    const facts = [];
    const add = (kind, at, text, { link = '', severity = 'info', ref = '', projectId = null } = {}) => facts.push({ kind, at, text, link, severity, ref, projectId });
    const pLink = (id) => (id ? `/command/projects/${id}` : '');

    for (const r of db.all(`SELECT pay.*, i.number, i.kind AS invoice_kind, p.code, p.id AS pid FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN projects p ON p.id = i.project_id
        WHERE pay.received_at >= ? AND pay.received_at < ? ORDER BY pay.id`, from, to)) {
      if (r.status === 'succeeded') {
        add('payment', r.received_at, `Verified payment of ${money(r.amount_cents)} received for ${r.code} (${r.invoice_kind} invoice ${r.number}, via ${r.provider === 'simulated' ? 'SIMULATED checkout — development only' : r.provider})`, { link: pLink(r.pid), severity: 'good', ref: `payment:${r.id}`, projectId: r.pid });
      } else {
        add('payment_exception', r.received_at, `Payment exception on ${r.number} (${r.code}): ${r.status}, ${money(r.amount_cents)} — needs review`, { link: pLink(r.pid), severity: 'urgent', ref: `payment:${r.id}`, projectId: r.pid });
      }
    }
    for (const r of db.all("SELECT * FROM inquiries WHERE kind = 'project' AND created_at >= ? AND created_at < ? ORDER BY id", from, to)) {
      add('inquiry', r.created_at, `New inquiry ${r.ref} from ${r.brand_name || r.contact_name}${r.garment_category ? ` (${r.garment_category})` : ''}`, { link: '/command/projects?filter=all', ref: `inquiry:${r.id}` });
    }
    for (const r of db.all(`SELECT q.*, p.code, p.id AS pid FROM quotes q JOIN projects p ON p.id = q.project_id
        WHERE (q.approved_at >= ? AND q.approved_at < ?) OR (q.responded_at >= ? AND q.responded_at < ?) ORDER BY q.id`, from, to, from, to)) {
      if (r.approved_at >= from && r.approved_at < to) add('quote', r.approved_at, `Quote v${r.version} for ${r.code} (${money(r.total_cents)}) approved and sent to the client`, { link: pLink(r.pid), ref: `quote:${r.id}`, projectId: r.pid });
      if (r.responded_at >= from && r.responded_at < to) add('quote', r.responded_at, `Client ${r.status === 'declined' ? 'declined' : 'accepted'} quote v${r.version} for ${r.code} (${money(r.total_cents)})`, { link: pLink(r.pid), severity: r.status === 'declined' ? 'attention' : 'good', ref: `quote:${r.id}`, projectId: r.pid });
    }
    for (const e of db.all("SELECT * FROM events WHERE type LIKE 'assignment.%' AND created_at >= ? AND created_at < ? ORDER BY id", from, to)) {
      const id = JSON.parse(e.payload).assignmentId;
      const a = db.get('SELECT a.*, c.name AS contractor, t.title AS task, p.code FROM assignments a JOIN contractors c ON c.id = a.contractor_id JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = a.project_id WHERE a.id = ?', id);
      const fn = ASSIGNMENT_TEXT[e.type];
      if (a && fn) add('assignment', e.created_at, `${a.code}: ${fn({ contractor: a.contractor, task: a.task, hours: a.estimated_hours, fee: a.fee_cents, due: a.due_date })}`, { link: pLink(a.project_id), severity: e.type === 'assignment.declined' ? 'attention' : 'info', ref: `assignment:${a.id}`, projectId: a.project_id });
    }
    for (const r of db.all(`SELECT q.*, d.title, d.project_id, p.code FROM deliverable_qa q JOIN deliverables d ON d.id = q.deliverable_id JOIN projects p ON p.id = d.project_id
        WHERE q.created_at >= ? AND q.created_at < ? ORDER BY q.id`, from, to)) {
      add('qa', r.created_at, `QA ${r.result.toUpperCase()} on "${r.title}" v${r.version} (${r.code})${r.result === 'pass' ? '' : ' — reviewer to check'}; technical sign-off still required`, { link: pLink(r.project_id), severity: r.result === 'fail' ? 'urgent' : r.result === 'warn' ? 'attention' : 'info', ref: `deliverable:${r.deliverable_id}:qa${r.id}`, projectId: r.project_id });
    }
    for (const r of db.all(`SELECT d.*, p.code FROM deliverables d JOIN projects p ON p.id = d.project_id
        WHERE (d.approved_at >= ? AND d.approved_at < ?) OR (d.released_at >= ? AND d.released_at < ?)`, from, to, from, to)) {
      if (r.approved_at >= from && r.approved_at < to) add('deliverable', r.approved_at, `"${r.title}" v${r.version} signed off by a reviewer (${r.code})`, { link: pLink(r.project_id), severity: 'good', ref: `deliverable:${r.id}`, projectId: r.project_id });
      if (r.released_at && r.released_at >= from && r.released_at < to) add('deliverable', r.released_at, `"${r.title}" released to the client (${r.code})`, { link: pLink(r.project_id), severity: 'good', ref: `deliverable:${r.id}:released`, projectId: r.project_id });
    }
    for (const r of db.all(`SELECT t.*, w.project_id, p.code, i.ref AS inquiry_ref FROM workflow_transitions t JOIN workflows w ON w.id = t.workflow_id
        LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN inquiries i ON i.id = w.inquiry_id WHERE t.created_at >= ? AND t.created_at < ? ORDER BY t.id`, from, to)) {
      const label = (app.orchestrator.STATES[r.to_state] || {}).label || r.to_state;
      add('stage', r.created_at, `${r.code || r.inquiry_ref} moved to ${label}`, { link: pLink(r.project_id), ref: `transition:${r.id}`, projectId: r.project_id });
    }
    for (const r of db.all(`SELECT j.*, p.code FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE j.status = 'failed' AND j.finished_at >= ? AND j.finished_at < ?`, from, to)) {
      add('failure', r.finished_at, `Agent task failed: ${r.agent}.${r.action}${r.code ? ` for ${r.code}` : ''} — ${String(r.error || '').slice(0, 140)}`, { link: '/command/agents', severity: 'urgent', ref: `job:${r.id}`, projectId: r.project_id });
    }
    for (const r of db.all('SELECT c.*, p.code FROM costs c JOIN projects p ON p.id = c.project_id WHERE c.created_at >= ? AND c.created_at < ?', from, to)) {
      add('cost', r.created_at, `Cost recorded on ${r.code}: ${money(r.amount_cents)} — ${r.description}`, { link: pLink(r.project_id), ref: `cost:${r.id}`, projectId: r.project_id });
    }
    for (const r of db.all("SELECT m.*, p.code FROM messages m LEFT JOIN projects p ON p.id = m.project_id WHERE m.sent_at >= ? AND m.sent_at < ? AND m.status = 'sent'", from, to)) {
      add('message', r.sent_at, `Message "${r.subject}" to the ${r.recipient_type}${r.code ? ` (${r.code})` : ''} ${r.channel === 'simulated' ? 'recorded as sent (SIMULATED — nothing was delivered)' : 'marked as sent'}`, { link: pLink(r.project_id), ref: `message:${r.id}`, projectId: r.project_id });
    }

    facts.sort((a, b) => (a.at < b.at ? -1 : 1));
    const windowFacts = facts.slice(-limit);

    // The state right now (not events): what is waiting, blocked, late or over budget.
    const state = [];
    const st = (text, opts) => state.push({ kind: 'state', at: to, text, link: '', severity: 'info', ref: '', projectId: null, ...opts });
    const metrics = app.command.metrics;
    const approvals = metrics.approvalsCount();
    st(approvals ? `${approvals} item(s) waiting for your approval` : 'Nothing is waiting for your approval', { link: '/command/approvals', severity: approvals ? 'attention' : 'info', ref: 'state:approvals' });
    for (const c of metrics.health().checks.filter((c) => c.status !== 'ok')) st(`${c.label}: ${c.detail}`, { link: c.link, severity: c.status === 'act' ? 'urgent' : 'attention', ref: `state:${c.id}` });
    const counts = metrics.projectCounts();
    st(`${counts.inProduction} project(s) in production, ${counts.awaitingDeposit} awaiting deposit, ${counts.scoping} in scoping`, { link: '/command/projects', ref: 'state:projects' });

    return [...windowFacts, ...state].map((f, i) => ({ id: `F${i + 1}`, ...f }));
  }

  return { collect };
}

module.exports = { createFacts };
