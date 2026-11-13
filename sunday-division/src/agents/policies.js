'use strict';
const rules = require('../ai/rules');
const catalog = require('../services/catalog');
const { Reschedule } = require('../orchestrator/errors');

/**
 * The rules brain: deterministic versions of each agent action. They call the same tools as
 * the model, under the same permissions, and return the same output shape. Used when no model
 * is configured, when the AI budget will not cover a task, and for steps that never use a model.
 */
const HOURS = { design: 10, technical_flats: 6, tech_pack: 10, measurement_spec: 4, garment_3d: 12, product_imagery: 8, campaign_assets: 12 };
const PRODUCTION_DAYS = { design: 6, technical_flats: 12, measurement_spec: 14, tech_pack: 16, garment_3d: 19, product_imagery: 22, campaign_assets: 26 };
const TECHNICAL_TYPES = new Set(['flats', 'techpack', '3d']);
const call = (ctx, name, args = {}, opts) => ctx.tools.call(name, args, opts);
const label = (jobType) => (catalog.JOB_TYPES[jobType] || { label: jobType }).label;

/** Rebuild the inquiry shape the drafting rules expect from what the tools return. */
function asInquiry(x) {
  return {
    brand_name: x.brand_name || x.name || '', garment_category: x.garment_category || '', package_interest: x.package_interest || '',
    description: x.description || '', measurements: x.target_measurements_and_sizing || '', fabric_preferences: x.fabric_preferences || '',
    budget: x.budget || '', timeline: x.timeline || '', deliverables: x.requested_deliverables || [], triage: null,
  };
}

const sales = {
  async qualify(ctx) {
    const inq = await call(ctx, 'get_inquiry');
    const t = rules.triage(asInquiry(inq), { referenceCount: inq.reference_files });
    await call(ctx, 'save_triage', {
      summary: t.summary, services: t.services, suggested_package: t.suggested_package, priority: t.priority, qualified: t.qualified,
      qualification_note: t.qualification_note, missing_information: t.missing_information, clarifying_questions: t.clarifying_questions, risk_flags: t.risk_flags,
    });
    return { qualified: t.qualified, suggested_package: t.suggested_package, services: t.services, priority: t.priority, missing_count: t.missing_information.length, risk_flags: t.risk_flags };
  },
  async draft_proposal(ctx) {
    const p = await call(ctx, 'get_project');
    const quotes = await call(ctx, 'list_quotes');
    if (quotes.length) return { summary: `A ${quotes[0].status} quote already exists; nothing was drafted.`, flags: [] };
    const inq = asInquiry(p);
    const project = { package: p.package };
    if (!p.brief) await call(ctx, 'save_brief_draft', { brief: rules.brief(inq, { referenceCount: p.reference_files, project }).brief });
    const q = rules.quote(inq, { project });
    const saved = await call(ctx, 'save_quote_draft', { scope: q.scope, line_items: q.line_items, deposit_percent: q.deposit_percent, assumptions: q.assumptions });
    return { summary: saved.saved ? `Drafted quote for $${saved.total_usd}.` : saved.reason, flags: ['Drafted by rules (no model used) — check pricing against the brief.'] };
  },
};

const client_success = {
  async quote_notice(ctx) {
    const p = await call(ctx, 'get_project');
    const sent = (await call(ctx, 'list_quotes')).find((q) => q.status === 'sent');
    if (!sent) return { message_id: null };
    const m = await call(ctx, 'prepare_client_message', {
      purpose: 'quote_ready', subject: 'Your Sunday Division quote is ready',
      body: `Hello,\n\nThank you for the details on ${p.name}. Your quote is ready to review in your client portal: ${ctx.app.config.baseUrl}/portal\n\nIf anything in the scope needs adjusting, reply to this message and we will revise it.\n\nSunday Division`,
    });
    return { message_id: m.message_id };
  },
  async kickoff_update(ctx) {
    const p = await call(ctx, 'get_project');
    const tasks = await call(ctx, 'list_tasks');
    const first = tasks.filter((t) => t.kind === 'general').slice(0, 2).map((t) => t.title.toLowerCase());
    const needs = [];
    if (!p.target_measurements_and_sizing) needs.push('your target size range or a fit reference');
    if (!p.fabric_preferences) needs.push('any fabric preferences');
    const text = [
      `Your deposit has been received and work on ${p.name} has started.`,
      first.length ? `First up: ${first.join(' and ')}.` : '',
      needs.length ? `To keep things moving, please send ${needs.join(' and ')}.` : '',
      'We will post updates here as each milestone is completed.',
    ].filter(Boolean).join('\n\n');
    const u = await call(ctx, 'save_status_update_draft', { text });
    return { update_id: u.update_id };
  },
};

const project_manager = {
  async plan(ctx) {
    const p = await call(ctx, 'get_project');
    const scale = p.package === 'collection' ? 1.6 : 1;
    const jobs = p.allowed_production_job_types;
    const production = jobs.map((j) => ({ job_type: j, title: `${label(j)} — ${p.garment_category ? p.garment_category.toLowerCase() : 'garment'}`, due_in_days: Math.round(PRODUCTION_DAYS[j] * scale) }));
    const last = Math.max(8, ...production.map((t) => t.due_in_days));
    const general = [
      { title: 'Kickoff call — confirm brief, sizing and references', milestone: 'Kickoff', due_in_days: 2 },
      { title: 'Collect outstanding information from client', milestone: 'Kickoff', due_in_days: 3 },
      { title: 'Internal technical review of all deliverables', milestone: 'Review', due_in_days: last + 2 },
      { title: 'Client review and revision round', milestone: 'Review', due_in_days: last + 5 },
      { title: 'Issue final invoice', milestone: 'Delivery', due_in_days: last + 6 },
      { title: 'Release final files and hand over', milestone: 'Delivery', due_in_days: last + 8 },
    ];
    const a = await call(ctx, 'create_tasks', { tasks: general });
    const b = await call(ctx, 'create_production_tasks', { tasks: production });
    const start = Date.parse(p.started_at || new Date(ctx.now()).toISOString());
    return {
      tasks_created: a.created, production_tasks_created: b.created,
      proposed_due_date: p.client_facing_due_date ? null : new Date(start + (last + 8) * 86400e3).toISOString().slice(0, 10),
      notes: b.refused.length ? `Refused: ${b.refused.join('; ')}` : '',
    };
  },
  async check_deadlines(ctx) {
    const tasks = await call(ctx, 'list_tasks');
    const overdue = tasks.filter((t) => t.due_date && t.due_date < ctx.input.date && !['done', 'proposed'].includes(t.status));
    for (const t of overdue) {
      await call(ctx, 'request_human_review', { kind: 'escalation', title: `Overdue: ${t.title}`, detail: `Due ${t.due_date}, status ${t.status}. Update the task or its due date.`, ref: `overdue:t${t.task_id}:${t.due_date}` }, { effectKey: `overdue:t${t.task_id}:${t.due_date}` });
    }
    return { overdue: overdue.length };
  },
  async completion_summary(ctx) {
    const p = await call(ctx, 'get_project');
    const tasks = await call(ctx, 'list_tasks');
    const deliverables = await call(ctx, 'list_deliverables');
    const fin = await call(ctx, 'get_finance_summary');
    const released = deliverables.filter((d) => d.status === 'released');
    const revisions = deliverables.reduce((s, d) => s + Math.max(0, d.version - 1), 0);
    const days = p.started_at ? Math.round((ctx.now() - Date.parse(p.started_at)) / 86400e3) : null;
    const money = (c) => `$${(c / 100).toFixed(2)}`;
    const summary = [
      `${p.code} — ${p.name}`,
      `Delivered ${released.length} file(s): ${released.map((d) => `${d.title} (v${d.version})`).join('; ') || 'none'}.`,
      `${tasks.filter((t) => t.status === 'done').length} of ${tasks.length} tasks done; ${revisions} revised version(s).`,
      days !== null ? `${days} day(s) from deposit to completion.` : '',
      `Quoted ${money(fin.profitability.quoted)}, collected ${money(fin.profitability.collected)}, costs ${money(fin.profitability.costs)}, profit ${money(fin.profitability.projectedProfit)}.`,
    ].filter(Boolean).join('\n');
    return { summary, tasks_done: tasks.filter((t) => t.status === 'done').length, deliverables_released: released.length, revisions };
  },
};

const production = {
  async prepare(ctx) {
    const p = await call(ctx, 'get_project');
    const tasks = (await call(ctx, 'list_tasks')).filter((t) => t.kind === 'production' && !t.route);
    const openQuestions = [];
    if (!p.target_measurements_and_sizing) openQuestions.push('Target measurements and size range not provided.');
    if (!p.fabric_preferences) openQuestions.push('Fabric and materials not provided.');
    const items = [];
    for (const row of tasks) {
      const t = await call(ctx, 'get_task', { task_id: row.task_id });
      const brief = [
        `TASK\n${t.job_label} for ${p.code} (${p.garment_category || 'garment'}).`,
        `CONTEXT\n${p.description || 'See the project brief.'}`,
        `SIZING & MEASUREMENTS\n${p.target_measurements_and_sizing || 'Not provided — work to the studio\'s confirmed base size; ask before assuming.'}`,
        `FABRIC & MATERIALS\n${p.fabric_preferences || 'Not provided — confirm with the studio.'}`,
        `DELIVERABLE\nOne final file meeting every checklist item below. Name files with the project code ${p.code}.`,
        `OPEN QUESTIONS\n${openQuestions.length ? openQuestions.map((q) => `- ${q}`).join('\n') : '- None identified.'}`,
      ].join('\n\n');
      await call(ctx, 'save_technical_brief', { task_id: t.task_id, brief, checklist: [] }, { effectKey: `save_technical_brief:${t.task_id}` });
      const route = t.allowed_routes.find((r) => r === 'index_v3' || r === 'form') || 'contractor';
      await call(ctx, 'set_task_route', { task_id: t.task_id, route }, { effectKey: `set_task_route:${t.task_id}` });
      if (route === 'index_v3' || route === 'form') await call(ctx, 'submit_to_integration', { task_id: t.task_id });
      items.push({ task_id: t.task_id, route });
    }
    return { items, open_questions: openQuestions };
  },
  async poll(ctx) {
    const r = await call(ctx, 'refresh_integration_job', { integration_job_id: ctx.input.integration_job_id });
    if (r.status === 'queued' || r.status === 'running') {
      throw new Reschedule(Math.min(30 * 60e3, 60e3 * 2 ** Math.min(5, ctx.job.reschedules)), `external job ${r.status}`);
    }
    if (r.status === 'failed') {
      await call(ctx, 'request_human_review', { kind: 'escalation', title: 'External production job failed', detail: 'Re-submit it, or route the task to a contractor or the studio.', ref: `external_failed:ij${ctx.input.integration_job_id}` });
    }
    return { status: r.status };
  },
};

const talent = {
  async recommend(ctx) {
    const p = await call(ctx, 'get_project');
    const t = await call(ctx, 'get_task', { task_id: ctx.input.task_id });
    if (t.route !== 'contractor') return { recommended_contractor_id: null, estimated_hours: null, escalated: false, notes: 'Task is not routed to a contractor.' };
    const candidates = await call(ctx, 'search_contractors', { task_id: t.task_id });
    const pick = candidates.find((c) => c.available);
    if (!pick) {
      await call(ctx, 'request_human_review', {
        kind: 'escalation', title: `Find a contractor for ${t.job_label} (${p.code})`, ref: `find_contractor:t${t.task_id}`,
        detail: candidates.length ? `Approved contractors with this skill are at capacity: ${candidates.map((c) => c.name).join(', ')}.` : 'No approved contractor on the roster has this skill. Approve one on the Contractors page.',
      });
      return { recommended_contractor_id: null, estimated_hours: null, escalated: true, notes: 'No available approved contractor.' };
    }
    const hours = Math.round((HOURS[t.job_type] || 8) * (p.package === 'collection' ? 1.5 : 1) * 2) / 2;
    const rationale = `${pick.name} is approved for ${t.job_label.toLowerCase()}${pick.category_match ? ` and works in ${p.garment_category.toLowerCase()}` : ''}; ${pick.completed_assignments} completed assignment(s) with the studio; ${pick.active_assignments} of ${pick.capacity} slots in use.`;
    await call(ctx, 'recommend_contractor', { task_id: t.task_id, contractor_id: pick.contractor_id, estimated_hours: hours, rationale });
    return { recommended_contractor_id: pick.contractor_id, estimated_hours: hours, escalated: false, notes: 'Rules-based match: first available approved contractor.' };
  },
};

/** Byte-level checks; the file is inspected in an isolated process, never executed. */
function fileChecks(d, report) {
  const checks = [];
  const add = (name, status, detail = '') => checks.push({ name, status, detail });
  if (!report.present) { add('file_present', 'fail', 'No file attached.'); return checks; }
  add('file_present', 'pass');
  add('integrity', report.integrity_ok ? 'pass' : 'fail', report.integrity_ok ? '' : 'Stored bytes do not match the uploaded checksum.');
  add('not_empty', report.size > 0 ? 'pass' : 'fail');
  if (report.type === 'pdf') {
    add('pdf_pages', report.pdf.pages > 0 ? 'pass' : 'warn', `${report.pdf.pages} page(s) detected`);
    add('pdf_not_encrypted', report.pdf.encrypted ? 'fail' : 'pass');
    add('pdf_no_active_content', report.pdf.active_content ? 'fail' : 'pass', report.pdf.active_content ? 'PDF contains JavaScript, launch actions or embedded files.' : '');
  }
  if (TECHNICAL_TYPES.has(d.type)) {
    const wants = d.type === '3d' ? ['glb', 'zip', 'pdf', 'png', 'jpeg', 'webp'] : ['pdf', 'png', 'jpeg', 'webp'];
    add('format', wants.includes(report.type) ? 'pass' : (report.type === 'unknown' ? 'warn' : 'fail'), `Detected ${report.type}`);
    if (d.source === 'index_v3') {
      const passed = /Validation: passed/.test(d.notes || '');
      add('index_validation', passed ? 'pass' : 'fail', passed ? 'INDEX V3 validation passed.' : 'INDEX V3 did not report a passing validation.');
    }
  } else {
    const isImage = ['png', 'jpeg', 'webp'].includes(report.type);
    add('format', isImage || report.type === 'pdf' ? 'pass' : 'fail', `Detected ${report.type}`);
    if (isImage && report.image) {
      const edge = Math.max(report.image.width || 0, report.image.height || 0);
      const min = d.type === 'design' ? 1000 : 2000;
      add('resolution', edge >= min ? 'pass' : 'warn', `${report.image.width}×${report.image.height}px (long edge ${min}px+ expected)`);
    }
  }
  return checks;
}

const qa = {
  async check(ctx) {
    const d = (await call(ctx, 'list_deliverables')).find((x) => x.deliverable_id === ctx.input.deliverable_id);
    if (!d || d.version !== ctx.input.version) return { result: 'superseded', failed: 0, warnings: 0, missing_information: [] };
    const t = d.task_id ? await call(ctx, 'get_task', { task_id: d.task_id }) : null;
    const report = await call(ctx, 'inspect_deliverable', { deliverable_id: d.deliverable_id });
    const checks = fileChecks(d, report);
    // The rules brain cannot read file contents, so each checklist item is left for the reviewer.
    for (const item of (t && t.checklist) || []) checks.push({ name: `checklist: ${item}`.slice(0, 120), status: 'warn', detail: 'Reviewer to confirm (rules QA cannot read the file\'s contents).' });
    const failed = checks.filter((c) => c.status === 'fail').length;
    const warnings = checks.filter((c) => c.status === 'warn').length;
    const result = failed ? 'fail' : warnings ? 'warn' : 'pass';
    const r = await call(ctx, 'record_qa_report', { deliverable_id: d.deliverable_id, version: d.version, result, checks, missing_information: [] });
    return { result: r.result, failed, warnings, missing_information: [] };
  },
};

const orchestrator = {
  async verify_deposit_invoice(ctx) {
    const fin = await call(ctx, 'get_finance_summary');
    const deposit = fin.invoices.find((i) => i.kind === 'deposit' && i.status !== 'void');
    const expected = fin.accepted_quote ? fin.accepted_quote.deposit_cents : null;
    const ok = Boolean(deposit && expected !== null && deposit.amount_cents === expected);
    if (!ok) {
      await call(ctx, 'request_human_review', {
        kind: 'escalation', title: 'Deposit invoice does not match the accepted quote', ref: 'deposit_mismatch',
        detail: `Expected ${expected === null ? 'an accepted quote' : `$${(expected / 100).toFixed(2)}`}; found ${deposit ? `$${(deposit.amount_cents / 100).toFixed(2)} (${deposit.status})` : 'no deposit invoice'}.`,
      });
    }
    return { invoice_id: deposit ? deposit.id : null, amount_ok: ok, status: deposit ? deposit.status : 'missing' };
  },
  async prepare_final_invoice(ctx) {
    await call(ctx, 'get_finance_summary');
    const r = await call(ctx, 'draft_final_invoice');
    if (r.invoice_id) {
      await call(ctx, 'request_human_review', {
        kind: 'approval', title: `Approve the final invoice ($${(r.amount_cents / 100).toFixed(2)})`, ref: `approve_invoice:i${r.invoice_id}`,
        detail: 'All final deliverables are signed off. Issuing the invoice makes it payable in the client portal; final files stay held until it is paid.',
      });
    }
    return { invoice_id: r.invoice_id, amount_cents: r.amount_cents };
  },
  async record_performance(ctx) {
    const { profitability: p } = await call(ctx, 'get_finance_summary');
    return { quoted_cents: p.quoted, collected_cents: p.collected, costs_cents: p.costs, profit_cents: p.projectedProfit, margin: p.projectedMargin === null ? null : Math.round(p.projectedMargin * 1000) / 1000 };
  },
};

// ── Command Agent (Morning Brief) ────────────────────────────────────
const BRIEF_SECTIONS = [
  ['Money', ['payment', 'payment_exception', 'cost']],
  ['Needs you', ['state']],
  ['Production', ['assignment', 'qa', 'deliverable', 'message']],
  ['Agents', ['failure']],
  ['Pipeline', ['inquiry', 'quote', 'stage']],
];
const command = {
  /** Compiled from the facts without a model: every line is a fact, cited. */
  async morning_brief(ctx) {
    const { facts } = await call(ctx, 'get_brief_facts');
    const of = (kinds) => facts.filter((f) => kinds.includes(f.kind));
    const sections = BRIEF_SECTIONS.map(([title, kinds]) => ({
      title,
      items: of(kinds).filter((f) => f.kind !== 'state' || f.severity !== 'info' || /approval/.test(f.text)).slice(-8).map((f) => ({ text: f.text, fact_ids: [f.id] })),
    })).filter((s) => s.items.length);
    const payments = of(['payment']);
    const urgent = facts.filter((f) => f.severity === 'urgent');
    const approvals = facts.find((f) => f.ref === 'state:approvals');
    const parts = [];
    const cited = [];
    if (payments.length) { parts.push(`${payments.length} payment(s) received`); cited.push(...payments.map((f) => f.id)); }
    if (approvals) { parts.push(approvals.text.replace(/ for your approval$/, '')); cited.push(approvals.id); }
    if (urgent.length) { parts.push(`${urgent.length} urgent item(s)`); cited.push(...urgent.map((f) => f.id)); }
    const headline = parts.length ? { text: `${parts.join(' · ')}.`, fact_ids: cited.slice(0, 10) } : { text: 'A quiet period: nothing new since the last brief.', fact_ids: facts.length ? [facts[facts.length - 1].id] : [] };
    const actions = [];
    if (approvals && approvals.severity !== 'info') actions.push({ text: 'Review the items waiting in Approvals.', fact_ids: [approvals.id], action_type: null, target_id: null });
    for (const f of of(['failure']).slice(0, 3)) {
      const id = Number(String(f.ref).split(':')[1]);
      actions.push({ text: 'Retry the failed agent task, or cancel it and handle the step yourself.', fact_ids: [f.id], action_type: 'retry_task', target_id: Number.isInteger(id) && id > 0 ? id : null });
    }
    return { headline, sections, actions: actions.slice(0, 6) };
  },
};

module.exports = { POLICIES: { sales, client_success, project_manager, production, talent, qa, orchestrator, command }, TECHNICAL_TYPES, fileChecks, HOURS };
