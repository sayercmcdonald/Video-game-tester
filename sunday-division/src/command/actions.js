'use strict';
const { sha256, verifyPassword } = require('../lib/crypto');
const { validate, S } = require('../lib/schema');
const { HttpError, money, str, now } = require('../lib/util');

const VERIFY_MS = 12 * 3600e3; // high-risk confirmations need a password entered within this window
const EXPIRES_MS = 24 * 3600e3;

/**
 * Every change made from Sunday Division Command — from Approvals, Command Chat, the
 * Morning Brief or Settings — is an action from this registry:
 *
 *   propose → the application (never a model) loads the records involved and builds the
 *             preview; the preview's records are fingerprinted into a digest
 *   confirm → the founder confirms with that digest; the records are loaded again and if
 *             anything changed the action expires instead of running; high-risk actions
 *             also need a recent password
 *   execute → the same service functions the studio dashboard uses, as the founder, audited
 *
 * risk 'high' = creates a financial obligation, sends an external communication, changes
 * access or agent permissions, or releases / signs off technical deliverables.
 */
const quoteState = (app, id) => {
  const q = app.quotes.get(id);
  if (!q) throw new HttpError(404, 'Quote not found.');
  const p = app.projects.mustGet(q.project_id);
  const client = app.projects.getClient(p.client_id);
  return { quote: { id: q.id, status: q.status, version: q.version, scope: q.scope, line_items: q.line_items, total_cents: q.total_cents, deposit_percent: q.deposit_percent, deposit_cents: q.deposit_cents, valid_until: q.valid_until, source: q.source }, project: { id: p.id, code: p.code, name: p.name, status: p.status }, brand: client ? client.brand_name : '' };
};
const assignmentState = (app, id) => {
  const a = app.assignments.mustGet(id);
  const c = app.contractors.get(a.contractor_id);
  const t = app.db.get('SELECT id, title, job_type FROM tasks WHERE id = ?', a.task_id);
  const p = app.projects.mustGet(a.project_id);
  return { assignment: { id: a.id, status: a.status, hours: a.estimated_hours, fee_cents: a.fee_cents, due_date: a.due_date, rationale: a.rationale, recommended_by: a.recommended_by }, contractor: c ? { id: c.id, name: c.name, status: c.status, rate_cents: c.hourly_rate_cents } : null, task: t, project: { id: p.id, code: p.code, name: p.name } };
};
const deliverableState = (app, id) => {
  const d = app.projects.getDeliverable(id);
  if (!d) throw new HttpError(404, 'Deliverable not found.');
  const p = app.projects.mustGet(d.project_id);
  const qa = app.db.get('SELECT result, checks FROM deliverable_qa WHERE deliverable_id = ? AND version = ? ORDER BY id DESC', d.id, d.version);
  const a = app.db.get("SELECT a.id, a.fee_cents, a.status, c.name FROM assignments a JOIN contractors c ON c.id = a.contractor_id WHERE a.id = (SELECT assignment_id FROM deliverables WHERE id = ?)", d.id);
  return { deliverable: { id: d.id, title: d.title, type: d.type, stage: d.stage, status: d.status, version: d.version, file_id: d.file_id }, qa: qa ? { result: qa.result, checks: JSON.parse(qa.checks || '[]') } : null, assignment: a || null, project: { id: p.id, code: p.code, name: p.name }, balance_cents: app.billing.balanceDue(p.id) };
};

const ACTIONS = {
  send_quote: {
    label: 'Approve & send quote', risk: 'high', why: 'Financial commitment and client communication',
    params: S.obj({ quote_id: S.int(1) }),
    load: (app, p) => quoteState(app, p.quote_id),
    check(s) {
      if (s.quote.status !== 'draft') throw new HttpError(409, 'This quote has already been sent or replaced.');
      if (s.project.status !== 'scoping') throw new HttpError(409, 'Quotes can only be sent while the project is in scoping.');
    },
    preview: (s) => ({
      title: `Send quote v${s.quote.version} to ${s.brand || s.project.name}`,
      rows: [['Project', `${s.project.code} — ${s.project.name}`], ['Total', money(s.quote.total_cents)], ['Deposit', `${money(s.quote.deposit_cents)} (${s.quote.deposit_percent}%)`], ['Valid until', s.quote.valid_until || 'No expiry'], ['Drafted by', s.quote.source === 'manual' ? 'Staff' : `Automation (${s.quote.source})`]],
      items: s.quote.line_items.map((li) => `${li.description} — ${li.quantity} × ${money(li.unit_cents)}`),
      text: s.quote.scope,
      effects: ['The quote becomes visible to the client in their portal.', `If the client accepts, a deposit invoice for ${money(s.quote.deposit_cents)} opens automatically.`, 'Send the client their portal link if they do not have it.'],
    }),
    execute(app, p, user) { app.quotes.approveAndSend(p.quote_id, user); const s = quoteState(app, p.quote_id); return { message: `Quote sent to ${s.brand || 'the client'}.`, link: `/command/projects/${s.project.id}` }; },
  },

  approve_assignment: {
    label: 'Approve assignment & send offer', risk: 'high', why: 'Financial obligation and contractor communication',
    params: S.obj({ assignment_id: S.int(1) }),
    load: (app, p) => assignmentState(app, p.assignment_id),
    check(s) {
      if (s.assignment.status !== 'recommended') throw new HttpError(409, 'This recommendation has already been decided.');
      if (!s.contractor || s.contractor.status !== 'approved') throw new HttpError(409, 'This contractor is no longer approved.');
    },
    preview: (s, app) => ({
      title: `Offer "${s.task.title}" to ${s.contractor.name}`,
      rows: [['Project', `${s.project.code} — ${s.project.name}`], ['Contractor', `${s.contractor.name} (approved, ${money(s.contractor.rate_cents)}/h)`], ['Estimate', `${s.assignment.hours} h`], ['Fee', money(s.assignment.fee_cents)], ['Due', s.assignment.due_date || 'Not set'], ['Recommended by', s.assignment.recommended_by]],
      text: s.assignment.rationale,
      effects: [`Commits the studio to a fee of ${money(s.assignment.fee_cents)} if the work is signed off.`, app.messaging.provider === 'simulated' ? 'Sends the offer message — SIMULATED in this environment: nothing leaves the server.' : 'Prepares the offer message for you to send (manual delivery).', 'The contractor accepts or declines in their portal.'],
    }),
    execute(app, p, user) {
      const r = app.assignments.approve(p.assignment_id, user, {});
      const s = assignmentState(app, p.assignment_id);
      return { message: r.delivery === 'simulated' ? `Offer recorded as sent to ${s.contractor.name} (SIMULATED — nothing left the server).` : `Assignment approved. Send the offer to ${s.contractor.name} from the Messages outbox.`, link: `/command/projects/${s.project.id}` };
    },
  },

  reject_assignment: {
    label: 'Reject recommendation', risk: 'low', why: 'Internal decision; the Talent Agent suggests someone else',
    params: S.obj({ assignment_id: S.int(1), note: S.str(500) }, ['note']),
    load: (app, p) => assignmentState(app, p.assignment_id),
    check(s) { if (s.assignment.status !== 'recommended') throw new HttpError(409, 'This recommendation has already been decided.'); },
    preview: (s) => ({ title: `Reject ${s.contractor ? s.contractor.name : 'contractor'} for "${s.task.title}"`, rows: [['Project', s.project.code], ['Fee proposed', money(s.assignment.fee_cents)]], effects: ['Nothing is sent to the contractor.', 'The Talent Agent will recommend someone else (up to three times).'] }),
    execute(app, p, user) { app.assignments.reject(p.assignment_id, user, p.note || 'Rejected from Command'); const s = assignmentState(app, p.assignment_id); return { message: 'Recommendation rejected.', link: `/command/projects/${s.project.id}` }; },
  },

  send_message: {
    label: 'Approve & send message', risk: 'high', why: 'External communication',
    params: S.obj({ message_id: S.int(1) }),
    load(app, p) {
      const m = app.messaging.get(p.message_id);
      if (!m) throw new HttpError(404, 'Message not found.');
      const code = m.project_id ? (app.projects.get(m.project_id) || {}).code : '';
      return { message: { id: m.id, status: m.status, subject: m.subject, body: m.body, recipient_type: m.recipient_type, recipient_id: m.recipient_id, purpose: m.purpose, prepared_by: m.prepared_by }, code, provider: app.messaging.provider };
    },
    check(s) { if (s.message.status !== 'draft') throw new HttpError(409, 'Only draft messages can be sent.'); },
    preview: (s) => ({
      title: s.message.subject,
      rows: [['To', `The ${s.message.recipient_type}${s.code ? ` on ${s.code}` : ''}`], ['Purpose', s.message.purpose.replace(/_/g, ' ')], ['Prepared by', s.message.prepared_by]],
      text: s.message.body,
      effects: [s.provider === 'simulated' ? 'SIMULATED delivery in this environment: recorded as sent, nothing leaves the server.' : 'Approved for sending. Delivery is manual: send it from the Messages outbox and mark it sent.'],
    }),
    execute(app, p, user) { const how = app.messaging.approveAndSend(p.message_id, user); return { message: how === 'simulated' ? 'Message recorded as sent (SIMULATED — nothing left the server).' : 'Message approved. Send it yourself from the outbox, then mark it sent.', link: '/command/approvals' }; },
  },

  discard_message: {
    label: 'Discard message', risk: 'low', why: 'Nothing is sent',
    params: S.obj({ message_id: S.int(1) }),
    load: (app, p) => ACTIONS.send_message.load(app, p),
    check: (s) => ACTIONS.send_message.check(s),
    preview: (s) => ({ title: `Discard "${s.message.subject}"`, rows: [['To', `The ${s.message.recipient_type}`]], effects: ['The draft is discarded. Nothing is sent.'] }),
    execute(app, p, user) { app.messaging.discard(p.message_id, user); return { message: 'Draft discarded.', link: '/command/approvals' }; },
  },

  issue_invoice: {
    label: 'Issue invoice', risk: 'high', why: 'Financial obligation for the client',
    params: S.obj({ invoice_id: S.int(1) }),
    load(app, p) {
      const i = app.db.get('SELECT i.*, p.code, p.name, c.brand_name FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = p.client_id WHERE i.id = ?', p.invoice_id);
      if (!i) throw new HttpError(404, 'Invoice not found.');
      const money_ = app.projects.profitability(i.project_id);
      return { invoice: { id: i.id, number: i.number, kind: i.kind, status: i.status, amount_cents: i.amount_cents, description: i.description }, project: { id: i.project_id, code: i.code, name: i.name }, brand: i.brand_name, quoted: money_.quoted, invoiced: money_.invoiced };
    },
    check(s) { if (s.invoice.status !== 'draft') throw new HttpError(409, 'Only draft invoices can be issued.'); },
    preview: (s) => ({
      title: `Issue ${s.invoice.kind} invoice ${s.invoice.number} — ${money(s.invoice.amount_cents)}`,
      rows: [['Client', s.brand], ['Project', `${s.project.code} — ${s.project.name}`], ['Amount', money(s.invoice.amount_cents)], ['Quoted total', money(s.quoted)], ['Already invoiced', money(s.invoiced)]],
      text: s.invoice.description,
      effects: ['The invoice becomes payable in the client portal.', 'Payment is confirmed only by the payment provider’s signed webhook.'],
    }),
    execute(app, p, user) { const pid = app.billing.approve(p.invoice_id, user); return { message: 'Invoice issued.', link: `/command/projects/${pid}` }; },
  },

  sign_off_deliverable: {
    label: 'Technical sign-off', risk: 'high', why: 'Approves technical files; records the contractor fee',
    params: S.obj({ deliverable_id: S.int(1) }),
    load: (app, p) => deliverableState(app, p.deliverable_id),
    check(s) { if (s.deliverable.status !== 'in_review' || !s.deliverable.file_id) throw new HttpError(409, 'Only deliverables in review with a file can be signed off.'); },
    preview: (s) => ({
      title: `Sign off "${s.deliverable.title}" v${s.deliverable.version}`,
      rows: [['Project', `${s.project.code} — ${s.project.name}`], ['Type', s.deliverable.type], ['QA result', s.qa ? s.qa.result.toUpperCase() : 'No QA report'], ...(s.assignment ? [['Contractor', `${s.assignment.name} · fee ${money(s.assignment.fee_cents)}`]] : [])],
      items: s.qa ? s.qa.checks.map((c) => `${String(c.status || c.result || '').toUpperCase()} · ${c.name || c.check || ''}${c.note ? ` — ${c.note}` : ''}`) : [],
      effects: ['Marks the file approved by you as the technical reviewer.', ...(s.assignment ? [`Records the contractor fee of ${money(s.assignment.fee_cents)} as a project cost (paid outside the system).`] : []), 'The client does not see it until it is released.'],
      warnings: s.qa && s.qa.result !== 'pass' ? [`Automated QA returned ${s.qa.result.toUpperCase()}. Open the file in the studio dashboard before signing off.`] : [],
    }),
    execute(app, p, user) { const pid = app.projects.approveDeliverable(p.deliverable_id, user); return { message: 'Signed off.', link: `/command/projects/${pid}` }; },
  },

  release_deliverable: {
    label: 'Release to client', risk: 'high', why: 'Releases technical deliverables',
    params: S.obj({ deliverable_id: S.int(1) }),
    load: (app, p) => deliverableState(app, p.deliverable_id),
    check(s) {
      if (s.deliverable.status !== 'approved') throw new HttpError(409, 'Only signed-off deliverables can be released.');
      if (s.deliverable.stage === 'final' && s.balance_cents > 0) throw new HttpError(409, `Final files are held until the balance (${money(s.balance_cents)}) is paid.`);
    },
    preview: (s) => ({ title: `Release "${s.deliverable.title}" v${s.deliverable.version}`, rows: [['Project', `${s.project.code} — ${s.project.name}`], ['Stage', s.deliverable.stage], ['Balance due', money(s.balance_cents)]], effects: ['The client can download the file from their portal.'] }),
    execute(app, p, user) { const pid = app.projects.releaseDeliverable(p.deliverable_id, user); return { message: 'Released to the client.', link: `/command/projects/${pid}` }; },
  },

  resolve_exception: {
    label: 'Mark financial exception reviewed', risk: 'low', why: 'Records your review; no money moves',
    params: S.obj({ task_id: S.int(1), note: S.str(500) }),
    load(app, p) {
      const t = app.humanTasks.get(p.task_id);
      if (!t || !/payment_exception|deposit_mismatch/.test(t.dedupe_key)) throw new HttpError(404, 'Exception not found.');
      return { task: { id: t.id, status: t.status, title: t.title, detail: t.detail, project_id: t.project_id } };
    },
    check(s) { if (s.task.status !== 'open') throw new HttpError(409, 'Already resolved.'); },
    preview: (s, app, p) => ({ title: s.task.title, rows: [['Your note', p.note]], text: s.task.detail, effects: ['Closes the exception with your note. Refunds or corrections happen in the payment provider — this does not move money or change any invoice.'] }),
    execute(app, p, user) { app.humanTasks.resolve(p.task_id, `staff:${user.email}`); app.audit.log(`staff:${user.email}`, 'payment_exception.reviewed', { entity: 'human_task', entityId: p.task_id, detail: str(p.note, 300) }); return { message: 'Exception marked reviewed.', link: '/command/approvals' }; },
  },

  draft_quote: {
    label: 'Ask the Sales Agent for a quote draft', risk: 'low', why: 'Creates a draft only; sending is a separate approval',
    params: S.obj({ project_id: S.int(1) }),
    load(app, p) {
      const pr = app.projects.get(p.project_id);
      if (!pr) throw new HttpError(404, 'Project not found.');
      const wf = app.db.get('SELECT id, state FROM workflows WHERE project_id = ?', pr.id);
      const draft = app.db.get("SELECT id, version, total_cents FROM quotes WHERE project_id = ? AND status = 'draft'", pr.id);
      return { project: { id: pr.id, code: pr.code, name: pr.name, status: pr.status }, workflow: wf || null, existingDraft: draft || null };
    },
    check(s) { if (s.project.status !== 'scoping') throw new HttpError(409, `${s.project.code} is past scoping, so a new quote is not needed.`); },
    preview: (s) => ({ title: `Draft a quote for ${s.project.code}`, rows: [['Project', s.project.name], ['Existing draft', s.existingDraft ? `v${s.existingDraft.version}, ${money(s.existingDraft.total_cents)} (will be replaced)` : 'None']], effects: ['Queues the Sales Agent to draft the brief and quote.', 'Nothing is sent. The draft appears in Approvals for you to review.'] }),
    execute(app, p, user, actionId) {
      const s = ACTIONS.draft_quote.load(app, p);
      app.orchestrator.queue.ensure({ key: `cmd${actionId}:sales.draft_proposal`, agent: 'sales', action: 'draft_proposal', input: { project_id: s.project.id }, workflowId: s.workflow ? s.workflow.id : null, projectId: s.project.id, priority: 5 });
      return { message: 'The Sales Agent is drafting. The quote will appear in Approvals.', link: `/command/projects/${s.project.id}` };
    },
  },

  retry_task: {
    label: 'Retry failed agent task', risk: 'low', why: 'Runs the same task again under the same permissions',
    params: S.obj({ job_id: S.int(1) }),
    load(app, p) {
      const j = app.orchestrator.queue.get(p.job_id);
      if (!j) throw new HttpError(404, 'Task not found.');
      return { job: { id: j.id, agent: j.agent, action: j.action, status: j.status, error: j.error, attempts: j.attempts } };
    },
    check(s) { if (!['failed', 'cancelled'].includes(s.job.status)) throw new HttpError(409, 'Only failed or cancelled tasks can be retried.'); },
    preview: (s) => ({ title: `Retry ${s.job.agent}.${s.job.action}`, rows: [['Last error', s.job.error || '—'], ['Attempts so far', String(s.job.attempts)]], effects: ['The task runs again with the same tools and permissions. Effects it already made are replayed, not repeated.'] }),
    execute(app, p, user) { app.orchestrator.retryJob(p.job_id, user); return { message: 'Task queued to run again.', link: '/command/agents' }; },
  },

  generate_brief: {
    label: 'Generate a Morning Brief now', risk: 'low', why: 'Reads records; writes only the brief',
    params: S.obj({}),
    load: (app) => ({ today: app.command.metrics.today() }),
    check() {},
    preview: () => ({ title: 'Generate a new Morning Brief', rows: [], effects: ['Collects verified events since the last brief and summarises them. Uses the AI budget if a model provider is configured.'] }),
    execute(app, p, user) { app.command.brief.request({ manual: true, by: `staff:${user.email}` }); return { message: 'Generating your brief…', link: '/command/brief' }; },
  },

  update_settings: {
    label: 'Change settings', risk: 'high', why: 'Changes agent permissions, providers or budgets',
    params: S.obj({ changes: { type: 'object' } }),
    load(app, p) {
      const changes = p.changes && typeof p.changes === 'object' ? p.changes : {};
      const keys = Object.keys(changes);
      if (!keys.length || keys.length > 20) throw new HttpError(400, 'Nothing to change.');
      const diff = [];
      for (const k of keys) {
        const def = app.settings.DEFINITIONS[k];
        if (!def) throw new HttpError(400, 'Unknown setting.');
        const to = app.settings.normalise(k, changes[k]);
        const from = app.settings.get(k);
        if (String(from) !== String(to)) diff.push({ key: k, label: def.label, from, to, permission: Boolean(def.permission) });
      }
      if (changes.autonomous_production !== undefined && app.settings.normalise('autonomous_production', changes.autonomous_production) && !app.integrations.status().some((i) => i.connected)) {
        throw new HttpError(409, 'Connect INDEX V3 or FORM before switching on autonomous production.');
      }
      if (changes.ai_provider && !['auto', 'rules'].includes(changes.ai_provider)) {
        const a = app.providers.get(changes.ai_provider);
        if (!a || !a.configured()) throw new HttpError(409, `${a ? a.label : 'That provider'} is not configured: ${a ? a.missing() : ''}.`);
      }
      return { diff };
    },
    check(s) { if (!s.diff.length) throw new HttpError(409, 'Those settings are already in place.'); },
    preview: (s) => ({ title: 'Change settings', rows: s.diff.map((d) => [d.label, `${fmt(d.from)} → ${fmt(d.to)}`]), effects: ['Takes effect for new agent tasks immediately. Tasks already running finish under the settings they started with.', 'Recorded in the audit log.'] }),
    execute(app, p, user) { for (const [k, v] of Object.entries(p.changes)) app.settings.set(k, v, user); return { message: 'Settings changed.', link: '/command/settings' }; },
  },
};
const fmt = (v) => (v === true ? 'On' : v === false ? 'Off' : String(v));
/** Some actions are low risk only when they touch nothing sensitive. */
function riskOf(def, state) {
  if (def === ACTIONS.update_settings) return state.diff.some((d) => d.permission) ? 'high' : 'low';
  return def.risk;
}

function createActions(app) {
  const { db } = app;
  const nowMs = () => app.orchestrator.clock();
  const digestOf = (type, params, state) => sha256(JSON.stringify({ type, params, state }));
  const hydrate = (r) => (r ? { ...r, params: JSON.parse(r.params), preview: JSON.parse(r.preview), result: r.result ? JSON.parse(r.result) : null } : null);
  const get = (id) => hydrate(db.get('SELECT * FROM command_actions WHERE id = ?', id));

  function prepare(type, params) {
    const def = ACTIONS[type];
    if (!def) throw new HttpError(400, 'Unknown action.');
    const errors = validate(def.params, params);
    if (errors.length) throw new HttpError(400, `Invalid action: ${errors.slice(0, 3).join('; ')}`);
    const state = def.load(app, params);
    def.check(state);
    return { def, state };
  }

  return {
    ACTIONS, VERIFY_MS, get,
    /** Build the preview and store the proposal. Nothing changes yet. */
    propose(type, params, { source, by, conversationId = null }) {
      const { def, state } = prepare(type, params);
      const preview = { label: def.label, why: def.why, ...def.preview(state, app, params) };
      const id = db.insert('command_actions', {
        type, params: JSON.stringify(params), preview: JSON.stringify(preview), digest: digestOf(type, params, state), risk: riskOf(def, state),
        source, conversation_id: conversationId, proposed_by: by, created_at: new Date(nowMs()).toISOString(), expires_at: new Date(nowMs() + EXPIRES_MS).toISOString(),
      });
      return get(id);
    },
    /** True when the session's last password check is recent enough for high-risk actions. */
    recentlyVerified: (session) => Boolean(session && session.verified_at && Date.parse(session.verified_at) > nowMs() - VERIFY_MS),
    async confirm(id, { user, session, digest, password }) {
      const action = get(id);
      if (!action) throw new HttpError(404, 'Action not found.');
      if (action.status !== 'proposed') throw new HttpError(409, `This action was already ${action.status}.`);
      if (action.expires_at < new Date(nowMs()).toISOString()) {
        db.run("UPDATE command_actions SET status = 'expired' WHERE id = ?", id);
        throw new HttpError(409, 'This proposal expired. Review it again.');
      }
      if (!digest || digest !== action.digest) throw new HttpError(409, 'The confirmation does not match the preview you were shown.');
      if (action.risk === 'high' && !this.recentlyVerified(session)) {
        const row = db.get('SELECT password_hash FROM users WHERE id = ?', user.id);
        if (!password) throw Object.assign(new HttpError(401, 'Enter your password to confirm this action.'), { needsPassword: true });
        if (!app.rateLimit.take(`stepup:${user.id}`, 8, 15 * 60e3) || !verifyPassword(str(password, 500), row.password_hash)) {
          app.audit.log(`staff:${user.email}`, 'command.stepup_failed', { entity: 'command_action', entityId: id });
          throw Object.assign(new HttpError(401, 'That password is not right.'), { needsPassword: true });
        }
        app.sessions.markVerified(session);
      }
      // Re-read the records: if anything the preview showed has changed, do not act on it.
      let fresh;
      try { fresh = prepare(action.type, action.params); } catch (err) {
        db.run("UPDATE command_actions SET status = 'expired', error = ?, decided_at = ? WHERE id = ?", String(err.message).slice(0, 300), now(), id);
        throw new HttpError(409, `This can no longer be done: ${err.message}`);
      }
      if (digestOf(action.type, action.params, fresh.state) !== action.digest) {
        db.run("UPDATE command_actions SET status = 'expired', error = 'changed since preview', decided_at = ? WHERE id = ?", now(), id);
        throw new HttpError(409, 'Something changed since you reviewed this. Review the new version before confirming.');
      }
      // Claim the proposal first so a double tap cannot execute it twice.
      if (!db.run("UPDATE command_actions SET status = 'executed', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'proposed'", user.id, now(), id).changes) {
        throw new HttpError(409, 'This action is already being handled.');
      }
      try {
        const result = await fresh.def.execute(app, action.params, user, id);
        db.run('UPDATE command_actions SET result = ? WHERE id = ?', JSON.stringify(result), id);
        app.audit.log(`staff:${user.email}`, 'command.action_executed', { entity: 'command_action', entityId: id, detail: `${action.type} (${action.source}, ${action.risk} risk)` });
        return { ...get(id), result };
      } catch (err) {
        db.run("UPDATE command_actions SET status = 'failed', error = ? WHERE id = ?", String(err.message).slice(0, 500), id);
        app.audit.log(`staff:${user.email}`, 'command.action_failed', { entity: 'command_action', entityId: id, detail: `${action.type}: ${err.message}` });
        throw err;
      }
    },
    cancel(id, user) {
      const r = db.run("UPDATE command_actions SET status = 'cancelled', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'proposed'", user.id, now(), id);
      if (!r.changes) throw new HttpError(409, 'This action is no longer open.');
    },
    recent: (limit = 20) => db.all('SELECT * FROM command_actions ORDER BY id DESC LIMIT ?', limit).map(hydrate),
  };
}

module.exports = { createActions, ACTIONS };
