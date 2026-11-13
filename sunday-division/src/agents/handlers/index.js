'use strict';
const { Reschedule } = require('../../orchestrator/errors');
const catalog = require('../../services/catalog');

/**
 * Agent handlers. Each receives ctx = { input, tools, job, now } and may act only through
 * ctx.tools.call(), which enforces the agent's policy. Arithmetic on money and every
 * workflow decision stay in deterministic code; the model only supplies drafted content.
 */
const call = (ctx, name, args) => ctx.tools.call(name, args);
const DELIVERABLE_TO_PRODUCTION = {
  flats: ['index_v3', 'technical_flats', 'Technical flats'],
  techpack: ['index_v3', 'tech_pack', 'Tech pack'],
  '3d': ['index_v3', 'garment_3d', '3D garment'],
  imagery: ['form', 'product_imagery', 'Product imagery'],
  campaign: ['form', 'campaign_assets', 'Campaign assets'],
  design: [null, 'design', 'Design development'],
};
const TECHNICAL_TYPES = new Set(['flats', 'techpack', '3d']);

const sales_intake = {
  async triage(ctx) {
    await call(ctx, 'inquiry.read');
    const r = await call(ctx, 'model.triage');
    await call(ctx, 'inquiry.saveTriage', { triage: r.data, source: r.source });
    return {
      qualified: r.data.qualified !== false, qualification_note: String(r.data.qualification_note || '').slice(0, 1000),
      suggested_package: r.data.suggested_package, services: (r.data.services || []).slice(0, 4), priority: r.data.priority,
      missing_count: (r.data.missing_information || []).length, risk_flags: (r.data.risk_flags || []).slice(0, 20).map((f) => String(f).slice(0, 400)), source: r.source,
    };
  },

  async draft_proposal(ctx) {
    const project = await call(ctx, 'project.read');
    const inquiry = await call(ctx, 'inquiry.read');
    const existing = (await call(ctx, 'quotes.read'))[0];
    if (existing) {
      // Someone already wrote a quote: leave it alone, but make sure it reaches the approval queue.
      if (existing.status === 'draft') {
        await call(ctx, 'humanQueue.create', { kind: 'approval', key: 'approve_quote', link: `/admin/projects/${project.id}#quote`, title: `Review and approve the quote for ${project.code}`, detail: 'Drafted by staff before the Sales agent ran; the agent did not change it.' });
      }
      return { quote_id: existing.id, skipped: true, total_cents: existing.total_cents, below_floor: false, flags: [`A ${existing.status} quote already exists; not drafting another.`] };
    }

    const brief = await call(ctx, 'model.brief');
    await call(ctx, 'brief.draft', { text: brief.text, source: brief.source });
    const q = await call(ctx, 'model.quote');
    const saved = await call(ctx, 'quote.draft', { input: q.input, source: q.source });
    if (saved.skipped) return { quote_id: saved.quote_id, skipped: true, total_cents: 0, below_floor: false, flags: [saved.reason] };

    // Deterministic checks on what the model proposed.
    const total = q.input.line_items.reduce((s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)) * Math.max(0, Math.round(Number(i.unit_cents) || 0)), 0);
    const pkg = catalog.packageById(project.package) || catalog.packageById((inquiry.triage || {}).suggested_package);
    const flags = [...((inquiry.triage && inquiry.triage.risk_flags) || [])];
    const belowFloor = Boolean(pkg && total < pkg.fromCents);
    if (belowFloor) flags.unshift(`Quote total is below the ${pkg.name} starting price.`);
    if (q.source === 'rules') flags.push('Drafted by rules (model not used) — check pricing against the brief.');

    await call(ctx, 'humanQueue.create', {
      kind: 'approval', key: 'approve_quote', link: `/admin/projects/${project.id}#quote`,
      title: `Review and approve the quote for ${project.code}${flags.length ? ` — ${flags.length} flag${flags.length > 1 ? 's' : ''}` : ''}`,
      detail: flags.length ? flags.join('\n') : 'No flags raised. Check scope, pricing and terms before approving.',
    });
    return { quote_id: saved.quote_id, skipped: false, total_cents: total, below_floor: belowFloor, flags: flags.slice(0, 20).map((f) => String(f).slice(0, 400)) };
  },
};

const project_manager = {
  async plan(ctx) {
    const project = await call(ctx, 'project.read');
    const inquiry = await call(ctx, 'inquiry.read');
    const r = await call(ctx, 'model.plan');
    const created = await call(ctx, 'tasks.createPlan', { tasks: r.tasks, source: r.source });

    // Production plan from the requested deliverables (validated catalogue ids), not from model text.
    const plan = [];
    for (const d of inquiry.deliverables || []) {
      const entry = DELIVERABLE_TO_PRODUCTION[d];
      if (entry) plan.push({ product: entry[0], job_type: entry[1], label: entry[2] });
    }
    for (const item of plan.filter((p) => p.product === null)) {
      await call(ctx, 'humanQueue.create', {
        kind: 'production', key: `studio:${item.job_type}`, link: `/admin/projects/${project.id}#deliverables`,
        title: `${item.label} for ${project.code} — studio designer`, detail: 'Neither INDEX V3 nor FORM covers this work. Assign a designer and upload the result as a deliverable.',
      });
    }
    // The client-visible delivery date is a commitment: propose it, never set it.
    const lastDue = r.tasks.map((t) => t.due_date).filter(Boolean).sort().pop() || null;
    if (lastDue && !project.due_date) {
      await call(ctx, 'humanQueue.create', {
        kind: 'approval', key: 'confirm_due_date', link: `/admin/projects/${project.id}`,
        title: `Confirm a target delivery date for ${project.code}`, detail: `The working plan finishes on ${lastDue}. Set the date on the project if you agree; it becomes visible to the client.`,
      });
    }
    return { tasks_created: created.created, production_plan: plan, proposed_due_date: lastDue };
  },

  async check_deadlines(ctx) {
    const tasks = await call(ctx, 'tasks.read');
    const today = ctx.input.date;
    const overdue = tasks.filter((t) => t.due_date && t.due_date < today && !['done', 'proposed'].includes(t.status));
    for (const t of overdue) {
      await call(ctx, 'humanQueue.create', {
        kind: 'escalation', key: `overdue:t${t.id}:${t.due_date}`, link: `/admin/projects/${ctx.input.project_id}#tasks`,
        title: `Overdue: ${t.title}`, detail: `Due ${t.due_date}, status ${t.status}. Update the task or its due date.`,
      });
    }
    return { overdue: overdue.length };
  },

  async completion_summary(ctx) {
    const project = await call(ctx, 'project.read');
    const tasks = await call(ctx, 'tasks.read');
    const deliverables = await call(ctx, 'deliverables.read');
    const fin = await call(ctx, 'finance.read');
    const released = deliverables.filter((d) => d.status === 'released');
    const revisions = deliverables.reduce((s, d) => s + Math.max(0, d.version - 1), 0);
    const days = project.started_at ? Math.round((ctx.now() - Date.parse(project.started_at)) / 86400e3) : null;
    const money = (c) => `$${(c / 100).toFixed(2)}`;
    const summary = [
      `${project.code} — ${project.name}`,
      `Delivered ${released.length} file(s): ${released.map((d) => `${d.title} (v${d.version})`).join('; ') || 'none'}.`,
      `${tasks.filter((t) => t.status === 'done').length} of ${tasks.length} tasks done; ${revisions} revised version(s).`,
      days !== null ? `${days} day(s) from deposit to completion.` : '',
      `Quoted ${money(fin.profitability.quoted)}, collected ${money(fin.profitability.collected)}, costs ${money(fin.profitability.costs)}, profit ${money(fin.profitability.projectedProfit)}.`,
    ].filter(Boolean).join('\n');
    return { summary, tasks_done: tasks.filter((t) => t.status === 'done').length, deliverables_released: released.length, revisions };
  },
};

function coordinator(product) {
  return {
    async route(ctx) {
      const plan = (await call(ctx, 'workflow.readPlan')).filter((p) => p.product === product);
      const status = await call(ctx, 'integrations.status');
      const connected = (status.products.find((p) => p.id === product) || {}).connected;
      const items = [];
      for (const item of plan) {
        let reason = !status.autonomous_production ? 'autonomous production is off' : !connected ? 'service not connected' : '';
        if (!reason) {
          try {
            await call(ctx, 'production.submit', { product, jobType: item.job_type, notes: item.label });
            items.push({ job_type: item.job_type, route: 'api', reason: 'submitted' });
            continue;
          } catch (err) {
            if (err.kind !== 'budget') throw err;
            reason = 'external budget reached';
            await call(ctx, 'humanQueue.create', { kind: 'escalation', key: `budget:${product}:${item.job_type}`, link: `/admin/ops/settings`, title: `External budget reached — ${item.label} routed to a person`, detail: err.message });
          }
        }
        await call(ctx, 'production.queueHuman', { product, jobType: item.job_type, notes: `${item.label} (${reason})` });
        items.push({ job_type: item.job_type, route: 'human', reason });
      }
      return { submitted: items.filter((i) => i.route === 'api').length, routed_to_human: items.filter((i) => i.route === 'human').length, items };
    },
    async poll(ctx) {
      const r = await call(ctx, 'production.refresh', { integrationJobId: ctx.input.integration_job_id });
      if (r.status === 'queued' || r.status === 'running') {
        throw new Reschedule(Math.min(30 * 60e3, 60e3 * 2 ** Math.min(5, ctx.job.reschedules)), `external job ${r.status}`);
      }
      if (r.status === 'failed') {
        await call(ctx, 'humanQueue.create', { kind: 'escalation', key: `external_failed:ij${ctx.input.integration_job_id}`, link: `/admin/projects/${ctx.input.project_id}#production`, title: 'External production job failed', detail: 'Re-submit, or produce the work by hand.' });
      }
      return { status: r.status };
    },
  };
}

/** Byte-level checks only; files are inspected in an isolated process, never executed. */
function qaChecks(kind, d, report) {
  const checks = [];
  const add = (name, status, detail = '') => checks.push({ name, status, detail });
  if (!report.present) { add('file_present', 'fail', 'No file attached.'); return checks; }
  add('file_present', 'pass');
  add('integrity', report.sha256 === report.expected_sha256 ? 'pass' : 'fail', report.sha256 === report.expected_sha256 ? '' : 'Stored bytes do not match the uploaded checksum.');
  add('not_empty', report.size > 0 ? 'pass' : 'fail');
  if (report.type === 'pdf') {
    add('pdf_pages', report.pdf.pages > 0 ? 'pass' : 'warn', `${report.pdf.pages} page(s) detected`);
    add('pdf_not_encrypted', report.pdf.encrypted ? 'fail' : 'pass');
    add('pdf_no_active_content', report.pdf.active_content ? 'fail' : 'pass', report.pdf.active_content ? 'PDF contains JavaScript, launch actions or embedded files.' : '');
  }
  if (kind === 'technical') {
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

function qaAgent(kind) {
  return {
    async check(ctx) {
      const d = (await call(ctx, 'deliverables.read')).find((x) => x.id === ctx.input.deliverable_id);
      if (!d || d.version !== ctx.input.version) return { result: 'superseded', failed: 0, warnings: 0 };
      const report = await call(ctx, 'files.inspect', { deliverableId: d.id });
      const checks = qaChecks(kind, d, report);
      const failed = checks.filter((c) => c.status === 'fail').length;
      const warnings = checks.filter((c) => c.status === 'warn').length;
      const result = failed ? 'fail' : warnings ? 'warn' : 'pass';
      await call(ctx, 'qa.record', { deliverableId: d.id, version: d.version, result, checks });
      await call(ctx, 'humanQueue.create', {
        kind: 'review', key: `review:d${d.id}:v${d.version}`, link: `/admin/projects/${ctx.input.project_id}#deliverables`,
        title: `${result === 'fail' ? 'QA failed' : 'Review'}: ${d.title} v${d.version}`,
        detail: checks.filter((c) => c.status !== 'pass').map((c) => `${c.status.toUpperCase()} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join('\n') || 'All automated checks passed. A reviewer must still approve it.',
      });
      return { result, failed, warnings };
    },
  };
}

const finance_ops = {
  async verify_deposit_invoice(ctx) {
    const fin = await call(ctx, 'finance.read');
    const deposit = fin.invoices.find((i) => i.kind === 'deposit' && i.status !== 'void');
    const expected = fin.accepted_quote ? fin.accepted_quote.deposit_cents : null;
    const ok = Boolean(deposit && expected !== null && deposit.amount_cents === expected);
    if (!ok) {
      await call(ctx, 'humanQueue.create', {
        kind: 'escalation', key: 'deposit_mismatch', link: `/admin/projects/${ctx.input.project_id}#billing`,
        title: 'Deposit invoice does not match the accepted quote', detail: `Expected ${expected === null ? 'an accepted quote' : `$${(expected / 100).toFixed(2)}`}; found ${deposit ? `$${(deposit.amount_cents / 100).toFixed(2)} (${deposit.status})` : 'no deposit invoice'}.`,
      });
    }
    return { invoice_id: deposit ? deposit.id : null, amount_ok: ok, status: deposit ? deposit.status : 'missing' };
  },
  async prepare_final_invoice(ctx) {
    await call(ctx, 'finance.read');
    const r = await call(ctx, 'invoice.draftFinal');
    if (r.invoice_id) {
      await call(ctx, 'humanQueue.create', {
        kind: 'approval', key: `approve_invoice:i${r.invoice_id}`, link: `/admin/projects/${ctx.input.project_id}#billing`,
        title: `Approve the final invoice ($${(r.amount_cents / 100).toFixed(2)})`, detail: 'All final deliverables are approved. Issuing the invoice makes it payable in the client portal; final files stay held until it is paid.',
      });
    }
    return { invoice_id: r.invoice_id, amount_cents: r.amount_cents };
  },
  async record_performance(ctx) {
    const { profitability: p } = await call(ctx, 'finance.read');
    return { quoted_cents: p.quoted, collected_cents: p.collected, costs_cents: p.costs, profit_cents: p.projectedProfit, margin: p.projectedMargin === null ? null : Math.round(p.projectedMargin * 1000) / 1000 };
  },
};

const client_success = {
  async quote_notice(ctx) {
    const project = await call(ctx, 'project.read');
    const quote = (await call(ctx, 'quotes.read')).find((q) => q.status === 'sent');
    const portal = await call(ctx, 'client.portalStatus');
    if (!quote) return { task_id: null, needs_portal_key: !portal.has_portal_key };
    const t = await call(ctx, 'humanQueue.create', {
      kind: 'communication', key: `notify_quote:q${quote.id}`, link: `/admin/projects/${project.id}`,
      title: portal.has_portal_key ? `Tell ${portal.brand_name} their quote is ready in the portal` : `Issue a portal key for ${portal.brand_name} and send them the portal link`,
      detail: `Quote v${quote.version} is visible in the client portal. Automated client email is not enabled, so send this yourself.`,
    });
    return { task_id: t.task_id, needs_portal_key: !portal.has_portal_key };
  },
  async kickoff_update(ctx) {
    const project = await call(ctx, 'project.read');
    const r = await call(ctx, 'model.statusUpdate', { note: 'Deposit received; the project has started. Do not mention a delivery date unless one is set on the project.' });
    const saved = await call(ctx, 'statusUpdate.draft', { text: r.text, source: r.source });
    await call(ctx, 'humanQueue.create', {
      kind: 'approval', key: `publish_update:u${saved.update_id}`, link: `/admin/projects/${project.id}#updates`,
      title: `Publish the kickoff update for ${project.code}`, detail: 'Drafted automatically. Edit if needed, then publish it to the client portal.',
    });
    return { update_id: saved.update_id };
  },
};

module.exports = {
  HANDLERS: {
    sales_intake, project_manager, finance_ops, client_success,
    index_coordinator: coordinator('index_v3'),
    form_coordinator: coordinator('form'),
    technical_qa: qaAgent('technical'),
    creative_qa: qaAgent('creative'),
  },
  TECHNICAL_TYPES, DELIVERABLE_TO_PRODUCTION, qaChecks,
};
