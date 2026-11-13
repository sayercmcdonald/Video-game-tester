'use strict';
const { TECHNICAL_TYPES } = require('../agents/policies');
const catalog = require('../services/catalog');

/**
 * Project lifecycle workflow: one per project inquiry, with explicit persisted states.
 *
 * advance() is deterministic and idempotent. It re-reads the database, checks whether the
 * current state's exit condition holds, and if so moves on; otherwise it makes sure the
 * jobs this state needs exist (by idempotency key). Events, finished jobs and the periodic
 * sweep all just call advance(), so duplicate or missed events cannot cause double work or
 * stalls. Every gate (quote sent, deposit verified, approvals, final payment) is read from
 * records written by the existing services — never from an agent's output.
 */
const STATES = {
  triage: { label: 'Triage', waiting: 'Sales agent is analysing the inquiry' },
  needs_review: { label: 'Needs review', waiting: 'Staff: decide whether to pursue this lead', human: true },
  scoping: { label: 'Scoping', waiting: 'Sales agent is drafting the brief and quote' },
  awaiting_quote_approval: { label: 'Quote approval', waiting: 'Staff: review, approve and send the quote', human: true },
  awaiting_client_acceptance: { label: 'Client decision', waiting: 'Client: accept the quote in the portal' },
  quote_declined: { label: 'Quote declined', waiting: 'Staff: revise the quote or close the lead', human: true },
  awaiting_deposit: { label: 'Deposit', waiting: 'Client: pay the deposit (confirmed only by verified payment)' },
  setup: { label: 'Project setup', waiting: 'Agents are planning and routing production' },
  in_production: { label: 'Production', waiting: 'Production, QA and staff review of deliverables' },
  awaiting_final_payment: { label: 'Final payment', waiting: 'Staff: issue the final invoice · Client: pay it' },
  ready_for_release: { label: 'Ready for release', waiting: 'Staff: release approved final files', human: true },
  completing: { label: 'Completing', waiting: 'Agents are recording the summary and performance' },
  completed: { label: 'Completed', terminal: true },
  cancelled: { label: 'Cancelled', terminal: true },
  lost: { label: 'Lost', terminal: true },
};
const PRE_DEPOSIT = new Set(['triage', 'needs_review', 'scoping', 'awaiting_quote_approval', 'awaiting_client_acceptance', 'quote_declined', 'awaiting_deposit']);
const today = (ms) => new Date(ms).toISOString().slice(0, 10);

function createWorkflowEngine(app, { queue, clock }) {
  const { db } = app;
  const iso = () => new Date(clock()).toISOString();
  const get = (id) => db.get('SELECT * FROM workflows WHERE id = ?', id);

  function transition(wf, to, reason, actor = 'system') {
    db.tx(() => {
      db.run('UPDATE workflows SET state = ?, updated_at = ?, completed_at = ? WHERE id = ?', to, iso(), STATES[to].terminal ? iso() : null, wf.id);
      db.insert('workflow_transitions', { workflow_id: wf.id, from_state: wf.state, to_state: to, reason, actor, created_at: iso() });
    });
    app.audit.log(actor, 'workflow.transition', { entity: 'workflow', entityId: wf.id, projectId: wf.project_id, detail: `${wf.state} → ${to}: ${reason}` });
  }

  const ensure = (wf, agent, action, input, { suffix = '', dependsOn = [], runAt = null, priority = 0 } = {}) => queue.ensure({
    key: `wf${wf.id}:${agent}.${action}${suffix ? `:${suffix}` : ''}`, agent, action, input,
    workflowId: wf.id, projectId: wf.project_id, inquiryId: wf.inquiry_id, dependsOn, runAt, priority,
  });
  // A cancelled job means a person chose to handle that step themselves.
  const done = (...jobs) => jobs.every((j) => j.status === 'succeeded' || j.status === 'cancelled');

  // ── Facts read from the system of record ──────────────────────────────
  function facts(wf) {
    const project = wf.project_id ? app.projects.get(wf.project_id) : null;
    const inquiry = wf.inquiry_id ? app.intake.get(wf.inquiry_id) : null;
    const quotes = project ? app.quotes.forProject(project.id) : [];
    const deliverables = project ? app.projects.deliverables(project.id) : [];
    const finals = deliverables.filter((d) => d.stage === 'final');
    return {
      project, inquiry, quotes, deliverables, finals,
      productionTasks: project ? app.projects.productionTasks(project.id) : [],
      latestQuote: quotes[0] || null,
      quoteSentOrBeyond: quotes.some((q) => ['sent', 'accepted'].includes(q.status)),
      quoteAccepted: quotes.some((q) => q.status === 'accepted'),
      allFinalApproved: finals.length > 0 && finals.every((d) => ['approved', 'released'].includes(d.status)),
      allFinalReleased: finals.length > 0 && finals.every((d) => d.status === 'released'),
    };
  }
  const task = (wf, args) => app.humanTasks.create({ workflowId: wf.id, projectId: wf.project_id, inquiryId: wf.inquiry_id, createdBy: 'system:orchestrator', ...args });
  const reviewers = () => db.all('SELECT name FROM users WHERE technical_reviewer = 1 ORDER BY name').map((u) => u.name);

  /** Every production task has a signed-off or approved result, and nothing is still open. */
  function productionComplete(wf, f) {
    if (!f.allFinalApproved) return false;
    const pid = wf.project_id;
    const open = (sql, ...p) => db.get(sql, ...p).n > 0;
    if (open("SELECT COUNT(*) AS n FROM integration_jobs WHERE project_id = ? AND status IN ('needs_human','queued','running')", pid)) return false;
    if (open("SELECT COUNT(*) AS n FROM revisions WHERE project_id = ? AND status = 'open'", pid)) return false;
    if (open("SELECT COUNT(*) AS n FROM human_tasks WHERE workflow_id = ? AND kind = 'production' AND status = 'open'", wf.id)) return false;
    if (open(`SELECT COUNT(*) AS n FROM assignments WHERE project_id = ? AND status IN (${app.assignments.OPEN.map(() => '?').join(',')})`, pid, ...app.assignments.OPEN)) return false;
    return f.productionTasks.every((t) => t.status === 'done' || f.deliverables.some((d) => d.task_id === t.id && ['approved', 'released'].includes(d.status)));
  }

  function qaSummary(job) {
    const o = job.output || {};
    const missing = (o.missing_information || []).length ? `\nMissing: ${o.missing_information.join('; ')}` : '';
    return `QA ${o.result || 'n/a'} — ${o.failed || 0} failed, ${o.warnings || 0} warning(s).${missing}`;
  }

  /** Jobs and human tasks that production needs, derived afresh from the records each time. */
  function ensureProductionWork(wf, f) {
    const pid = wf.project_id;
    const input = { project_id: pid };
    // Production tasks added after setup (by staff) get briefed and routed too.
    const unrouted = f.productionTasks.filter((t) => !t.route);
    if (unrouted.length) ensure(wf, 'production', 'prepare', input, { suffix: `t${Math.max(...unrouted.map((t) => t.id))}` });

    for (const t of f.productionTasks) {
      if (t.route === 'contractor' && t.status !== 'done') {
        const openA = app.assignments.openForTask(t.id);
        if (!openA && !app.assignments.signedOffForTask(t.id)) {
          const closed = app.assignments.closedForTask(t.id).length;
          if (closed >= 3) {
            task(wf, { kind: 'production', key: `assign_manually:t${t.id}`, title: `Assign "${t.title}" by hand`, detail: 'Three recommendations were declined or rejected. Choose a contractor or route the task to the studio.', link: `/admin/projects/${pid}#production` });
          } else {
            ensure(wf, 'talent', 'recommend', { project_id: pid, task_id: t.id }, { suffix: `t${t.id}:a${closed + 1}` });
          }
        } else if (openA && openA.status === 'recommended') {
          const c = app.contractors.get(openA.contractor_id);
          task(wf, {
            kind: 'approval', key: `approve_assignment:a${openA.id}`, link: `/admin/projects/${pid}#production`,
            title: `Approve assignment: ${c ? c.name : 'contractor'} for "${t.title}" — $${(openA.fee_cents / 100).toFixed(2)}`,
            detail: `${openA.estimated_hours} h at the contractor's approved rate. ${openA.rationale}\nApproving offers the work and sends the offer message.`,
          });
        }
      }
      if (t.route === 'studio' && t.status !== 'done') {
        task(wf, { kind: 'production', key: `studio:t${t.id}`, title: `Produce "${t.title}" in the studio`, detail: 'Routed to the studio. Upload the result as this task\'s deliverable.', link: `/admin/projects/${pid}#production` });
      }
    }

    for (const d of f.deliverables) {
      if (!d.file_id || d.version < 1) continue;
      const qa = ensure(wf, 'qa', 'check', { project_id: pid, deliverable_id: d.id, version: d.version }, { suffix: `d${d.id}:v${d.version}`, priority: 5 });
      if (done(qa) && d.status === 'in_review') {
        task(wf, {
          kind: 'review', key: `review:d${d.id}:v${d.version}`, link: `/admin/projects/${pid}#deliverables`,
          title: `${TECHNICAL_TYPES.has(d.type) ? 'Technical sign-off' : 'Review'}: ${d.title} v${d.version}${qa.output && qa.output.result === 'fail' ? ' — QA failed' : ''}`,
          detail: `${qaSummary(qa)}\n${TECHNICAL_TYPES.has(d.type) ? `Qualified reviewers: ${reviewers().join(', ') || 'none — mark a member of staff as a technical reviewer'}.` : ''}`,
        });
      }
    }
    for (const ij of db.all("SELECT * FROM integration_jobs WHERE project_id = ? AND mode = 'api' AND status IN ('queued','running')", pid)) {
      ensure(wf, 'production', 'poll', { project_id: pid, integration_job_id: ij.id }, { suffix: `ij${ij.id}` });
    }
    ensure(wf, 'project_manager', 'check_deadlines', { project_id: pid, date: today(clock()) }, { suffix: today(clock()), priority: -1 });
  }

  /** Decide the next state, or null to stay. Never performs a client- or contractor-facing action. */
  function step(wf) {
    const f = facts(wf);
    if (f.project && f.project.status === 'cancelled') return ['cancelled', 'Project cancelled by staff'];
    if (f.inquiry && ['lost', 'archived'].includes(f.inquiry.status) && PRE_DEPOSIT.has(wf.state) && !f.quoteAccepted) return ['lost', `Lead marked ${f.inquiry.status} by staff`];

    switch (wf.state) {
      case 'triage': {
        const job = ensure(wf, 'sales', 'qualify', { inquiry_id: wf.inquiry_id });
        if (!done(job)) return null;
        if (job.status === 'cancelled') return ['needs_review', 'Triage skipped by staff'];
        return job.output.qualified ? ['scoping', 'Lead qualified'] : ['needs_review', 'Sales Agent did not qualify the lead'];
      }
      case 'needs_review':
        task(wf, { kind: 'review', key: 'review_lead', title: `Decide whether to pursue ${f.inquiry.ref}`, detail: 'The Sales Agent did not qualify this lead. Pursue it from the workflow page, or mark the lead lost.', link: `/admin/leads/${wf.inquiry_id}` });
        return null;
      case 'scoping': {
        if (!f.project) {
          // Deterministic, internal: create the client and project records from the inquiry.
          const project = app.projects.createFromInquiry(f.inquiry, 'system:orchestrator');
          db.run('UPDATE workflows SET project_id = ?, updated_at = ? WHERE id = ?', project.id, iso(), wf.id);
          wf.project_id = project.id;
        }
        if (f.quoteSentOrBeyond) return ['awaiting_quote_approval', 'A quote was already sent by staff'];
        const job = ensure(wf, 'sales', 'draft_proposal', { project_id: wf.project_id });
        return done(job) ? ['awaiting_quote_approval', 'Brief and quote drafted'] : null;
      }
      case 'awaiting_quote_approval': {
        if (f.quoteSentOrBeyond) return ['awaiting_client_acceptance', 'Quote approved and sent by staff'];
        const draft = f.quotes.find((q) => q.status === 'draft');
        if (draft) {
          // Flags are worked out here, deterministically, as well as taken from the agent.
          const pkg = catalog.packageById(f.project.package);
          const job = queue.byKey(`wf${wf.id}:sales.draft_proposal`);
          const flags = [
            ...(pkg && draft.total_cents < pkg.fromCents ? [`Total $${draft.total_cents / 100} is below the ${pkg.name} starting price of $${pkg.fromCents / 100}.`] : []),
            ...((f.inquiry && f.inquiry.triage && f.inquiry.triage.risk_flags) || []),
            ...((job && job.output && job.output.flags) || []),
          ];
          task(wf, { kind: 'approval', key: 'approve_quote', link: `/admin/projects/${wf.project_id}#quote`, title: `Review and approve the quote for ${f.project.code}${flags.length ? ` — ${flags.length} flag${flags.length > 1 ? 's' : ''}` : ''}`, detail: flags.length ? flags.join('\n') : 'No flags raised. Check scope, pricing and terms before approving.' });
        } else {
          task(wf, { kind: 'approval', key: 'write_quote', link: `/admin/projects/${wf.project_id}#quote`, title: `Write the quote for ${f.project.code}`, detail: 'No draft quote exists.' });
        }
        return null;
      }
      case 'awaiting_client_acceptance': {
        if (f.quoteAccepted) return ['awaiting_deposit', 'Client accepted the quote'];
        const sent = f.quotes.find((q) => q.status === 'sent');
        if (sent) {
          ensure(wf, 'client_success', 'quote_notice', { project_id: wf.project_id }, { suffix: `q${sent.id}` });
          const client = app.projects.getClient(f.project.client_id);
          if (!client.portal_key_hash) task(wf, { kind: 'communication', key: `portal_key:c${client.id}`, title: `Issue portal access for ${client.brand_name}`, detail: 'The client needs a portal access key to read and accept the quote. Issue it on the project page and send it to them securely.', link: `/admin/projects/${wf.project_id}` });
          return null;
        }
        if (f.latestQuote && f.latestQuote.status === 'declined') return ['quote_declined', 'Client declined the quote'];
        return null;
      }
      case 'quote_declined':
        if (f.quoteAccepted) return ['awaiting_deposit', 'Client accepted a revised quote'];
        if (f.quotes.some((q) => q.status === 'sent')) return ['awaiting_client_acceptance', 'Revised quote sent by staff'];
        task(wf, { kind: 'review', key: 'quote_declined', title: `Quote declined for ${f.project.code}`, detail: 'Draft and send a revised quote, or mark the lead lost.', link: `/admin/projects/${wf.project_id}#quote` });
        return null;
      case 'awaiting_deposit': {
        ensure(wf, 'orchestrator', 'verify_deposit_invoice', { project_id: wf.project_id });
        // Verified = deposit invoice paid with a recorded successful payment of the exact amount,
        // and the project unlocked by the billing service. An event or agent claim is not enough.
        return app.billing.depositVerified(wf.project_id) ? ['setup', 'Deposit payment verified'] : null;
      }
      case 'setup': {
        if (!app.billing.depositVerified(wf.project_id)) return null;
        const input = { project_id: wf.project_id };
        const plan = ensure(wf, 'project_manager', 'plan', input, { priority: 10 });
        const prep = ensure(wf, 'production', 'prepare', input, { dependsOn: [plan.id] });
        const kick = ensure(wf, 'client_success', 'kickoff_update', input, { dependsOn: [plan.id] });
        if (plan.status === 'succeeded' && plan.output.proposed_due_date && !f.project.due_date) {
          task(wf, { kind: 'approval', key: 'confirm_due_date', title: `Confirm a target delivery date for ${f.project.code}`, detail: `The Project Manager Agent proposes ${plan.output.proposed_due_date}. Set it on the project if you agree; it becomes visible to the client.`, link: `/admin/projects/${wf.project_id}` });
        }
        return done(plan, prep, kick) ? ['in_production', 'Plan created, briefs written and production routed'] : null;
      }
      case 'in_production': {
        ensureProductionWork(wf, f);
        if (!productionComplete(wf, f)) return null;
        const invoice = ensure(wf, 'orchestrator', 'prepare_final_invoice', { project_id: wf.project_id });
        return done(invoice) ? ['awaiting_final_payment', 'All production signed off; final invoice drafted'] : null;
      }
      case 'awaiting_final_payment': {
        ensureProductionWork(wf, f);
        if (!f.allFinalApproved || !app.billing.finalPaymentVerified(wf.project_id)) return null;
        task(wf, { kind: 'approval', key: 'release', title: `Release ${f.finals.filter((d) => d.status === 'approved').length} approved file(s) for ${f.project.code}`, detail: 'Final payment is verified. Releasing makes the files downloadable in the client portal.', link: `/admin/projects/${wf.project_id}#deliverables` });
        return ['ready_for_release', 'Final payment verified'];
      }
      case 'ready_for_release': {
        if (!f.allFinalReleased) return null;
        if (f.project.status === 'active') app.projects.setStatus(f.project.id, 'delivered', 'system:orchestrator');
        return ['completing', 'All final files released by staff'];
      }
      case 'completing': {
        const input = { project_id: wf.project_id };
        const summary = ensure(wf, 'project_manager', 'completion_summary', input);
        const perf = ensure(wf, 'orchestrator', 'record_performance', input);
        if (!done(summary, perf)) return null;
        db.run('UPDATE workflows SET summary = ? WHERE id = ?', JSON.stringify({ ...(summary.output || {}), performance: perf.output }), wf.id);
        return ['completed', 'Completion summary recorded'];
      }
      default:
        return null;
    }
  }

  /** Close human tasks whose underlying work is visibly done. */
  function autoResolve(wf) {
    const f = facts(wf);
    const terminal = STATES[wf.state].terminal;
    const has = (sql, ...p) => Boolean(db.get(sql, ...p));
    for (const t of app.humanTasks.openForWorkflow(wf.id)) {
      const k = t.dedupe_key;
      let m;
      let resolved = false;
      if (terminal) resolved = true;
      else if (/:approve_quote$/.test(k)) resolved = f.quotes.some((q) => q.status !== 'draft');
      else if (/:write_quote$/.test(k)) resolved = f.quotes.length > 0;
      else if ((m = /approve_message:m(\d+)$/.exec(k))) resolved = !has("SELECT 1 FROM messages WHERE id = ? AND status = 'draft'", Number(m[1]));
      else if ((m = /publish_update:u(\d+)$/.exec(k))) resolved = !has("SELECT 1 FROM status_updates WHERE id = ? AND status = 'draft'", Number(m[1]));
      else if ((m = /review:d(\d+):v(\d+)$/.exec(k))) { const d = f.deliverables.find((x) => x.id === Number(m[1])); resolved = !d || ['approved', 'released'].includes(d.status) || d.version > Number(m[2]); }
      else if ((m = /approve_invoice:i(\d+)$/.exec(k))) resolved = !has("SELECT 1 FROM invoices WHERE id = ? AND status = 'draft'", Number(m[1]));
      else if ((m = /production:ij(\d+)$/.exec(k))) resolved = !has("SELECT 1 FROM integration_jobs WHERE id = ? AND status IN ('needs_human','queued','running')", Number(m[1]));
      else if ((m = /job_failed:j(\d+)$/.exec(k))) resolved = !has("SELECT 1 FROM jobs WHERE id = ? AND status = 'failed'", Number(m[1]));
      else if ((m = /overdue:t(\d+):(.+)$/.exec(k))) resolved = !has("SELECT 1 FROM tasks WHERE id = ? AND status != 'done' AND due_date = ?", Number(m[1]), m[2]);
      else if ((m = /approve_assignment:a(\d+)$/.exec(k))) resolved = !has("SELECT 1 FROM assignments WHERE id = ? AND status = 'recommended'", Number(m[1]));
      else if ((m = /studio:t(\d+)$/.exec(k))) resolved = has("SELECT 1 FROM tasks WHERE id = ? AND (status = 'done' OR route != 'studio')", Number(m[1]));
      else if ((m = /(?:find_contractor|assign_manually):t(\d+)$/.exec(k))) resolved = has("SELECT 1 FROM tasks t WHERE t.id = ? AND (t.status = 'done' OR t.route != 'contractor' OR EXISTS (SELECT 1 FROM assignments a WHERE a.task_id = t.id AND a.status NOT IN ('rejected','declined','cancelled')))", Number(m[1]));
      else if ((m = /portal_key:c(\d+)$/.exec(k))) resolved = has('SELECT 1 FROM clients WHERE id = ? AND portal_key_hash IS NOT NULL', Number(m[1]));
      else if (/:review_lead$/.test(k)) resolved = wf.state !== 'needs_review';
      else if (/:quote_declined$/.test(k)) resolved = wf.state !== 'quote_declined';
      else if (/:release$/.test(k)) resolved = f.allFinalReleased;
      else if (/:confirm_due_date$/.test(k)) resolved = Boolean(f.project && f.project.due_date);
      else if (/deposit_mismatch$/.test(k)) resolved = Boolean(wf.project_id && app.billing.depositVerified(wf.project_id));
      if (resolved) app.humanTasks.resolve(t.id, 'system:auto', terminal && wf.state !== 'completed' ? 'dismissed' : 'done');
    }
  }

  /** Failed jobs block a workflow until a person retries or cancels them. */
  function updateBlocked(wf) {
    const failed = db.all("SELECT * FROM jobs WHERE workflow_id = ? AND status = 'failed' ORDER BY id", wf.id);
    for (const j of failed) {
      task(wf, { kind: 'escalation', key: `job_failed:j${j.id}`, title: `${j.agent}.${j.action} failed — retry or handle by hand`, detail: j.error || '', link: `/admin/ops/workflows/${wf.id}` });
    }
    const reason = failed.length ? `${failed[0].agent}.${failed[0].action} failed: ${failed[0].error}`.slice(0, 500) : null;
    if ((wf.blocked_reason || null) !== reason) db.run('UPDATE workflows SET blocked_reason = ?, updated_at = ? WHERE id = ?', reason, iso(), wf.id);
  }

  return {
    STATES,
    get,
    findFor(event) {
      if (event.inquiry_id) { const w = db.get('SELECT * FROM workflows WHERE inquiry_id = ?', event.inquiry_id); if (w) return w; }
      if (event.project_id) return db.get('SELECT * FROM workflows WHERE project_id = ?', event.project_id);
      return null;
    },
    /** Create the workflow for a new project inquiry (once). */
    start(inquiryId) {
      const inquiry = app.intake.get(inquiryId);
      if (!inquiry || inquiry.kind !== 'project') return null;
      const existing = db.get('SELECT * FROM workflows WHERE inquiry_id = ?', inquiryId);
      if (existing) return existing;
      const id = db.tx(() => {
        const wfId = db.insertIgnore('workflows', { type: 'project_lifecycle', version: 1, inquiry_id: inquiryId, state: 'triage', created_at: iso(), updated_at: iso() });
        if (wfId) db.insert('workflow_transitions', { workflow_id: wfId, from_state: null, to_state: 'triage', reason: `Inquiry ${inquiry.ref} received`, created_at: iso() });
        return wfId;
      });
      return id ? get(id) : db.get('SELECT * FROM workflows WHERE inquiry_id = ?', inquiryId);
    },
    advance(id) {
      let wf = get(id);
      if (!wf || wf.paused) return wf;
      for (let i = 0; i < 20 && !STATES[wf.state].terminal; i++) {
        const next = step(wf);
        if (!next) break;
        transition(wf, next[0], next[1]);
        wf = get(id);
      }
      if (STATES[wf.state].terminal) queue.cancelOpenForWorkflow(wf.id);
      updateBlocked(wf);
      autoResolve(get(id));
      return get(id);
    },
    active: () => db.all("SELECT * FROM workflows WHERE state NOT IN ('completed','cancelled','lost') ORDER BY id"),
    pause(id, actor) {
      db.run('UPDATE workflows SET paused = 1, updated_at = ? WHERE id = ?', iso(), id);
      app.audit.log(actor, 'workflow.paused', { entity: 'workflow', entityId: id, projectId: (get(id) || {}).project_id });
    },
    resume(id, actor) {
      db.run('UPDATE workflows SET paused = 0, updated_at = ? WHERE id = ?', iso(), id);
      app.audit.log(actor, 'workflow.resumed', { entity: 'workflow', entityId: id, projectId: (get(id) || {}).project_id });
    },
    /** Staff decision on a lead triage flagged: pursue it after all. */
    continueReview(id, actor) {
      const wf = get(id);
      if (!wf || wf.state !== 'needs_review') return false;
      transition(wf, 'scoping', 'Staff chose to pursue the lead', actor);
      return true;
    },
  };
}

module.exports = { createWorkflowEngine, STATES };
