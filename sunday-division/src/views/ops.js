'use strict';
const { html, raw, money, fmtDate, titleCase } = require('../lib/util');
const { shell } = require('./admin');
const { REGISTRY } = require('../agents/definitions');
const { TOOLS } = require('../agents/tools');

const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ''}">`;
const usd = (micros) => `$${(micros / 1e6).toFixed(micros && micros < 1e4 ? 4 : 2)}`;
const hrs = (h) => (h === null || h === undefined ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const ATTN = new Set(['failed', 'open', 'queued', 'needs_review', 'awaiting_quote_approval', 'quote_declined', 'ready_for_release', 'escalation', 'budget_blocked', 'denied', 'invalid_output', 'error']);
const MUTED = new Set(['succeeded', 'completed', 'done', 'cancelled', 'dismissed', 'ok', 'executed', 'replayed', 'lost']);
const badge = (s, label) => html`<span class="badge ${ATTN.has(s) ? 'badge--on' : MUTED.has(s) ? 'badge--off' : ''}">${label || titleCase(s)}</span>`;
const btn = (ctx, url, label, { solid = false, confirm = '' } = {}) => html`<form class="inline" method="post" action="${url}" data-confirm="${confirm}">${csrf(ctx)}<button class="btn-a ${solid ? 'btn-a--solid' : ''}" type="submit">${label}</button></form>`;
const tabs = (path) => html`<nav class="tabs">${[['/admin/ops', 'Overview'], ['/admin/ops/tasks', 'Agent tasks'], ['/admin/ops/agents', 'Agents'], ['/admin/ops/settings', 'Controls & budgets']].map(([href, label]) => html`<a href="${href}" ${path === href ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>`;
const empty = (t) => html`<p class="empty">${t}</p>`;
const json = (v) => html`<pre class="json">${JSON.stringify(v, null, 2)}</pre>`;

function wfLabel(STATES, state) { return (STATES[state] || { label: state }).label; }

function overview(ctx, d) {
  const o = d.overview;
  const STATES = ctx.app.orchestrator.STATES;
  const stat = (label, value, note = '') => html`<div class="stat"><span class="stat__v">${value}</span><span class="label">${label}</span>${note ? html`<span class="muted small">${note}</span>` : ''}</div>`;
  return shell(ctx, {
    title: 'Operations', path: '/admin/ops',
    body: html`<header class="a-head"><div><h1 class="display display--m">Operations</h1><p class="muted">Agent workflows, the human queue, and what automation costs.</p></div>
  <div class="a-head__actions">${d.paused ? badge('failed', 'All automation paused') : badge('succeeded', 'Automation running')}${btn(ctx, '/admin/ops/run', 'Run pending work now')}</div></header>
${tabs('/admin/ops')}
<div class="stats">
  ${stat('Active workflows', o.activeWorkflows, `${o.pausedWorkflows} paused`)}
  ${stat('Blocked', o.blockedWorkflows, 'failed step needs a person')}
  ${stat('Human queue', o.openHumanTasks, o.openByKind.map((k) => `${k.n} ${k.kind}`).join(' · '))}
  ${stat('Agent jobs', `${o.jobs.queued + o.jobs.running}`, `${o.jobs.queued} queued · ${o.jobs.running} running · ${o.jobs.failed} failed`)}
  ${stat('AI spend this month', usd(o.aiSpentMonthMicros), `of $${o.aiBudgetMonthUsd.toFixed(2)} budget${o.budgetBlocked ? ` · ${o.budgetBlocked} calls blocked` : ''}`)}
  ${stat('External services', usd(o.externalSpentMonthMicros), 'this month (estimated where not reported)')}
  ${stat('Automation rate', pct(o.automationRate), `${o.automationBasis.agentSteps} agent steps · ${o.automationBasis.routineHumanSteps} routine human steps`)}
</div>
<div class="stats stats--small">
  ${stat('Inquiry → draft quote', hrs(o.turnaround.toDraftQuote))}
  ${stat('Inquiry → quote sent', hrs(o.turnaround.toQuoteSent))}
  ${stat('Deposit → production routed', hrs(o.turnaround.depositToProduction))}
  ${stat('Inquiry → completed', hrs(o.turnaround.toCompletion))}
</div>
<div class="a-cols a-cols--wide">
<div>
  <section class="card"><h2>Workflows</h2>
  ${d.workflows.length ? html`<table class="a-table a-table--tight"><thead><tr><th>#</th><th>Lead / project</th><th>State</th><th>Waiting on</th><th class="r">Jobs</th><th class="r">Tasks</th><th>Updated</th></tr></thead><tbody>
  ${d.workflows.map((w) => html`<tr>
    <td><a class="mono" href="/admin/ops/workflows/${w.id}">${w.id}</a></td>
    <td><a href="/admin/ops/workflows/${w.id}">${w.project_code || w.inquiry_ref}</a> <span class="muted">${w.brand_name || ''}</span></td>
    <td>${badge(w.state, wfLabel(STATES, w.state))} ${w.paused ? badge('failed', 'Paused') : ''} ${w.blocked_reason ? badge('failed', 'Blocked') : ''}</td>
    <td class="small">${(STATES[w.state] || {}).waiting || ''}</td>
    <td class="r">${w.pending_jobs}</td><td class="r">${w.open_tasks}</td><td class="small">${fmtDate(w.updated_at, true)}</td>
  </tr>`)}</tbody></table>` : empty('No workflows yet. One starts automatically for every project inquiry.')}
  </section>
  <section class="card"><h2>Failed jobs <span class="count">${d.failed.length}</span></h2>
  ${d.failed.length ? html`<ul class="log log--stack">${d.failed.map((j) => html`<li><span>${badge('failed')} <strong>${j.agent}.${j.action}</strong> <span class="muted">#${j.id} · ${j.attempts} attempt(s) · ${j.error_kind}</span> ${j.workflow_id ? html`· <a href="/admin/ops/workflows/${j.workflow_id}">workflow ${j.workflow_id}</a>` : ''}</span>
    <span class="small">${j.error}</span><span class="a-actions">${btn(ctx, `/admin/ops/jobs/${j.id}/retry`, 'Retry', { solid: true })}${btn(ctx, `/admin/ops/jobs/${j.id}/cancel`, 'Handle by hand', { confirm: 'Cancel this job? The workflow treats the step as handled by a person.' })}</span></li>`)}</ul>` : empty('No failed jobs.')}
  </section>
  <section class="card"><h2>Project profitability</h2>
  ${d.profit.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Project</th><th class="r">Quoted</th><th class="r">Collected</th><th class="r">People costs</th><th class="r">Automation</th><th class="r">Margin</th></tr></thead><tbody>
  ${d.profit.map((p) => html`<tr><td><a href="/admin/projects/${p.id}">${p.code}</a> <span class="muted">${p.brand_name}</span></td><td class="r">${money(p.money.quoted)}</td><td class="r">${money(p.money.collected)}</td><td class="r">${money(p.money.manualCosts)}</td><td class="r">${money(p.money.automationCosts)}</td><td class="r">${pct(p.money.projectedMargin)}</td></tr>`)}</tbody></table>` : empty('No projects yet.')}
  </section>
</div>
<div>
  <section class="card"><h2>Human queue <span class="count">${d.tasks.length}</span></h2>
  ${d.tasks.length ? html`<ul class="log log--stack">${d.tasks.map((t) => html`<li>
    <span>${badge(t.kind === 'escalation' ? 'escalation' : 'queued', titleCase(t.kind))} ${t.link ? html`<a href="${t.link}">${t.title}</a>` : t.title}</span>
    ${t.detail ? html`<span class="small muted pre">${t.detail}</span>` : ''}
    <span class="small muted">${t.project_code || ''} · from ${t.created_by.replace('agent:', '')} · ${fmtDate(t.created_at, true)}</span>
    <span class="a-actions">${btn(ctx, `/admin/ops/tasks/${t.id}/done`, 'Done')}${btn(ctx, `/admin/ops/tasks/${t.id}/dismiss`, 'Dismiss')}</span></li>`)}</ul>` : empty('Nothing needs a person right now.')}
  </section>
  <section class="card"><h2>Recent agent jobs</h2>
  <ul class="log log--history">${d.recent.map((j) => html`<li><span>${badge(j.status)} ${j.agent}.${j.action}</span><span class="mono">#${j.id}</span><span class="muted">${j.workflow_id ? `workflow ${j.workflow_id} · ` : ''}${j.attempts} attempt(s)${j.error ? ` · ${j.error}` : ''}</span></li>`)}</ul>
  </section>
</div>
</div>`,
  });
}

function workflow(ctx, d) {
  const { wf, project, inquiry } = d;
  const STATES = ctx.app.orchestrator.STATES;
  const terminal = (STATES[wf.state] || {}).terminal;
  return shell(ctx, {
    title: `Workflow ${wf.id}`, path: '/admin/ops',
    body: html`<header class="a-head">
  <div><p class="label"><a href="/admin/ops">Operations</a> / Workflow ${wf.id}</p>
    <h1 class="display display--m">${project ? `${project.code} — ${project.name}` : `${inquiry.ref} — ${inquiry.brand_name}`}</h1>
    <p class="muted">${badge(wf.state, wfLabel(STATES, wf.state))} ${(STATES[wf.state] || {}).waiting || ''}</p></div>
  <div class="a-head__actions">
    ${project ? html`<a class="btn-a" href="/admin/projects/${project.id}">Project</a>` : ''}${inquiry ? html`<a class="btn-a" href="/admin/leads/${inquiry.id}">Lead</a>` : ''}
    ${terminal ? '' : wf.paused ? btn(ctx, `/admin/ops/workflows/${wf.id}/resume`, 'Resume', { solid: true }) : btn(ctx, `/admin/ops/workflows/${wf.id}/pause`, 'Pause', { confirm: 'Pause this workflow? No agent work runs for it until resumed.' })}
    ${terminal ? '' : btn(ctx, `/admin/ops/workflows/${wf.id}/advance`, 'Re-evaluate')}
    ${wf.state === 'needs_review' ? btn(ctx, `/admin/ops/workflows/${wf.id}/continue`, 'Pursue this lead', { solid: true, confirm: 'Continue to scoping and quote drafting?' }) : ''}
  </div>
</header>
${wf.blocked_reason ? html`<div class="a-flash a-flash--error"><strong>Blocked.</strong> ${wf.blocked_reason}</div>` : ''}
${wf.summary ? html`<section class="card"><h2>Completion summary</h2><pre class="json">${JSON.parse(wf.summary).summary || ''}</pre>${json(JSON.parse(wf.summary).performance)}</section>` : ''}
<div class="a-cols a-cols--wide">
<div>
  <section class="card"><h2>Jobs</h2>
  ${d.jobs.length ? html`<table class="a-table a-table--tight"><thead><tr><th>#</th><th>Agent · action</th><th>Status</th><th class="r">Tries</th><th>Run at / finished</th><th></th></tr></thead><tbody>
  ${d.jobs.map((j) => html`<tr>
    <td class="mono">${j.id}</td>
    <td><strong>${j.agent}.${j.action}</strong>${j.deps.length ? html`<br><span class="muted small">after #${j.deps.join(', #')}</span>` : ''}
      <details><summary class="small">input / output</summary>${json({ input: j.input, output: j.output })}</details>
      ${j.error ? html`<span class="small muted">${j.error_kind}: ${j.error}</span>` : ''}</td>
    <td>${badge(j.status)}<br><a class="small" href="/admin/ops/tasks/${j.id}">History</a></td><td class="r">${j.attempts}/${j.max_attempts}${j.reschedules ? ` · ${j.reschedules} waits` : ''}</td>
    <td class="small">${j.status === 'queued' ? fmtDate(j.run_at, true) : fmtDate(j.finished_at, true)}</td>
    <td>${['failed', 'cancelled'].includes(j.status) ? btn(ctx, `/admin/ops/jobs/${j.id}/retry`, 'Retry', { solid: true }) : ''}${j.status === 'failed' || j.status === 'queued' ? btn(ctx, `/admin/ops/jobs/${j.id}/cancel`, 'Handle by hand', { confirm: 'Cancel this job? The workflow treats the step as handled by a person.' }) : ''}</td>
  </tr>`)}</tbody></table>` : empty('No jobs yet.')}
  </section>
  <section class="card"><h2>Agent runs — model, version and cost</h2>
  ${d.runs.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Agent · task</th><th>Provider</th><th>Model / prompt</th><th class="r">Tokens</th><th class="r">Cost</th><th>Status</th></tr></thead><tbody>
  ${d.runs.map((r) => html`<tr><td>${r.agent} <span class="muted small">v${r.agent_version}</span><br><span class="small">${r.task}</span></td><td>${r.provider}</td>
    <td class="small mono">${r.model_served || r.model_requested || '—'}${r.provider === 'claude' ? html`<br>prompt ${r.prompt_version}` : ''}</td><td class="r small">${r.input_tokens} / ${r.output_tokens}</td><td class="r">${usd(r.cost_micros)}</td>
    <td>${badge(r.status)}${r.detail ? html`<br><span class="small muted">${r.detail}</span>` : ''}</td></tr>`)}</tbody></table>` : empty('No runs yet.')}
  </section>
  <section class="card"><h2>Tool calls</h2>
  ${d.toolCalls.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Job</th><th>Agent</th><th>Tool · effect</th><th>Decision</th><th>Detail</th></tr></thead><tbody>
  ${d.toolCalls.map((t) => html`<tr><td class="mono nowrap">#${t.job_id}</td><td>${t.agent.replace('_', ' ')}</td><td><span class="mono small">${t.tool}</span><br><span class="muted small">${t.effect}</span></td><td>${badge(t.decision)}</td><td class="small wrap">${t.detail}</td></tr>`)}</tbody></table>` : empty('No state-changing tool calls yet.')}
  </section>
</div>
<div>
  <section class="card"><h2>State history</h2>
  <ul class="log log--stack">${d.transitions.map((t) => html`<li><span>${t.from_state ? `${wfLabel(STATES, t.from_state)} → ` : ''}<strong>${wfLabel(STATES, t.to_state)}</strong></span><span class="small muted">${fmtDate(t.created_at, true)} · ${t.actor} · ${t.reason}</span></li>`)}</ul>
  </section>
  <section class="card"><h2>Human tasks</h2>
  ${d.tasks.length ? html`<ul class="log log--stack">${d.tasks.map((t) => html`<li><span>${badge(t.status)} ${titleCase(t.kind)} · ${t.link ? html`<a href="${t.link}">${t.title}</a>` : t.title}</span>${t.detail ? html`<span class="small muted pre">${t.detail}</span>` : ''}<span class="small muted">${t.created_by}${t.resolved_by ? ` → ${t.resolved_by}` : ''}</span>
    ${t.status === 'open' ? html`<span class="a-actions">${btn(ctx, `/admin/ops/tasks/${t.id}/done`, 'Done')}${btn(ctx, `/admin/ops/tasks/${t.id}/dismiss`, 'Dismiss')}</span>` : ''}</li>`)}</ul>` : empty('None.')}
  </section>
  <section class="card"><h2>Events</h2>
  <ul class="log log--history">${d.events.map((e) => html`<li><span>${e.type}</span><span class="mono">#${e.id}</span><span class="muted">${fmtDate(e.created_at, true)}${e.processed_at ? '' : ' · pending'}</span></li>`)}</ul>
  </section>
</div>
</div>`,
  });
}

function agents(ctx, { stats }) {
  const effectNote = { read: 'reads the bound project only', internal: 'internal record', draft: 'draft — needs human approval', external: 'outside service — budgeted, policy-gated' };
  return shell(ctx, {
    title: 'Agents', path: '/admin/ops',
    body: html`<header class="a-head"><div><h1 class="display display--m">Agents</h1><p class="muted">Each agent can call only the tools listed for each action. Policies are fixed in code and no agent has a tool that changes them, approves anything, sends anything, or touches payment status. Model: ${ctx.app.agentModel.describe()}.</p></div></header>
${tabs('/admin/ops/agents')}
${Object.values(REGISTRY).map((a) => {
  const j = stats.jobs[a.id] || {}; const r = stats.runs[a.id] || {}; const e = stats.escalations[a.id] || {}; const dn = stats.denied[a.id] || {};
  return html`<section class="card agent-card">
  <h2>${a.name} <span class="badge">v${a.version}</span> <span class="mono small muted">${a.id}</span></h2>
  <p>${a.purpose}</p>
  <div class="stats stats--small">
    <div class="stat"><span class="stat__v">${j.jobs || 0}</span><span class="label">Jobs</span></div>
    <div class="stat"><span class="stat__v">${j.jobs ? pct((j.succeeded || 0) / j.jobs) : '—'}</span><span class="label">Succeeded</span></div>
    <div class="stat"><span class="stat__v">${j.retries || 0}</span><span class="label">Retries</span></div>
    <div class="stat"><span class="stat__v">${j.avg_ms ? `${(j.avg_ms / 1000).toFixed(1)} s` : '—'}</span><span class="label">Avg duration</span></div>
    <div class="stat"><span class="stat__v">${usd(r.cost || 0)}</span><span class="label">Spend</span></div>
    <div class="stat"><span class="stat__v">${e.n || 0}</span><span class="label">Escalations</span></div>
    <div class="stat"><span class="stat__v">${dn.n || 0}</span><span class="label">Denied tool calls</span></div>
  </div>
  ${r.models ? html`<p class="small muted">Models served: <span class="mono">${r.models}</span> · prompt versions: <span class="mono">${r.prompts}</span> · ${r.rules || 0} rules fallback(s)</p>` : ''}
  <h3>Escalation rules</h3><ul class="bullets">${a.escalation.map((x) => html`<li>${x}</li>`)}</ul>
  ${a.systemPrompt ? html`<details class="agent-action"><summary><strong>System prompt</strong></summary><pre class="json">${a.systemPrompt}</pre></details>` : html`<p class="small muted">Deterministic application code — no model, no prompt.</p>`}
  ${Object.values(a.actions).map((act) => html`<details class="agent-action"><summary><strong>${act.id}</strong> — ${act.description} <span class="muted small">· ${act.brains.join(' + ')} · up to ${act.maxTurns} turn(s) · retries ${act.retry.maxAttempts} · timeout ${act.timeoutMs / 1000}s</span></summary>
    ${act.instruction ? html`<p class="small">${act.instruction}</p>` : ''}
    <table class="a-table a-table--tight"><thead><tr><th>Tool</th><th>Effect</th><th>What it does</th></tr></thead><tbody>
    ${act.tools.map((t) => (t === 'submit_result' ? html`<tr><td class="mono small">submit_result</td><td>result</td><td class="small">Ends the task; validated against the output schema.</td></tr>` : html`<tr><td class="mono small">${t}</td><td>${TOOLS[t].effect}<br><span class="muted small">${effectNote[TOOLS[t].effect]}</span></td><td class="small">${TOOLS[t].description}</td></tr>`))}</tbody></table>
    <div class="a-cols"><div><h3>Input schema</h3>${json(act.input)}</div><div><h3>Output schema</h3>${json(act.output)}</div></div>
  </details>`)}
</section>`;
})}`,
  });
}

function settings(ctx, { values, defs, integrations, paymentsProvider }) {
  const anyConnected = integrations.some((i) => i.connected);
  return shell(ctx, {
    title: 'Controls & budgets', path: '/admin/ops',
    body: html`<header class="a-head"><div><h1 class="display display--m">Controls &amp; budgets</h1><p class="muted">Only administrators can change these. Agents can read them but have no way to modify them. Every change is audited.</p></div></header>
${tabs('/admin/ops/settings')}
<div class="a-cols">
<section class="card"><h2>Automation</h2>
  <form method="post" action="/admin/ops/settings" class="a-form" data-confirm="Save automation controls?">${csrf(ctx)}
    <input type="hidden" name="section" value="flags">
    <label class="chk"><input type="checkbox" name="orchestrator_paused" value="true" ${values.orchestrator_paused ? raw('checked') : ''}> ${defs.orchestrator_paused.label}</label>
    <label class="chk"><input type="checkbox" name="autonomous_production" value="true" ${values.autonomous_production ? raw('checked') : ''} ${anyConnected || values.autonomous_production ? '' : raw('disabled')}> ${defs.autonomous_production.label}</label>
    <p class="small muted">${defs.autonomous_production.help} ${anyConnected ? '' : 'Neither INDEX V3 nor FORM is connected, so this cannot be switched on yet.'}</p>
    <button class="btn-a btn-a--solid" type="submit">Save</button>
  </form>
  <dl class="kv">
    ${integrations.map((i) => html`<dt>${i.name}</dt><dd>${i.connected ? 'Connected' : 'Not connected — work goes to the human production queue'}</dd>`)}
    <dt>Client communication</dt><dd>Staff only. There is no email provider, so agents cannot contact clients; they draft portal updates for staff to publish and create tasks for staff to send messages.</dd>
    <dt>Payments</dt><dd>${paymentsProvider === 'simulated' ? 'Simulated (development only)' : paymentsProvider === 'stripe' ? 'Stripe' : 'Not configured'} — payment status is set only by verified webhooks or a named staff member.</dd>
  </dl>
</section>
<section class="card"><h2>Budgets</h2>
  <form method="post" action="/admin/ops/settings" class="a-form">${csrf(ctx)}
    <input type="hidden" name="section" value="budgets">
    ${['ai_monthly_budget_usd', 'ai_project_budget_usd', 'external_project_budget_usd', 'external_job_estimate_usd'].map((k) => html`<label>${defs[k].label}<input name="${k}" value="${values[k]}" inputmode="decimal"></label>`)}
    <button class="btn-a btn-a--solid" type="submit">Save budgets</button>
  </form>
  <p class="small muted">When an AI budget is reached, agents stop calling the model and draft with deterministic rules instead. When the external budget is reached, production goes to the human queue.</p>
</section>
</div>`,
  });
}

function agentTasks(ctx, { rows, filter, counts }) {
  const filters = [['active', 'Active'], ['completed', 'Completed'], ['failed', 'Failed'], ['all', 'All']];
  return shell(ctx, {
    title: 'Agent tasks', path: '/admin/ops',
    body: html`<header class="a-head"><div><h1 class="display display--m">Agent tasks</h1><p class="muted">Every job an agent or the orchestrator has run, with its brain, turns, tokens and cost. Model: ${ctx.app.agentModel.describe()}.</p></div></header>
${tabs('/admin/ops/tasks')}
<nav class="tabs">${filters.map(([f, label]) => html`<a href="/admin/ops/tasks?status=${f}" ${filter === f ? raw('aria-current="page"') : ''}>${label} ${counts[f] !== undefined ? `(${counts[f]})` : ''}</a>`)}</nav>
${rows.length ? html`<table class="a-table"><thead><tr><th>#</th><th>Agent · action</th><th>Project</th><th>Status</th><th>Brain</th><th class="r">Turns</th><th class="r">Tool calls</th><th class="r">Tokens in / out</th><th class="r">Cost</th><th>When</th></tr></thead><tbody>
${rows.map((r) => html`<tr>
  <td><a class="mono" href="/admin/ops/tasks/${r.id}">${r.id}</a></td>
  <td><a href="/admin/ops/tasks/${r.id}">${r.agent}.${r.action}</a>${r.error ? html`<br><span class="small muted">${r.error_kind}: ${r.error}</span>` : ''}</td>
  <td>${r.project_code || r.inquiry_ref || '—'}</td>
  <td>${badge(r.status)}${r.attempts > 1 ? html` <span class="small muted">${r.attempts} attempts</span>` : ''}</td>
  <td>${r.brain ? (r.brain === 'model' ? (r.simulated ? badge('queued', 'Simulated model') : badge('queued', 'Claude')) : badge('ok', 'Rules')) : '—'}</td>
  <td class="r">${r.turns ?? '—'}</td><td class="r">${r.tool_calls ?? '—'}${r.denied_calls ? html` <span class="badge badge--on">${r.denied_calls} denied</span>` : ''}</td>
  <td class="r small">${r.input_tokens ?? 0} / ${r.output_tokens ?? 0}</td><td class="r">${usd(r.cost_micros || 0)}</td>
  <td class="small">${fmtDate(r.finished_at || r.started_at || r.created_at, true)}</td>
</tr>`)}</tbody></table>` : empty('Nothing here.')}`,
  });
}

function blockView(b) {
  if (b.type === 'text') return html`<div class="pre small">${b.text}</div>`;
  if (b.type === 'thinking' || b.type === 'redacted_thinking') return html`<span class="muted small">Reasoning${b.thinking ? html`: ${b.thinking}` : ' (not returned by the API)'}</span>`;
  if (b.type === 'tool_use') return html`<div class="call"><span class="call__name">→ ${b.name}</span>${json(b.input)}</div>`;
  if (b.type === 'tool_result') {
    const content = Array.isArray(b.content) ? b.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} attached: ${c.media_type}]`)).join('\n') : String(b.content);
    return html`<div class="call ${b.is_error ? 'call--error' : ''}"><span class="call__name">← result${b.is_error ? ' (error)' : ''}</span><pre class="json">${content}</pre></div>`;
  }
  if (b.type === 'fallback') return html`<span class="badge">Model fallback</span>`;
  return html`<span class="muted small">${b.type}</span>`;
}

function agentTask(ctx, { job, session, runs, calls, workflow }) {
  const transcript = session ? JSON.parse(session.transcript) : [];
  const simulated = runs.some((r) => r.provider === 'simulated');
  return shell(ctx, {
    title: `Agent task ${job.id}`, path: '/admin/ops',
    body: html`<header class="a-head"><div><p class="label"><a href="/admin/ops/tasks">Agent tasks</a> / #${job.id}</p>
    <h1 class="display display--m">${job.agent}.${job.action}</h1>
    <p class="muted">${badge(job.status)} ${session ? (session.brain === 'model' ? (simulated ? badge('queued', 'Simulated model') : badge('queued', 'Claude')) : badge('ok', 'Rules')) : ''} ${job.attempts}/${job.max_attempts} attempt(s)${workflow ? html` · <a href="/admin/ops/workflows/${workflow.id}">workflow ${workflow.id}</a>` : ''}</p></div>
  <div class="a-head__actions">${['failed', 'cancelled'].includes(job.status) ? btn(ctx, `/admin/ops/jobs/${job.id}/retry`, 'Retry', { solid: true }) : ''}</div></header>
${simulated ? html`<div class="a-flash"><strong>Simulated model.</strong> These turns came from a scripted test model, not from Claude.</div>` : ''}
${job.error ? html`<div class="a-flash a-flash--error">${job.error_kind}: ${job.error}</div>` : ''}
<div class="a-cols a-cols--wide">
<div>
  <section class="card"><h2>Execution history</h2>
  ${!session ? empty('This task has not started yet.') : session.brain === 'rules' ? html`<div class="transcript">${transcript.map((e, i) => html`<div class="turn"><div class="turn__head">Step ${i + 1} · rules</div><div class="call"><span class="call__name">→ ${e.tool}</span>${json(e.input)}</div><div class="call"><span class="call__name">← result</span><pre class="json">${e.result}</pre></div></div>`)}</div>`
    : html`<div class="transcript">${transcript.map((m, i) => html`<div class="turn turn--${m.role}"><div class="turn__head">${i === 0 ? 'Task given to the agent' : m.role === 'assistant' ? `Agent turn` : 'Tool results returned'}</div>${Array.isArray(m.content) ? m.content.map(blockView) : html`<div class="pre small">${m.content}</div>`}</div>`)}</div>`}
  </section>
</div>
<div>
  <section class="card"><h2>Summary</h2><dl class="kv">
    <dt>Brain</dt><dd>${session ? session.brain : '—'}</dd><dt>Turns</dt><dd>${session ? session.turns : 0}</dd>
    <dt>Tool calls</dt><dd>${session ? session.tool_calls : 0}${session && session.denied_calls ? ` (${session.denied_calls} refused)` : ''}</dd>
    <dt>Tokens</dt><dd>${session ? `${session.input_tokens} in · ${session.output_tokens} out` : '—'}</dd><dt>Cost</dt><dd>${usd(session ? session.cost_micros : 0)}</dd>
  </dl>
  <h3>Input</h3>${json(job.input)}<h3>Result</h3>${json(job.output)}</section>
  <section class="card"><h2>Model calls</h2>
  ${runs.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Turn</th><th>Provider · model</th><th class="r">Tokens</th><th class="r">Cost</th><th>Status</th></tr></thead><tbody>${runs.map((r) => html`<tr><td class="small">${r.task.split('#')[1] || '—'}</td><td class="small">${r.provider} · <span class="mono">${r.model_served || r.model_requested || '—'}</span><br><span class="muted">prompt ${r.prompt_version || '—'} · ${r.latency_ms} ms</span></td><td class="r small">${r.input_tokens}/${r.output_tokens}${r.cache_read_tokens ? html`<br>cache ${r.cache_read_tokens}` : ''}</td><td class="r">${usd(r.cost_micros)}</td><td>${badge(r.status)}${r.detail ? html`<br><span class="small muted">${r.detail}</span>` : ''}</td></tr>`)}</tbody></table>` : empty('No model calls.')}
  </section>
  <section class="card"><h2>State changes</h2>
  ${calls.length ? html`<ul class="log log--stack">${calls.map((c) => html`<li><span>${badge(c.decision)} <span class="mono small">${c.tool}</span> <span class="muted small">${c.effect}</span></span>${c.detail ? html`<span class="small muted">${c.detail}</span>` : ''}</li>`)}</ul>` : empty('No state-changing tool calls.')}
  </section>
</div>
</div>`,
  });
}

module.exports = { overview, workflow, agents, settings, agentTasks, agentTask };
