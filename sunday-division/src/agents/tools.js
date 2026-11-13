'use strict';
const { PermissionDeniedError, BudgetExceededError, FatalError } = require('../orchestrator/errors');
const { validate, S } = require('../lib/schema');
const { sha256 } = require('../lib/crypto');
const { now, str, safeJson, HttpError } = require('../lib/util');
const catalog = require('../services/catalog');

/**
 * Every capability a business agent can have. Tools are bound to the job's subject: they take
 * no client or project identifiers, and any record id an agent passes (a task, deliverable,
 * contractor or integration job) is checked against that subject before anything happens.
 *
 * Effects:
 *   read      — data about the bound project only (no client or contractor contact details)
 *   internal  — internal records the client never sees (notes, tasks, briefs, QA reports)
 *   draft     — prepared for a person to approve (quotes, messages, updates, assignments, invoices)
 *   external  — calls INDEX V3 / FORM; budgeted and allowed only when autonomous production is on
 *
 * There is deliberately no tool that sends a message, approves or rejects anything, changes a
 * payment or invoice status, releases a file, sets a client-facing date, changes settings,
 * budgets or permissions, purchases anything, or runs commands.
 */
const PRODUCT_NAMES = { index_v3: 'INDEX V3', form: 'FORM' };
const SERVICE_IDS = catalog.SERVICES.map((s) => s.id);
const PACKAGE_IDS = catalog.PACKAGES.map((p) => p.id);
const JOB_TYPE_IDS = Object.keys(catalog.JOB_TYPES);
const ATTACHABLE = { 'application/pdf': 'document', 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image' };
const MAX_ATTACH_BYTES = { document: 10 * 1024 * 1024, image: 4 * 1024 * 1024 };

const strings = (max = 20, len = 400) => S.arr(S.str(len), max);
const empty = S.obj({});
const actorOf = (scope) => `agent:${scope.agent}`;
const deny = (msg) => { throw new PermissionDeniedError(msg); };

function ownProject(app, scope) {
  const project = scope.projectId ? app.projects.get(scope.projectId) : null;
  if (!project) deny('This task is not bound to a project.');
  return project;
}
function ownTask(app, scope, taskId) {
  const t = app.db.get('SELECT * FROM tasks WHERE id = ?', Number(taskId));
  if (!t || t.project_id !== scope.projectId) deny(`Task ${taskId} is not part of this project.`);
  return { ...t, checklist: safeJson(t.checklist, []) };
}
function ownDeliverable(app, scope, deliverableId) {
  const d = app.projects.getDeliverable(Number(deliverableId));
  if (!d || d.project_id !== scope.projectId) deny(`Deliverable ${deliverableId} is not part of this project.`);
  return d;
}
function requestedJobTypes(app, project) {
  const inquiry = project.inquiry_id ? app.intake.get(project.inquiry_id) : null;
  return [...new Set(((inquiry && inquiry.deliverables) || []).map((d) => catalog.REQUESTED_TO_JOB[d]).filter(Boolean))];
}
/** The routes a task may take right now — decided by settings and connections, not by the agent. */
function routingOptions(app, task) {
  const options = ['contractor', 'studio'];
  const product = (catalog.JOB_TYPES[task.job_type] || {}).product;
  if (product && app.settings.get('autonomous_production') && app.integrations.isConnected(product)) options.unshift(product);
  return options;
}
function humanTask(app, scope, { kind, title, detail, link, key }) {
  return app.humanTasks.create({
    workflowId: scope.workflowId, projectId: scope.projectId, inquiryId: scope.inquiryId, kind,
    title, detail, link: link || (scope.projectId ? `/admin/projects/${scope.projectId}` : `/admin/leads/${scope.inquiryId}`),
    key: key || `${scope.agent}:${sha256(title).slice(0, 12)}`, createdBy: actorOf(scope),
  });
}

const TOOLS = {
  // ── read ──────────────────────────────────────────────────────────────
  get_inquiry: {
    effect: 'read', input: empty,
    description: 'Read the new inquiry this task is about (the client\'s contact details are withheld). Call this first when qualifying a lead.',
    run(app, scope) {
      const q = scope.inquiryId ? app.intake.get(scope.inquiryId) : null;
      if (!q) deny('This task is not bound to an inquiry.');
      return {
        ref: q.ref, brand_name: q.brand_name, garment_category: q.garment_category, package_interest: q.package_interest || null,
        description: q.description, target_measurements_and_sizing: q.measurements || null, fabric_preferences: q.fabric_preferences || null,
        budget: q.budget, timeline: q.timeline, requested_deliverables: q.deliverables, reference_files: app.files.forInquiry(q.id).length,
      };
    },
  },
  get_project: {
    effect: 'read', input: empty,
    description: 'Read the project this task is about: package, status, brief, and what the client asked for. Contact details are withheld.',
    run(app, scope) {
      const p = ownProject(app, scope);
      const q = p.inquiry_id ? app.intake.get(p.inquiry_id) : null;
      return {
        code: p.code, name: p.name, package: p.package || null, status: p.status, work_unlocked: app.projects.isWorkUnlocked(p),
        started_at: p.started_at, client_facing_due_date: p.due_date, brief_status: p.brief_status, brief: p.brief || null,
        garment_category: q ? q.garment_category : null, description: q ? q.description : null,
        target_measurements_and_sizing: q ? q.measurements || null : null, fabric_preferences: q ? q.fabric_preferences || null : null,
        budget: q ? q.budget : null, timeline: q ? q.timeline : null, requested_deliverables: q ? q.deliverables : [],
        allowed_production_job_types: requestedJobTypes(app, p), reference_files: app.files.forProject(p.id).filter((f) => f.kind === 'reference').length,
      };
    },
  },
  get_catalog: {
    effect: 'read', input: empty,
    description: 'Read the studio\'s packages with starting prices, its services and production job types.',
    run: () => ({
      packages: catalog.PACKAGES.map((p) => ({ id: p.id, name: p.name, starting_price_usd: p.fromCents / 100, typical_timeline: p.typicalTimeline, includes: p.includes })),
      services: catalog.SERVICES.map((s) => ({ id: s.id, name: s.name })),
      job_types: Object.entries(catalog.JOB_TYPES).map(([id, j]) => ({ id, label: j.label, checklist: j.checklist })),
    }),
  },
  list_quotes: {
    effect: 'read', input: empty, description: 'List the quotes on this project with their status.',
    run: (app, scope) => app.quotes.forProject(ownProject(app, scope).id).map((q) => ({ quote_id: q.id, version: q.version, status: q.status, total_usd: q.total_cents / 100, source: q.source })),
  },
  list_tasks: {
    effect: 'read', input: empty, description: 'List the project\'s tasks, including production tasks with their route and assignment status.',
    run(app, scope) {
      const p = ownProject(app, scope);
      return app.projects.tasks(p.id).map((t) => {
        const open = t.kind === 'production' ? app.assignments.openForTask(t.id) : null;
        return {
          task_id: t.id, title: t.title, kind: t.kind, job_type: t.job_type, milestone: t.milestone, status: t.status, due_date: t.due_date,
          route: t.route, has_brief: Boolean(t.brief), assignment_status: open ? open.status : (app.assignments.signedOffForTask(t.id) ? 'signed_off' : null),
        };
      });
    },
  },
  get_task: {
    effect: 'read', input: S.obj({ task_id: S.int(1) }),
    description: 'Read one task in this project: its technical brief, QA checklist, route, the routes currently allowed, and past assignment attempts.',
    run(app, scope, { task_id: taskId }) {
      const t = ownTask(app, scope, taskId);
      return {
        task_id: t.id, title: t.title, kind: t.kind, job_type: t.job_type, job_label: (catalog.JOB_TYPES[t.job_type] || {}).label || null,
        milestone: t.milestone, status: t.status, due_date: t.due_date, brief: t.brief || null, checklist: t.checklist, route: t.route,
        allowed_routes: t.kind === 'production' ? routingOptions(app, t) : [],
        previous_attempts: app.db.all('SELECT contractor_id, status FROM assignments WHERE task_id = ? ORDER BY id', t.id),
      };
    },
  },
  search_contractors: {
    effect: 'read', input: S.obj({ task_id: S.int(1) }),
    description: 'Search the approved contractor roster for people who can do this task. Returns profiles without contact details, best matches first, excluding anyone who already declined or was rejected for it.',
    run(app, scope, { task_id: taskId }) {
      const t = ownTask(app, scope, taskId);
      if (t.kind !== 'production') deny('Only production tasks are staffed through the roster.');
      const p = ownProject(app, scope);
      const q = p.inquiry_id ? app.intake.get(p.inquiry_id) : null;
      const exclude = app.assignments.closedForTask(t.id).map((a) => a.contractor_id);
      return app.contractors.search({ jobType: t.job_type, category: q ? q.garment_category : '', excludeIds: exclude })
        .map((c) => ({ ...c, hourly_rate_usd: c.hourly_rate_cents / 100, hourly_rate_cents: undefined }));
    },
  },
  list_deliverables: {
    effect: 'read', input: empty, description: 'List the project\'s deliverables, their versions, review status and the latest QA result.',
    run: (app, scope) => app.projects.deliverables(ownProject(app, scope).id).map((d) => {
      const qa = app.db.get('SELECT result FROM deliverable_qa WHERE deliverable_id = ? AND version = ? ORDER BY id DESC', d.id, d.version);
      return { deliverable_id: d.id, title: d.title, type: d.type, stage: d.stage, status: d.status, version: d.version, task_id: d.task_id, from_contractor: Boolean(d.assignment_id), source: d.source, notes: d.notes, has_file: Boolean(d.file_id), latest_qa: qa ? qa.result : null };
    }),
  },
  inspect_deliverable: {
    effect: 'read', async: true, input: S.obj({ deliverable_id: S.int(1) }),
    description: 'Inspect a deliverable\'s current file in an isolated process (type, size, integrity, page count, embedded scripts). PDFs and images are also attached so you can read them.',
    async run(app, scope, { deliverable_id: id }) {
      const d = ownDeliverable(app, scope, id);
      const file = d.file_id ? app.files.get(d.file_id) : null;
      if (!file) return { present: false };
      const report = await app.sandbox.inspect(app.files.pathOf(file));
      const out = { present: true, version: d.version, filename: file.original_name, integrity_ok: report.sha256 === file.sha256, stored_size: file.size, ...report };
      const kind = ATTACHABLE[file.mime];
      if (kind && file.size <= MAX_ATTACH_BYTES[kind] && out.integrity_ok && !(report.pdf && (report.pdf.active_content || report.pdf.encrypted))) {
        out.__attachment = { file_id: file.id, kind, media_type: file.mime };
      }
      return out;
    },
  },
  get_finance_summary: {
    effect: 'read', input: empty, description: 'Invoices, verified payment state and profitability for this project (read only).',
    run(app, scope) {
      const p = ownProject(app, scope);
      const quote = app.quotes.accepted(p.id);
      return {
        accepted_quote: quote ? { id: quote.id, total_cents: quote.total_cents, deposit_cents: quote.deposit_cents } : null,
        invoices: app.billing.forProject(p.id).map((i) => ({ id: i.id, number: i.number, kind: i.kind, status: i.status, amount_cents: i.amount_cents })),
        deposit_verified: app.billing.depositVerified(p.id), balance_due_cents: app.billing.balanceDue(p.id),
        remaining_to_invoice_cents: app.billing.remainingToInvoice(p.id), profitability: app.projects.profitability(p.id),
      };
    },
  },

  // ── internal ──────────────────────────────────────────────────────────
  save_triage: {
    effect: 'internal',
    input: S.obj({ summary: S.str(1500), services: S.arr(S.enum(SERVICE_IDS), 4), suggested_package: S.enum(PACKAGE_IDS), priority: S.enum(['high', 'normal', 'low']), qualified: S.bool(), qualification_note: S.str(600), missing_information: strings(), clarifying_questions: strings(), risk_flags: strings() }),
    description: 'Save your triage of the inquiry as internal notes for staff. Call once, after reading the inquiry.',
    run(app, scope, args) {
      if (!scope.inquiryId) deny('This task is not bound to an inquiry.');
      app.intake.saveTriage(scope.inquiryId, args, scope.brain);
      return { saved: true };
    },
  },
  create_tasks: {
    effect: 'internal', input: S.obj({ tasks: S.arr(S.obj({ title: S.str(200), milestone: S.str(80), due_in_days: S.int(0) }), 24) }),
    description: 'Create internal (non-production) tasks for the plan: kickoff, reviews, client review, handover. Allowed once the deposit is verified.',
    run(app, scope, { tasks }) {
      const p = ownProject(app, scope);
      app.projects.requireWorkUnlocked(p);
      const start = Date.parse(p.started_at || now());
      const ids = tasks.map((t) => app.projects.addTask(p.id, { title: t.title, milestone: t.milestone, due_date: new Date(start + Math.min(365, t.due_in_days) * 86400e3).toISOString().slice(0, 10) }, { source: scope.brain, status: 'todo' }));
      app.audit.log(actorOf(scope), 'tasks.planned', { entity: 'project', entityId: p.id, projectId: p.id, detail: `${ids.length} tasks (${scope.brain})` });
      return { created: ids.length, task_ids: ids };
    },
  },
  create_production_tasks: {
    effect: 'internal', input: S.obj({ tasks: S.arr(S.obj({ job_type: S.enum(JOB_TYPE_IDS), title: S.str(200), due_in_days: S.int(0) }), 12) }),
    description: 'Create one production task per deliverable the client is paying for. Only the job types in allowed_production_job_types (see get_project) are accepted, once each.',
    run(app, scope, { tasks }) {
      const p = ownProject(app, scope);
      app.projects.requireWorkUnlocked(p);
      const allowed = new Set(requestedJobTypes(app, p));
      const existing = new Set(app.projects.productionTasks(p.id).map((t) => t.job_type));
      const start = Date.parse(p.started_at || now());
      const created = []; const refused = [];
      for (const t of tasks) {
        if (!allowed.has(t.job_type)) { refused.push(`${t.job_type}: not something the client requested`); continue; }
        if (existing.has(t.job_type)) { refused.push(`${t.job_type}: already has a production task`); continue; }
        existing.add(t.job_type);
        created.push(app.projects.addTask(p.id, { title: t.title, milestone: 'Production', kind: 'production', job_type: t.job_type, due_date: new Date(start + Math.min(365, t.due_in_days) * 86400e3).toISOString().slice(0, 10) }, { source: scope.brain, status: 'todo' }));
      }
      return { created: created.length, task_ids: created, refused };
    },
  },
  save_technical_brief: {
    effect: 'internal', input: S.obj({ task_id: S.int(1), brief: S.str(8000), checklist: strings(15, 160) }),
    description: 'Save the technical brief for a production task and any checklist items to add to the job type\'s standard checklist. The brief is what the contractor or service will work from.',
    run(app, scope, { task_id: taskId, brief, checklist }) {
      const t = ownTask(app, scope, taskId);
      if (t.kind !== 'production') deny('Only production tasks have technical briefs.');
      app.projects.saveTaskBrief(t.id, { brief, checklist }, actorOf(scope));
      return { saved: true, checklist: safeJson(app.db.get('SELECT checklist FROM tasks WHERE id = ?', t.id).checklist, []) };
    },
  },
  set_task_route: {
    effect: 'internal', input: S.obj({ task_id: S.int(1), route: S.enum(['contractor', 'studio', 'index_v3', 'form']) }),
    description: 'Route a production task. Only routes listed in the task\'s allowed_routes are accepted.',
    run(app, scope, { task_id: taskId, route }) {
      const t = ownTask(app, scope, taskId);
      if (t.kind !== 'production') deny('Only production tasks are routed.');
      if (!routingOptions(app, t).includes(route)) deny(`Route "${route}" is not allowed for this task right now.`);
      if (!t.brief) throw new HttpError(409, 'Save the technical brief before routing the task.');
      app.projects.setTaskRoute(t.id, route, actorOf(scope));
      return { routed: true, route };
    },
  },
  record_qa_report: {
    effect: 'internal', key: (a) => `record_qa_report:${a.deliverable_id}:v${a.version}`,
    input: S.obj({ deliverable_id: S.int(1), version: S.int(1), result: S.enum(['pass', 'warn', 'fail']), checks: S.arr(S.obj({ name: S.str(120), status: S.enum(['pass', 'warn', 'fail']), detail: S.str(400) }), 30), missing_information: strings() }),
    description: 'Record the QA report for one deliverable version. This does not approve or reject it; a technical reviewer signs off.',
    run(app, scope, { deliverable_id: id, version, result, checks, missing_information: missing }) {
      const d = ownDeliverable(app, scope, id);
      // The overall result can never be better than the worst individual check.
      const worst = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') || missing.length ? 'warn' : 'pass';
      const order = { pass: 0, warn: 1, fail: 2 };
      const final = order[result] >= order[worst] ? result : worst;
      app.db.insertIgnore('deliverable_qa', { deliverable_id: d.id, version, agent: scope.agent, result: final, checks: JSON.stringify({ checks, missing_information: missing, brain: scope.brain }), created_at: now() });
      app.audit.log(actorOf(scope), 'deliverable.qa_recorded', { entity: 'deliverable', entityId: d.id, projectId: d.project_id, detail: `v${version} ${final}` });
      return { recorded: true, result: final };
    },
  },
  request_human_review: {
    effect: 'internal', input: S.obj({ kind: S.enum(['escalation', 'review', 'production', 'approval']), title: S.str(160), detail: S.str(1500), ref: S.nullable(S.str(80)) }),
    description: 'Ask a member of staff to decide or do something you cannot: a missing contractor, unclear requirements, a suspicious request, a date to confirm. Set ref to null.',
    run: (app, scope, { ref, ...args }) => ({ task_id: humanTask(app, scope, { ...args, key: ref ? `${scope.agent}:${ref}` : undefined }), queued: true }),
  },

  // ── draft (a person approves before anything reaches a client or contractor) ──
  save_brief_draft: {
    effect: 'draft', input: S.obj({ brief: S.str(10000) }),
    description: 'Save the project brief as a draft for staff to approve. Refused if a brief already exists.',
    run(app, scope, { brief }) {
      const p = ownProject(app, scope);
      if (p.brief.trim()) return { saved: false, reason: 'A brief already exists; it was not changed.' };
      app.projects.saveBrief(p.id, brief, { source: scope.brain, actor: actorOf(scope) });
      return { saved: true };
    },
  },
  save_quote_draft: {
    effect: 'draft',
    input: S.obj({ scope: S.str(5000), line_items: S.arr(S.obj({ description: S.str(200), quantity: S.int(1), unit_price_usd: S.int(1) }), 20), deposit_percent: S.int(10), assumptions: strings(15, 300) }),
    description: 'Save the quote as a draft. Staff review, price-check and send it; the client never sees a draft. Refused if a quote already exists.',
    run(app, scope, args) {
      const p = ownProject(app, scope);
      const existing = app.quotes.forProject(p.id)[0];
      if (existing) return { saved: false, reason: `A ${existing.status} quote already exists; it was not changed.`, quote_id: existing.id };
      const assumptions = args.assumptions.length ? `\n\nAssumptions to confirm:\n${args.assumptions.map((a) => `- ${a}`).join('\n')}` : '';
      const id = app.quotes.saveDraft(p.id, {
        scope: args.scope + assumptions, deposit_percent: args.deposit_percent,
        line_items: args.line_items.map((i) => ({ description: i.description, quantity: i.quantity, unit_cents: i.unit_price_usd * 100 })),
      }, { source: scope.brain, actor: actorOf(scope) });
      const q = app.quotes.get(id);
      const pkg = catalog.packageById(p.package);
      return { saved: true, quote_id: id, total_usd: q.total_cents / 100, deposit_usd: q.deposit_cents / 100, deposit_percent: q.deposit_percent, below_package_floor: Boolean(pkg && q.total_cents < pkg.fromCents) };
    },
  },
  recommend_contractor: {
    effect: 'draft', input: S.obj({ task_id: S.int(1), contractor_id: S.int(1), estimated_hours: { type: 'number', minimum: 0.5, maximum: 200 }, rationale: S.str(600) }),
    description: 'Recommend an approved contractor for a production task. Creates a recommendation for staff to approve; it does not contact anyone. The fee is calculated from the contractor\'s approved rate.',
    run(app, scope, { task_id: taskId, contractor_id: contractorId, estimated_hours: hours, rationale }) {
      ownTask(app, scope, taskId);
      const id = app.assignments.recommend({ taskId, contractorId, estimatedHours: hours, rationale, recommendedBy: actorOf(scope) });
      const a = app.assignments.get(id);
      return { assignment_id: id, status: a.status, fee_usd: a.fee_cents / 100, estimated_hours: a.estimated_hours, needs_staff_approval: true };
    },
  },
  prepare_client_message: {
    effect: 'draft', input: S.obj({ purpose: S.enum(['quote_ready', 'project_update']), subject: S.str(160), body: S.str(3000) }),
    description: 'Prepare a message to this project\'s client. It is saved as a draft for staff to approve and send; you do not choose the address.',
    run(app, scope, { purpose, subject, body }) {
      const p = ownProject(app, scope);
      const id = app.messaging.prepare({ projectId: p.id, recipientType: 'client', recipientId: p.client_id, purpose, subject, body, preparedBy: actorOf(scope) });
      humanTask(app, scope, { kind: 'approval', key: `approve_message:m${id}`, title: `Approve message to client: ${subject}`, detail: 'Prepared by the Client Success Agent. Edit if needed, then approve to send.', link: `/admin/messages#m${id}` });
      return { message_id: id, status: 'draft', needs_staff_approval: true };
    },
  },
  save_status_update_draft: {
    effect: 'draft', input: S.obj({ text: S.str(3000) }),
    description: 'Save a client portal update as a draft for staff to publish.',
    run(app, scope, { text }) {
      const p = ownProject(app, scope);
      const id = app.projects.saveStatusDraft(p.id, text, { source: scope.brain, actor: actorOf(scope) });
      humanTask(app, scope, { kind: 'approval', key: `publish_update:u${id}`, title: `Publish the update for ${p.code}`, detail: 'Drafted by the Client Success Agent. Edit if needed, then publish it to the client portal.', link: `/admin/projects/${p.id}#updates` });
      return { update_id: id, status: 'draft' };
    },
  },
  draft_final_invoice: {
    effect: 'draft', input: empty,
    description: 'Draft the final invoice for exactly the uninvoiced balance of the accepted quote. Staff issue it.',
    run(app, scope) {
      const p = ownProject(app, scope);
      const open = app.billing.forProject(p.id).find((i) => i.kind === 'final' && ['draft', 'open'].includes(i.status));
      if (open) return { invoice_id: open.id, amount_cents: open.amount_cents, skipped: true };
      const amount = app.billing.remainingToInvoice(p.id);
      if (amount <= 0) return { invoice_id: null, amount_cents: 0, skipped: true };
      const id = app.billing.createInvoice({ projectId: p.id, kind: 'final', amountCents: amount, description: 'Final balance', status: 'draft', actor: actorOf(scope) });
      return { invoice_id: id, amount_cents: amount, skipped: false };
    },
  },

  // ── external ──────────────────────────────────────────────────────────
  submit_to_integration: {
    effect: 'external', async: true, key: (a) => `submit_to_integration:${a.task_id}`, input: S.obj({ task_id: S.int(1) }),
    description: 'Submit a production task routed to INDEX V3 or FORM to that service. Outputs come back as deliverables for QA and review.',
    async run(app, scope, { task_id: taskId }) {
      const t = ownTask(app, scope, taskId);
      const product = t.route;
      if (!['index_v3', 'form'].includes(product)) deny('Route the task to INDEX V3 or FORM first.');
      if (!app.settings.get('autonomous_production')) deny('Autonomous production is switched off.');
      if (!app.integrations.isConnected(product)) deny(`${PRODUCT_NAMES[product]} is not connected.`);
      const p = ownProject(app, scope);
      const estimate = app.budget.externalJobEstimateMicros();
      app.budget.assertExternal({ projectId: p.id, estimateMicros: estimate });
      const started = Date.now();
      const jobType = { technical_flats: 'technical_flats', tech_pack: 'tech_pack', measurement_spec: 'measurement_spec', garment_3d: 'garment_3d', product_imagery: 'product_imagery', campaign_assets: 'campaign_assets' }[t.job_type];
      const id = await app.integrations.request(p, product, jobType, t.brief.slice(0, 2000), actorOf(scope), { mode: 'api', idempotencyKey: `wf${scope.workflowId}:task${t.id}`, taskId: t.id });
      const job = app.db.get('SELECT * FROM integration_jobs WHERE id = ?', id);
      app.db.insert('agent_runs', {
        job_id: scope.jobId, workflow_id: scope.workflowId, project_id: p.id, agent: scope.agent, agent_version: scope.agentVersion,
        task: `${product}.${jobType}`, provider: 'integration', model_requested: product, model_served: job.service_version || product,
        cost_micros: estimate, latency_ms: Date.now() - started, status: 'ok', detail: `external job ${job.external_id || ''} (estimated cost)`, created_at: now(),
      });
      return { integration_job_id: id, status: job.status };
    },
  },
  refresh_integration_job: {
    effect: 'external', async: true, key: (a) => `refresh_integration_job:${a.integration_job_id}:${Date.now()}`, input: S.obj({ integration_job_id: S.int(1) }),
    description: 'Check an INDEX V3 / FORM job and import finished outputs as deliverables awaiting review.',
    async run(app, scope, { integration_job_id: id }) {
      const j = app.db.get('SELECT * FROM integration_jobs WHERE id = ?', Number(id));
      if (!j || j.project_id !== scope.projectId) deny(`Integration job ${id} is not part of this project.`);
      const job = await app.integrations.refresh(Number(id), actorOf(scope));
      return { status: job.status };
    },
  },
};

const isMutating = (tool) => tool.effect !== 'read';

/** Anthropic API tool definitions for an action's allow-list (strict mode; unsupported constraints stripped). */
function toApiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toApiSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['minimum', 'maximum', 'maxLength', 'minLength', 'maxItems', 'minItems'].includes(k)) continue;
    out[k] = typeof v === 'object' ? toApiSchema(v) : v;
  }
  if (Array.isArray(out.type)) {
    const { type, enum: en, ...rest } = out;
    return { anyOf: type.map((t) => (t === 'null' ? { type: 'null' } : { ...rest, type: t, ...(en ? { enum: en.filter((e) => e !== null) } : {}) })) };
  }
  return out;
}
function apiTools(actionDef) {
  return actionDef.tools.map((name) => {
    if (name === 'submit_result') {
      return { name, strict: true, description: 'Submit your final result for this task. Call exactly once, when you are finished.', input_schema: toApiSchema(actionDef.output) };
    }
    const t = TOOLS[name];
    return { name, strict: true, description: t.description, input_schema: toApiSchema(t.input) };
  });
}

/**
 * Bind the tool set to one job. Every call is checked against the action's allow-list and its
 * input schema; state-changing calls go through an effect ledger keyed per job, so a resumed or
 * retried job replays its earlier effects instead of repeating them.
 */
function bindTools(app, { job, agentDef, actionDef, scope }) {
  const allowed = new Set(actionDef.tools.filter((t) => t !== 'submit_result'));
  const logCall = (row) => app.db.insert('agent_tool_calls', { job_id: job.id, agent: agentDef.id, created_at: now(), ...row });

  async function call(name, args = {}, { effectKey } = {}) {
    const tool = TOOLS[name];
    if (!tool || !allowed.has(name)) {
      logCall({ tool: String(name).slice(0, 80), effect: tool ? tool.effect : 'unknown', decision: 'denied', detail: 'not in agent policy' });
      app.audit.log(`agent:${agentDef.id}`, 'agent.permission_denied', { entity: 'job', entityId: job.id, projectId: scope.projectId, detail: `${String(name).slice(0, 80)} (not in policy for ${agentDef.id}.${actionDef.id})` });
      throw new PermissionDeniedError(`${agentDef.id}.${actionDef.id} may not use ${name}.`);
    }
    const errors = validate(tool.input, args);
    if (errors.length) throw new FatalError(`Invalid input for ${name}: ${errors.slice(0, 4).join('; ')}`);
    try {
      if (!isMutating(tool)) return await tool.run(app, scope, args);
      const key = effectKey || (tool.key ? tool.key(args) : name);
      const prior = app.db.get("SELECT result FROM agent_tool_calls WHERE job_id = ? AND effect_key = ? AND decision = 'executed'", job.id, key);
      if (prior) {
        logCall({ tool: name, effect: tool.effect, effect_key: key, decision: 'replayed', result: prior.result });
        return JSON.parse(prior.result);
      }
      const record = (result) => logCall({ tool: name, effect: tool.effect, effect_key: key, decision: 'executed', result: JSON.stringify(result ?? null), detail: summarize(args) });
      if (tool.async) {
        const result = await tool.run(app, scope, args);
        record(result);
        return result;
      }
      // The effect and its ledger entry commit together, or not at all.
      return app.db.tx(() => { const result = tool.run(app, scope, args); record(result); return result; });
    } catch (err) {
      if (err instanceof PermissionDeniedError || err instanceof BudgetExceededError) {
        logCall({ tool: name, effect: tool.effect, decision: 'denied', detail: err.message });
        app.audit.log(`agent:${agentDef.id}`, 'agent.permission_denied', { entity: 'job', entityId: job.id, projectId: scope.projectId, detail: `${name}: ${err.message}` });
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

module.exports = { TOOLS, bindTools, apiTools, toApiSchema, isMutating, routingOptions, ATTACHABLE };
