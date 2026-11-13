'use strict';
const { TECHNICAL_TYPES } = require('../agents/handlers');

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
      latestQuote: quotes[0] || null,
      quoteSentOrBeyond: quotes.some((q) => ['sent', 'accepted'].includes(q.status)),
      quoteAccepted: quotes.some((q) => q.status === 'accepted'),
      allFinalApproved: finals.length > 0 && finals.every((d) => ['approved', 'released'].includes(d.status)),
      allFinalReleased: finals.length > 0 && finals.every((d) => d.status === 'released'),
    };
  }
  function productionOpen(projectId, wfId) {
    const ij = db.get("SELECT COUNT(*) AS n FROM integration_jobs WHERE project_id = ? AND status IN ('needs_human','queued','running')", projectId).n;
    const revisions = db.get("SELECT COUNT(*) AS n FROM revisions WHERE project_id = ? AND status = 'open'", projectId).n;
    const studio = db.get("SELECT COUNT(*) AS n FROM human_tasks WHERE workflow_id = ? AND kind = 'production' AND status = 'open'", wfId).n;
    return ij + revisions + studio > 0;
  }

  function ensureProductionJobs(wf, f) {
    for (const d of f.deliverables) {
      if (!d.file_id || d.version < 1) continue;
      const agent = TECHNICAL_TYPES.has(d.type) ? 'technical_qa' : 'creative_qa';
      ensure(wf, agent, 'check', { project_id: wf.project_id, deliverable_id: d.id, version: d.version }, { suffix: `d${d.id}:v${d.version}`, priority: 5 });
    }
    for (const ij of db.all("SELECT * FROM integration_jobs WHERE project_id = ? AND mode = 'api' AND status IN ('queued','running')", wf.project_id)) {
      const agent = ij.product === 'index_v3' ? 'index_coordinator' : 'form_coordinator';
      ensure(wf, agent, 'poll', { project_id: wf.project_id, integration_job_id: ij.id }, { suffix: `ij${ij.id}` });
    }
    ensure(wf, 'project_manager', 'check_deadlines', { project_id: wf.project_id, date: today(clock()) }, { suffix: today(clock()), priority: -1 });
  }

  /** Decide the next state, or null to stay. Never performs a client-facing action. */
  function step(wf) {
    const f = facts(wf);
    if (f.project && f.project.status === 'cancelled') return ['cancelled', 'Project cancelled by staff'];
    if (f.inquiry && ['lost', 'archived'].includes(f.inquiry.status) && PRE_DEPOSIT.has(wf.state) && !f.quoteAccepted) return ['lost', `Lead marked ${f.inquiry.status} by staff`];

    switch (wf.state) {
      case 'triage': {
        const job = ensure(wf, 'sales_intake', 'triage', { inquiry_id: wf.inquiry_id });
        if (!done(job)) return null;
        if (job.status === 'cancelled') return ['needs_review', 'Triage skipped by staff'];
        return job.output.qualified ? ['scoping', 'Triage complete'] : ['needs_review', `Triage: ${job.output.qualification_note || 'not qualified'}`];
      }
      case 'needs_review':
        return null; // staff continue (→ scoping) or mark the lead lost
      case 'scoping': {
        if (!f.project) {
          // Deterministic, internal: create the client and project records from the inquiry.
          const project = app.projects.createFromInquiry(f.inquiry, 'agent:sales_intake');
          db.run('UPDATE workflows SET project_id = ?, updated_at = ? WHERE id = ?', project.id, iso(), wf.id);
          wf.project_id = project.id;
        }
        if (f.quoteSentOrBeyond) return ['awaiting_quote_approval', 'A quote was already sent by staff'];
        const job = ensure(wf, 'sales_intake', 'draft_proposal', { project_id: wf.project_id });
        return done(job) ? ['awaiting_quote_approval', 'Draft quote ready for staff review'] : null;
      }
      case 'awaiting_quote_approval':
        // The only way out is a person approving the quote (quotes.approveAndSend).
        return f.quoteSentOrBeyond ? ['awaiting_client_acceptance', 'Quote approved and sent by staff'] : null;
      case 'awaiting_client_acceptance': {
        if (f.quoteAccepted) return ['awaiting_deposit', 'Client accepted the quote'];
        const sent = f.quotes.find((q) => q.status === 'sent');
        if (sent) { ensure(wf, 'client_success', 'quote_notice', { project_id: wf.project_id }, { suffix: `q${sent.id}` }); return null; }
        if (f.latestQuote && f.latestQuote.status === 'declined') return ['quote_declined', 'Client declined the quote'];
        return null;
      }
      case 'quote_declined':
        if (f.quoteAccepted) return ['awaiting_deposit', 'Client accepted a revised quote'];
        if (f.quotes.some((q) => q.status === 'sent')) return ['awaiting_client_acceptance', 'Revised quote sent by staff'];
        app.humanTasks.create({ workflowId: wf.id, projectId: wf.project_id, kind: 'review', key: 'quote_declined', createdBy: 'system:workflow', title: `Quote declined for ${f.project.code}`, detail: 'Draft and send a revised quote, or mark the lead lost.', link: `/admin/projects/${wf.project_id}#quote` });
        return null;
      case 'awaiting_deposit': {
        ensure(wf, 'finance_ops', 'verify_deposit_invoice', { project_id: wf.project_id });
        // Verified = deposit invoice paid with a recorded successful payment of the exact amount,
        // and the project unlocked by the billing service. An event or agent claim is not enough.
        return app.billing.depositVerified(wf.project_id) ? ['setup', 'Deposit payment verified'] : null;
      }
      case 'setup': {
        if (!app.billing.depositVerified(wf.project_id)) return null;
        const input = { project_id: wf.project_id };
        const plan = ensure(wf, 'project_manager', 'plan', input, { priority: 10 });
        const after = { dependsOn: [plan.id] };
        const jobs = [
          plan,
          ensure(wf, 'index_coordinator', 'route', input, after),
          ensure(wf, 'form_coordinator', 'route', input, after),
          ensure(wf, 'client_success', 'kickoff_update', input, after),
        ];
        return done(...jobs) ? ['in_production', 'Plan created and production routed'] : null;
      }
      case 'in_production': {
        ensureProductionJobs(wf, f);
        if (!f.allFinalApproved || productionOpen(wf.project_id, wf.id)) return null;
        const invoice = ensure(wf, 'finance_ops', 'prepare_final_invoice', { project_id: wf.project_id });
        return done(invoice) ? ['awaiting_final_payment', 'All final deliverables approved; final invoice drafted'] : null;
      }
      case 'awaiting_final_payment': {
        ensureProductionJobs(wf, f);
        if (!f.allFinalApproved || !app.billing.finalPaymentVerified(wf.project_id)) return null;
        app.humanTasks.create({ workflowId: wf.id, projectId: wf.project_id, kind: 'approval', key: 'release', createdBy: 'system:workflow', title: `Release ${f.finals.filter((d) => d.status === 'approved').length} approved file(s) for ${f.project.code}`, detail: 'Final payment is verified. Releasing makes the files downloadable in the client portal.', link: `/admin/projects/${wf.project_id}#deliverables` });
        return ['ready_for_release', 'Final payment verified'];
      }
      case 'ready_for_release': {
        if (!f.allFinalReleased) return null;
        if (f.project.status === 'active') app.projects.setStatus(f.project.id, 'delivered', 'system:workflow');
        return ['completing', 'All final files released by staff'];
      }
      case 'completing': {
        const input = { project_id: wf.project_id };
        const summary = ensure(wf, 'project_manager', 'completion_summary', input);
        const perf = ensure(wf, 'finance_ops', 'record_performance', input);
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
    const prefix = `wf${wf.id}:`;
    for (const t of app.humanTasks.openForWorkflow(wf.id)) {
      const k = t.dedupe_key.startsWith(prefix) ? t.dedupe_key.slice(prefix.length) : t.dedupe_key;
      let m;
      let resolved = false;
      if (STATES[wf.state].terminal) resolved = true;
      else if (k === 'approve_quote') resolved = f.quotes.some((q) => q.status !== 'draft');
      else if ((m = /^notify_quote:q(\d+)$/.exec(k))) resolved = (f.quotes.find((q) => q.id === Number(m[1])) || {}).status !== 'sent';
      else if ((m = /^publish_update:u(\d+)$/.exec(k))) resolved = !db.get("SELECT 1 FROM status_updates WHERE id = ? AND status = 'draft'", Number(m[1]));
      else if ((m = /^review:d(\d+):v(\d+)$/.exec(k))) { const d = f.deliverables.find((x) => x.id === Number(m[1])); resolved = !d || ['approved', 'released'].includes(d.status) || d.version > Number(m[2]); }
      else if ((m = /^approve_invoice:i(\d+)$/.exec(k))) resolved = !db.get("SELECT 1 FROM invoices WHERE id = ? AND status = 'draft'", Number(m[1]));
      else if ((m = /^production:ij(\d+)$/.exec(k))) resolved = !db.get("SELECT 1 FROM integration_jobs WHERE id = ? AND status IN ('needs_human','queued','running')", Number(m[1]));
      else if ((m = /^job_failed:j(\d+)$/.exec(k))) resolved = !db.get("SELECT 1 FROM jobs WHERE id = ? AND status = 'failed'", Number(m[1]));
      else if ((m = /^overdue:t(\d+):(.+)$/.exec(k))) resolved = !db.get("SELECT 1 FROM tasks WHERE id = ? AND status != 'done' AND due_date = ?", Number(m[1]), m[2]);
      else if (k === 'review_lead') resolved = wf.state !== 'needs_review';
      else if (k === 'quote_declined') resolved = wf.state !== 'quote_declined';
      else if (k === 'release') resolved = f.allFinalReleased;
      else if (k === 'confirm_due_date') resolved = Boolean(f.project && f.project.due_date);
      else if (k === 'deposit_mismatch') resolved = Boolean(wf.project_id && app.billing.depositVerified(wf.project_id));
      if (resolved) app.humanTasks.resolve(t.id, 'system:auto', STATES[wf.state].terminal && wf.state !== 'completed' ? 'dismissed' : 'done');
    }
  }

  /** Failed jobs block a workflow until a person retries or cancels them. */
  function updateBlocked(wf) {
    const failed = db.all("SELECT * FROM jobs WHERE workflow_id = ? AND status = 'failed' ORDER BY id", wf.id);
    for (const j of failed) {
      app.humanTasks.create({ workflowId: wf.id, projectId: wf.project_id, inquiryId: wf.inquiry_id, kind: 'escalation', key: `job_failed:j${j.id}`, createdBy: 'system:workflow', title: `${j.agent}.${j.action} failed — retry or handle by hand`, detail: j.error || '', link: `/admin/ops/workflows/${wf.id}` });
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
