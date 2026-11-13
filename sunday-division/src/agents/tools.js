'use strict';
const { PermissionDeniedError, BudgetExceededError } = require('../orchestrator/errors');
const { now, str } = require('../lib/util');
const catalog = require('../services/catalog');

/**
 * The complete set of things an agent can do. Each tool is bound to the job's subject
 * (its inquiry / project): tools take no client or project identifiers, and any record
 * id an agent passes (a deliverable, an integration job) is checked against that subject.
 *
 * Effects:
 *   read      — returns data about the bound subject only
 *   model     — calls the drafting model through the budgeted AI gateway
 *   internal  — writes internal records the client never sees (notes, tasks, QA reports)
 *   draft     — creates content that stays invisible to the client until a person approves it
 *   external  — calls an outside service (INDEX V3 / FORM); budgeted and policy-gated
 *
 * Deliberately absent: sending or approving quotes, approving or settling invoices, marking
 * anything paid, approving or releasing deliverables, publishing to the client, changing
 * project due dates, changing settings, budgets or permissions, purchasing, running commands.
 */
const PRODUCTION = { index_v3: 'INDEX V3', form: 'FORM' };

function ownProject(app, scope) {
  const project = scope.projectId ? app.projects.get(scope.projectId) : null;
  if (!project) throw new PermissionDeniedError('This job is not bound to a project.');
  return project;
}
function ownDeliverable(app, scope, deliverableId) {
  const d = app.projects.getDeliverable(Number(deliverableId));
  if (!d || d.project_id !== scope.projectId) throw new PermissionDeniedError(`Deliverable ${deliverableId} is outside this job's project.`);
  return d;
}
function ownIntegrationJob(app, scope, id) {
  const j = app.db.get('SELECT * FROM integration_jobs WHERE id = ?', Number(id));
  if (!j || j.project_id !== scope.projectId) throw new PermissionDeniedError(`Integration job ${id} is outside this job's project.`);
  return j;
}
const actorOf = (scope) => `agent:${scope.agent}`;

const TOOLS = {
  // ── read ──────────────────────────────────────────────────────────────
  'inquiry.read': {
    effect: 'read', description: 'The bound inquiry, without the client\'s contact details.',
    run(app, scope) {
      const q = scope.inquiryId ? app.intake.get(scope.inquiryId) : null;
      if (!q) throw new PermissionDeniedError('This job is not bound to an inquiry.');
      const { email, phone, website, contact_name, internal_notes, ...rest } = q;
      return { ...rest, reference_files: app.files.forInquiry(q.id).length };
    },
  },
  'project.read': {
    effect: 'read', description: 'The bound project: package, status, brief, dates. No client contact details.',
    run(app, scope) {
      const p = ownProject(app, scope);
      return { id: p.id, code: p.code, name: p.name, package: p.package, status: p.status, brief: p.brief, brief_status: p.brief_status, started_at: p.started_at, due_date: p.due_date, inquiry_id: p.inquiry_id, work_unlocked: app.projects.isWorkUnlocked(p) };
    },
  },
  'catalog.read': { effect: 'read', description: 'Packages, services and starting prices.', run: () => ({ packages: catalog.PACKAGES, services: catalog.SERVICES }) },
  'quotes.read': {
    effect: 'read', description: 'Quotes on the bound project.',
    run: (app, scope) => app.quotes.forProject(ownProject(app, scope).id).map((q) => ({ id: q.id, version: q.version, status: q.status, total_cents: q.total_cents, deposit_cents: q.deposit_cents, source: q.source })),
  },
  'tasks.read': {
    effect: 'read', description: 'Tasks on the bound project.',
    run: (app, scope) => app.projects.tasks(ownProject(app, scope).id).map((t) => ({ id: t.id, title: t.title, milestone: t.milestone, status: t.status, due_date: t.due_date, source: t.source })),
  },
  'deliverables.read': {
    effect: 'read', description: 'Deliverables on the bound project.',
    run: (app, scope) => app.projects.deliverables(ownProject(app, scope).id).map((d) => ({ id: d.id, title: d.title, type: d.type, stage: d.stage, status: d.status, version: d.version, source: d.source, notes: d.notes, has_file: Boolean(d.file_id), filename: d.original_name || null })),
  },
  'finance.read': {
    effect: 'read', description: 'Invoices, verified payment state and profitability for the bound project (read only).',
    run(app, scope) {
      const p = ownProject(app, scope);
      const quote = app.quotes.accepted(p.id);
      return {
        accepted_quote: quote ? { id: quote.id, total_cents: quote.total_cents, deposit_cents: quote.deposit_cents } : null,
        invoices: app.billing.forProject(p.id).map((i) => ({ id: i.id, number: i.number, kind: i.kind, status: i.status, amount_cents: i.amount_cents })),
        deposit_verified: app.billing.depositVerified(p.id),
        balance_due_cents: app.billing.balanceDue(p.id),
        remaining_to_invoice_cents: app.billing.remainingToInvoice(p.id),
        profitability: app.projects.profitability(p.id),
      };
    },
  },
  'integrations.status': {
    effect: 'read', description: 'Which production services are connected, and whether autonomous production is switched on.',
    run: (app) => ({ autonomous_production: app.settings.get('autonomous_production'), products: app.integrations.status().map((i) => ({ id: i.id, connected: i.connected })) }),
  },
  'workflow.readPlan': {
    effect: 'read', description: 'The production plan made by the Project Management Agent for this workflow.',
    run(app, scope) {
      const job = app.db.get("SELECT output FROM jobs WHERE workflow_id = ? AND agent = 'project_manager' AND action = 'plan' AND status = 'succeeded'", scope.workflowId);
      return job ? JSON.parse(job.output).production_plan : [];
    },
  },
  'client.portalStatus': {
    effect: 'read', description: 'Whether the bound project\'s client has been issued portal access (never the key itself).',
    run(app, scope) {
      const c = app.projects.getClient(ownProject(app, scope).client_id);
      return { has_portal_key: Boolean(c && c.portal_key_hash), brand_name: c ? c.brand_name : '' };
    },
  },
  'files.inspect': {
    effect: 'read', async: true, description: 'Inspect a deliverable\'s file in an isolated, permission-restricted process.',
    async run(app, scope, { deliverableId }) {
      const d = ownDeliverable(app, scope, deliverableId);
      const file = d.file_id ? app.files.get(d.file_id) : null;
      if (!file) return { present: false };
      const report = await app.sandbox.inspect(app.files.pathOf(file));
      return { present: true, expected_sha256: file.sha256, stored_size: file.size, filename: file.original_name, ...report };
    },
  },

  // ── model ─────────────────────────────────────────────────────────────
  'model.triage': {
    effect: 'model', async: true, description: 'Draft triage notes for the bound inquiry.',
    run: (app, scope, _a, meta) => app.automation.generate.triage(app.intake.get(scope.inquiryId), meta),
  },
  'model.brief': { effect: 'model', async: true, description: 'Draft a project brief.', run: (app, scope, _a, meta) => app.automation.generate.brief(ownProject(app, scope), meta) },
  'model.quote': { effect: 'model', async: true, description: 'Draft quote scope and line items.', run: (app, scope, _a, meta) => app.automation.generate.quote(ownProject(app, scope), meta) },
  'model.plan': { effect: 'model', async: true, description: 'Draft the working task list.', run: (app, scope, _a, meta) => app.automation.generate.tasks(ownProject(app, scope), meta) },
  'model.statusUpdate': {
    effect: 'model', async: true, description: 'Draft a client status update from project facts.',
    run: (app, scope, args, meta) => app.automation.generate.statusUpdate(ownProject(app, scope), meta, { note: str(args && args.note, 300) }),
  },

  // ── internal ──────────────────────────────────────────────────────────
  'inquiry.saveTriage': {
    effect: 'internal', description: 'Save triage notes on the bound inquiry (internal only).',
    run(app, scope, { triage, source }) { app.intake.saveTriage(scope.inquiryId, triage, source); return { saved: true }; },
  },
  'tasks.createPlan': {
    effect: 'internal', description: 'Create the internal working task list. Requires the deposit to have been received.',
    run(app, scope, { tasks, source }) {
      const p = ownProject(app, scope);
      app.projects.requireWorkUnlocked(p);
      const ids = tasks.slice(0, 24).map((t) => app.projects.addTask(p.id, { title: t.title, milestone: t.milestone, due_date: t.due_date }, { source, status: 'todo' }));
      app.audit.log(actorOf(scope), 'tasks.planned', { entity: 'project', entityId: p.id, projectId: p.id, detail: `${ids.length} tasks (${source})` });
      return { created: ids.length };
    },
  },
  'qa.record': {
    effect: 'internal', key: (a) => `qa.record:${a.deliverableId}:v${a.version}`, description: 'Record a QA report on a deliverable version. Cannot approve it.',
    run(app, scope, { deliverableId, version, result, checks }) {
      const d = ownDeliverable(app, scope, deliverableId);
      app.db.insertIgnore('deliverable_qa', { deliverable_id: d.id, version, agent: scope.agent, result, checks: JSON.stringify(checks), created_at: now() });
      app.audit.log(actorOf(scope), 'deliverable.qa_recorded', { entity: 'deliverable', entityId: d.id, projectId: d.project_id, detail: `v${version} ${result}` });
      return { recorded: true };
    },
  },
  'humanQueue.create': {
    effect: 'internal', key: (a) => `humanQueue:${a.key}`, description: 'Ask a person to do or decide something.',
    run(app, scope, { kind, title, detail = '', link = '', key }) {
      if (link && !/^\/admin\/[\w/#?=&.-]*$/.test(link)) throw new PermissionDeniedError('Human task links must point inside the dashboard.');
      const id = app.humanTasks.create({ workflowId: scope.workflowId, projectId: scope.projectId, inquiryId: scope.inquiryId, kind, title, detail, link, key, createdBy: actorOf(scope) });
      return { task_id: id };
    },
  },
  'production.queueHuman': {
    effect: 'internal', key: (a) => `production.queueHuman:${a.product}:${a.jobType}`, async: true, description: 'Put a piece of production work in the human production queue.',
    async run(app, scope, { product, jobType, notes = '' }) {
      const p = ownProject(app, scope);
      const key = `wf${scope.workflowId}:${product}:${jobType}`;
      const id = await app.integrations.request(p, product, jobType, notes, actorOf(scope), { mode: 'manual', idempotencyKey: key });
      app.humanTasks.create({
        workflowId: scope.workflowId, projectId: p.id, kind: 'production', key: `wf${scope.workflowId}:production:ij${id}`, createdBy: actorOf(scope),
        title: `Produce ${app.integrations.PRODUCTS[product].jobTypes[jobType].label.toLowerCase()} for ${p.code}`,
        detail: `${PRODUCTION[product]} is not handling this automatically. Upload the result as a deliverable, then mark the request produced.`,
        link: `/admin/projects/${p.id}#production`,
      });
      return { integration_job_id: id, route: 'human' };
    },
  },

  // ── draft ─────────────────────────────────────────────────────────────
  'brief.draft': {
    effect: 'draft', description: 'Save a draft brief. Never overwrites an existing brief.',
    run(app, scope, { text, source }) {
      const p = ownProject(app, scope);
      if (p.brief.trim()) return { skipped: true, reason: 'brief already exists' };
      app.projects.saveBrief(p.id, text, { source, actor: actorOf(scope) });
      return { skipped: false };
    },
  },
  'quote.draft': {
    effect: 'draft', description: 'Save a draft quote. Never overwrites a quote a person has written, sent or had accepted.',
    run(app, scope, { input, source }) {
      const p = ownProject(app, scope);
      const existing = app.quotes.forProject(p.id)[0];
      if (existing) return { skipped: true, quote_id: existing.id, reason: `a ${existing.status} quote already exists` };
      const id = app.quotes.saveDraft(p.id, input, { source, actor: actorOf(scope) });
      return { skipped: false, quote_id: id };
    },
  },
  'statusUpdate.draft': {
    effect: 'draft', description: 'Save a client status update as a draft for staff to publish.',
    run(app, scope, { text, source }) {
      const p = ownProject(app, scope);
      return { update_id: app.projects.saveStatusDraft(p.id, text, { source, actor: actorOf(scope) }) };
    },
  },
  'invoice.draftFinal': {
    effect: 'draft', description: 'Draft the final invoice for exactly the uninvoiced balance of the accepted quote. Staff approve it before it is payable.',
    run(app, scope) {
      const p = ownProject(app, scope);
      const open = app.billing.forProject(p.id).find((i) => i.kind === 'final' && ['draft', 'open'].includes(i.status));
      if (open) return { invoice_id: open.id, amount_cents: open.amount_cents, skipped: true };
      const amount = app.billing.remainingToInvoice(p.id); // deterministic: accepted total − deposit/final invoiced
      if (amount <= 0) return { invoice_id: null, amount_cents: 0, skipped: true };
      const id = app.billing.createInvoice({ projectId: p.id, kind: 'final', amountCents: amount, description: 'Final balance', status: 'draft', actor: actorOf(scope) });
      return { invoice_id: id, amount_cents: amount, skipped: false };
    },
  },

  // ── external ──────────────────────────────────────────────────────────
  'production.submit': {
    effect: 'external', key: (a) => `production.submit:${a.product}:${a.jobType}`, async: true,
    description: 'Submit work to INDEX V3 / FORM. Allowed only when autonomous production is on, the service is connected and the budget allows.',
    async run(app, scope, { product, jobType, notes = '' }) {
      const p = ownProject(app, scope);
      if (!app.settings.get('autonomous_production')) throw new PermissionDeniedError('Autonomous production is switched off.');
      if (!app.integrations.isConnected(product)) throw new PermissionDeniedError(`${PRODUCTION[product] || product} is not connected.`);
      const estimate = app.budget.externalJobEstimateMicros();
      app.budget.assertExternal({ projectId: p.id, estimateMicros: estimate });
      const started = Date.now();
      const id = await app.integrations.request(p, product, jobType, notes, actorOf(scope), { mode: 'api', idempotencyKey: `wf${scope.workflowId}:${product}:${jobType}` });
      const job = app.db.get('SELECT * FROM integration_jobs WHERE id = ?', id);
      app.db.insert('agent_runs', {
        job_id: scope.jobId, workflow_id: scope.workflowId, project_id: p.id, agent: scope.agent, agent_version: scope.agentVersion,
        task: `${product}.${jobType}`, provider: 'integration', model_requested: product, model_served: job.service_version || product,
        cost_micros: estimate, latency_ms: Date.now() - started, status: 'ok', detail: `external job ${job.external_id || ''} (estimated cost)`, created_at: now(),
      });
      return { integration_job_id: id, route: 'api', status: job.status };
    },
  },
  'production.refresh': {
    effect: 'external', async: true, key: (a) => `production.refresh:${a.integrationJobId}:${Date.now()}`,
    description: 'Check an external production job and import finished outputs as deliverables awaiting review.',
    async run(app, scope, { integrationJobId }) {
      ownIntegrationJob(app, scope, integrationJobId);
      const job = await app.integrations.refresh(Number(integrationJobId), actorOf(scope));
      return { status: job.status };
    },
  },
};

const isMutating = (tool) => tool.effect !== 'read' && tool.effect !== 'model';

/**
 * Build the tool interface handed to one job. Every call is checked against the agent
 * action's allow-list; mutating calls go through an effect ledger so a retried job
 * replays its earlier effects instead of repeating them.
 */
function bindTools(app, { job, agentDef, actionDef, scope, aiMeta }) {
  const allowed = new Set(actionDef.tools);
  const logCall = (row) => app.db.insert('agent_tool_calls', { job_id: job.id, agent: agentDef.id, created_at: now(), ...row });

  async function call(name, args = {}) {
    const tool = TOOLS[name];
    if (!tool || !allowed.has(name)) {
      logCall({ tool: name, effect: tool ? tool.effect : 'unknown', decision: 'denied', detail: 'not in agent policy' });
      app.audit.log(`agent:${agentDef.id}`, 'agent.permission_denied', { entity: 'job', entityId: job.id, projectId: scope.projectId, detail: `${name} (not in policy for ${agentDef.id}.${actionDef.id})` });
      throw new PermissionDeniedError(`${agentDef.id}.${actionDef.id} may not use ${name}.`);
    }
    try {
      if (!isMutating(tool)) return await tool.run(app, scope, args, aiMeta);
      const effectKey = tool.key ? tool.key(args) : name;
      const prior = app.db.get("SELECT result FROM agent_tool_calls WHERE job_id = ? AND effect_key = ? AND decision = 'executed'", job.id, effectKey);
      if (prior) {
        logCall({ tool: name, effect: tool.effect, effect_key: effectKey, decision: 'replayed', result: prior.result });
        return JSON.parse(prior.result);
      }
      const record = (result) => logCall({ tool: name, effect: tool.effect, effect_key: effectKey, decision: 'executed', result: JSON.stringify(result ?? null), detail: summarize(args) });
      if (tool.async) {
        const result = await tool.run(app, scope, args, aiMeta);
        record(result);
        return result;
      }
      // Effect and ledger entry commit together, or not at all.
      return app.db.tx(() => { const result = tool.run(app, scope, args, aiMeta); record(result); return result; });
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        logCall({ tool: name, effect: tool.effect, decision: 'denied', detail: err.message });
        app.audit.log(`agent:${agentDef.id}`, 'agent.permission_denied', { entity: 'job', entityId: job.id, projectId: scope.projectId, detail: `${name}: ${err.message}` });
      }
      if (err instanceof BudgetExceededError) {
        logCall({ tool: name, effect: tool.effect, decision: 'denied', detail: err.message });
      }
      throw err;
    }
  }
  return { call, allowed: [...allowed] };
}

function summarize(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = typeof v === 'string' ? v.slice(0, 80) : Array.isArray(v) ? `[${v.length} items]` : typeof v === 'object' && v ? '{…}' : v;
  }
  return JSON.stringify(out).slice(0, 400);
}

module.exports = { TOOLS, bindTools, isMutating };
