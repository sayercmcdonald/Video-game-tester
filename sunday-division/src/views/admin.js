'use strict';
const { html, raw, money, fmtDate, paragraphs, humanSize, titleCase } = require('../lib/util');
const catalog = require('../services/catalog');

const NAV = [
  ['/admin', 'Overview'], ['/admin/leads', 'Leads'], ['/admin/projects', 'Projects'],
  ['/admin/approvals', 'Approvals'], ['/admin/messages', 'Messages'], ['/admin/ops', 'Operations'], ['/admin/invoices', 'Invoices'], ['/admin/contractors', 'Contractors'],
];
/** Statuses that need someone's attention are filled; settled ones are muted. */
const ATTENTION = new Set(['new', 'draft', 'proposed', 'in_review', 'awaiting_deposit', 'open', 'needs_human', 'mismatch', 'duplicate', 'failed', 'sent']);
const SETTLED = new Set(['done', 'paid', 'released', 'closed', 'won', 'published', 'completed', 'accepted', 'succeeded', 'resolved']);

const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ''}">`;
const badge = (status, label) => html`<span class="badge ${ATTENTION.has(status) ? 'badge--on' : SETTLED.has(status) ? 'badge--off' : ''}">${label || titleCase(status)}</span>`;
const sourceTag = (source) => (source && source !== 'manual' ? html`<span class="badge badge--ai" title="Drafted by automation — review before approving">${source === 'claude' ? 'AI draft' : source === 'rules' ? 'Auto draft' : titleCase(source)}</span>` : '');
function action(ctx, url, label, { cls = 'btn-a', fields = {}, confirm = '' } = {}) {
  return html`<form class="inline" method="post" action="${url}" data-confirm="${confirm}">${csrf(ctx)}${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<button class="${cls}" type="submit">${label}</button></form>`;
}
const options = (items, selected, blank) => html`${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${items.map((o) => {
  const [value, label] = Array.isArray(o) ? o : [o, titleCase(o)];
  return html`<option value="${value}" ${String(selected ?? '') === String(value) ? raw('selected') : ''}>${label}</option>`;
})}`;
const empty = (text) => html`<p class="empty">${text}</p>`;

function shell(ctx, { title, body, path = '' }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} — Sunday Division Studio</title>
<link rel="stylesheet" href="/assets/css/site.css"><link rel="stylesheet" href="/assets/css/admin.css">
<link rel="icon" href="/assets/img/mark.svg" type="image/svg+xml">
<script src="/assets/js/admin.js" defer></script>
</head>
<body class="admin">
${ctx.user ? html`<aside class="a-side">
  <a class="wordmark" href="/admin">Sunday Division</a>
  <p class="label label--light">Studio operations</p>
  <nav aria-label="Dashboard">${NAV.map(([href, label]) => html`<a href="${href}" ${(href === '/admin' ? path === href : path.startsWith(href)) ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>
  <div class="a-side__foot">
    <p>${ctx.user.name}</p>
    <form method="post" action="/admin/logout">${csrf(ctx)}<button class="btn-a btn-a--light" type="submit">Sign out</button></form>
    <a href="/" class="a-side__site">View website</a>
  </div>
</aside>` : ''}
<main class="a-main ${ctx.user ? '' : 'a-main--solo'}">
  ${ctx.flash ? html`<div class="a-flash" role="status">${ctx.flash}</div>` : ''}
  ${body}
</main>
</body></html>`;
}

function login(ctx, { error = '', email = '' } = {}) {
  return shell(ctx, {
    title: 'Sign in',
    body: html`<div class="a-login">
  <p class="wordmark">Sunday Division</p>
  <h1 class="display display--m">Studio sign in</h1>
  ${error ? html`<div class="a-flash a-flash--error" role="alert">${error}</div>` : ''}
  <form method="post" action="/admin/login" class="a-form">
    <label>Email<input type="email" name="email" value="${email}" required autocomplete="username"></label>
    <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn" type="submit">Sign in</button>
  </form>
</div>`,
  });
}

function overview(ctx, d) {
  const stat = (label, value, href) => html`<a class="stat" href="${href}"><span class="stat__v">${value}</span><span class="label">${label}</span></a>`;
  return shell(ctx, {
    title: 'Overview', path: '/admin',
    body: html`<header class="a-head"><h1 class="display display--m">Overview</h1></header>
<div class="stats">
  ${stat('New leads', d.newLeads, '/admin/leads?status=new')}
  ${stat('Awaiting your approval', d.approvals, '/admin/approvals')}
  ${stat('Awaiting deposit', d.awaitingDeposit, '/admin/projects')}
  ${stat('Active projects', d.active, '/admin/projects')}
  ${stat('Invoiced, unpaid', money(d.outstanding), '/admin/invoices')}
  ${stat('Collected', money(d.collected), '/admin/invoices')}
  ${stat('Human queue (agents)', d.ops.humanTasks, '/admin/ops')}
  ${stat('Failed agent jobs', d.ops.failed, '/admin/ops')}
</div>
<div class="a-cols">
  <section class="card"><h2>Recent activity</h2>
    ${d.activity.length ? html`<ul class="log">${d.activity.map((a) => html`<li><span class="mono">${fmtDate(a.created_at, true)}</span><span>${a.action}</span><span class="muted">${a.actor}${a.detail ? ` · ${a.detail}` : ''}</span></li>`)}</ul>` : empty('Nothing yet. Activity appears here as inquiries arrive.')}
  </section>
  <section class="card"><h2>System</h2>
    <dl class="kv">
      <dt>Payments</dt><dd>${d.system.payments === 'stripe' ? 'Stripe Checkout (live keys configured)' : d.system.payments === 'simulated' ? 'Simulated — development only, no real money' : 'Not configured — record payments manually'}</dd>
      <dt>Drafting</dt><dd>${d.system.drafting}</dd>
      ${d.system.integrations.map((i) => html`<dt>${i.name}</dt><dd>${i.connected ? 'Connected via API' : 'Manual mode — human production'}</dd>`)}
    </dl>
    <p class="muted small">Automation only prepares drafts. Quotes, invoices, client updates and file releases each need a person to approve them.</p>
  </section>
</div>`,
  });
}

function leads(ctx, { rows, status }) {
  const filters = ['', 'new', 'reviewing', 'quoted', 'won', 'lost', 'archived'];
  return shell(ctx, {
    title: 'Leads', path: '/admin/leads',
    body: html`<header class="a-head"><h1 class="display display--m">Leads &amp; inquiries</h1>
  <nav class="tabs">${filters.map((f) => html`<a href="/admin/leads${f ? `?status=${f}` : ''}" ${status === f ? raw('aria-current="page"') : ''}>${f ? titleCase(f) : 'Open'}</a>`)}</nav></header>
${rows.length ? html`<table class="a-table"><thead><tr><th>Ref</th><th>Received</th><th>Brand / contact</th><th>Category</th><th>Budget</th><th>Timeline</th><th>Status</th></tr></thead>
<tbody>${rows.map((r) => html`<tr>
  <td><a class="mono" href="/admin/leads/${r.id}">${r.ref}</a></td><td>${fmtDate(r.created_at)}</td>
  <td><a href="/admin/leads/${r.id}">${r.brand_name || r.contact_name}</a>${r.kind === 'contact' ? html` <span class="badge">Message</span>` : ''}</td>
  <td>${r.garment_category || '—'}</td><td>${r.budget || '—'}</td><td>${r.timeline || '—'}</td><td>${badge(r.status)}</td>
</tr>`)}</tbody></table>` : empty('No inquiries in this view.')}`,
  });
}

function lead(ctx, { inquiry: q, files, project }) {
  const t = q.triage;
  const labels = Object.fromEntries(catalog.DELIVERABLE_OPTIONS.map((d) => [d.id, d.label]));
  const listOf = (title, items) => (items && items.length ? html`<h3>${title}</h3><ul class="bullets">${items.map((i) => html`<li>${i}</li>`)}</ul>` : '');
  return shell(ctx, {
    title: q.ref, path: '/admin/leads',
    body: html`<header class="a-head">
  <div><p class="label"><a href="/admin/leads">Leads</a> / ${q.ref}</p><h1 class="display display--m">${q.brand_name || q.contact_name}</h1></div>
  <div class="a-head__actions">${badge(q.status)}
    ${project ? html`<a class="btn-a btn-a--solid" href="/admin/projects/${project.id}">Open project ${project.code}</a>`
      : q.kind === 'project' ? action(ctx, `/admin/leads/${q.id}/convert`, 'Create project', { cls: 'btn-a btn-a--solid' }) : ''}
  </div>
</header>
<div class="a-cols a-cols--wide">
  <div>
    <section class="card"><h2>${q.kind === 'contact' ? 'Message' : 'Submission'}</h2>
      <dl class="kv">
        <dt>Contact</dt><dd>${q.contact_name} · <a href="mailto:${q.email}">${q.email}</a>${q.phone ? ` · ${q.phone}` : ''}</dd>
        ${q.website ? html`<dt>Website</dt><dd>${q.website}</dd>` : ''}
        <dt>Received</dt><dd>${fmtDate(q.created_at, true)}</dd>
        ${q.kind === 'project' ? html`
        <dt>Category</dt><dd>${q.garment_category}</dd>
        <dt>Package interest</dt><dd>${q.package_interest ? titleCase(q.package_interest) : 'Not stated'}</dd>
        <dt>Deliverables</dt><dd>${q.deliverables.map((d) => labels[d] || d).join(', ')}</dd>
        <dt>Budget</dt><dd>${q.budget}</dd><dt>Timeline</dt><dd>${q.timeline}</dd>` : ''}
      </dl>
      <h3>${q.kind === 'contact' ? 'Message' : 'Project description'}</h3><div class="prose">${paragraphs(q.description)}</div>
      ${q.kind === 'project' ? html`
      <h3>Target measurements &amp; sizing</h3><div class="prose">${q.measurements ? paragraphs(q.measurements) : empty('Not provided.')}</div>
      <h3>Fabric preferences</h3><div class="prose">${q.fabric_preferences ? paragraphs(q.fabric_preferences) : empty('Not provided.')}</div>
      <h3>Reference files</h3>
      ${files.length ? html`<div class="thumbs">${files.map((f) => html`<a href="/admin/files/${f.id}" title="${f.original_name}">${f.mime.startsWith('image/') ? html`<img src="/admin/files/${f.id}?inline=1" alt="${f.original_name}" loading="lazy">` : html`<span class="thumbs__doc">PDF</span>`}<span>${f.original_name} · ${humanSize(f.size)}</span></a>`)}</div>` : empty('None attached.')}` : ''}
    </section>
  </div>
  <div>
    ${q.kind === 'project' ? html`<section class="card"><h2>Triage ${sourceTag(q.triage_source)}</h2>
      ${t ? html`<p>${t.summary}</p>
        <dl class="kv"><dt>Suggested package</dt><dd>${titleCase(t.suggested_package)}</dd><dt>Priority</dt><dd>${titleCase(t.priority)}</dd></dl>
        ${listOf('Needs care', t.risk_flags)}${listOf('Missing information', t.missing_information)}${listOf('Questions to ask', t.clarifying_questions)}`
        : empty('Not organised yet.')}
      ${action(ctx, `/admin/leads/${q.id}/triage`, t ? 'Run again' : 'Organise submission')}
      <p class="muted small">Internal notes only. Nothing here is sent to the client.</p>
    </section>` : ''}
    <section class="card"><h2>Status &amp; notes</h2>
      <form method="post" action="/admin/leads/${q.id}/status" class="a-form a-form--row">${csrf(ctx)}
        <label>Status<select name="status">${options(['new', 'reviewing', 'quoted', 'won', 'lost', 'archived'], q.status)}</select></label>
        <button class="btn-a" type="submit">Update</button>
      </form>
      <form method="post" action="/admin/leads/${q.id}/notes" class="a-form">${csrf(ctx)}
        <label>Internal notes<textarea name="notes" rows="5" maxlength="5000">${q.internal_notes}</textarea></label>
        <button class="btn-a" type="submit">Save notes</button>
      </form>
    </section>
  </div>
</div>`,
  });
}

function projects(ctx, { rows }) {
  return shell(ctx, {
    title: 'Projects', path: '/admin/projects',
    body: html`<header class="a-head"><h1 class="display display--m">Projects</h1></header>
${rows.length ? html`<table class="a-table"><thead><tr><th>Code</th><th>Project</th><th>Client</th><th>Package</th><th>Status</th><th>Due</th><th class="r">Quoted</th><th class="r">Collected</th><th class="r">Costs</th></tr></thead>
<tbody>${rows.map((p) => html`<tr>
  <td><a class="mono" href="/admin/projects/${p.id}">${p.code}</a></td><td><a href="/admin/projects/${p.id}">${p.name}</a></td><td>${p.brand_name}</td>
  <td>${p.package ? titleCase(p.package) : '—'}</td><td>${badge(p.status)}</td><td>${fmtDate(p.due_date)}</td>
  <td class="r">${money(p.money.quoted)}</td><td class="r">${money(p.money.collected)}</td><td class="r">${money(p.money.costs)}</td>
</tr>`)}</tbody></table>` : empty('No projects yet. Create one from a lead.')}`,
  });
}

// ── Project page sections ────────────────────────────────────────────────────
function quoteSection(ctx, p, quotes) {
  const draft = quotes.find((q) => q.status === 'draft');
  const live = quotes.find((q) => ['sent', 'accepted'].includes(q.status));
  const history = quotes.filter((q) => q !== draft && q !== live);
  const rows = draft ? [...draft.line_items, {}, {}] : [{}, {}, {}];
  const canDraft = !quotes.some((q) => q.status === 'accepted');
  return html`<section class="card" id="quote"><h2>Quote &amp; scope</h2>
  ${live ? html`<div class="panel"><p><strong>Version ${live.version}</strong> ${badge(live.status, live.status === 'sent' ? 'Sent — awaiting client' : 'Accepted')} · ${money(live.total_cents)} · deposit ${money(live.deposit_cents)} (${live.deposit_percent}%)</p>
    <p class="muted small">Approved ${fmtDate(live.approved_at, true)}${live.status === 'accepted' ? ` · accepted ${fmtDate(live.responded_at, true)} by ${live.accepted_name}` : ''}</p>
    <details><summary>View scope and line items</summary><div class="prose">${paragraphs(live.scope)}</div>
      <table class="a-table a-table--tight"><tbody>${live.line_items.map((i) => html`<tr><td>${i.description}</td><td class="r">${i.quantity} × ${money(i.unit_cents)}</td><td class="r">${money(i.quantity * i.unit_cents)}</td></tr>`)}</tbody></table></details></div>` : ''}
  ${canDraft ? html`
  <form method="post" action="/admin/projects/${p.id}/quote" class="a-form">${csrf(ctx)}
    ${draft ? html`<input type="hidden" name="quote_id" value="${draft.id}"><p><strong>Draft v${draft.version}</strong> ${badge('draft')} ${sourceTag(draft.source)} · ${money(draft.total_cents)}</p>` : html`<p class="muted">${live ? 'Start a revised version (replaces the sent quote when you send it).' : 'No quote yet. Draft one below or let automation prepare a first pass.'}</p>`}
    <label>Scope (the client reads this)<textarea name="scope" rows="6" maxlength="6000">${draft ? draft.scope : ''}</textarea></label>
    <table class="a-table a-table--form"><thead><tr><th>Line item</th><th>Qty</th><th>Unit price (USD)</th></tr></thead>
      <tbody>${rows.map((i) => html`<tr>
        <td><input name="item_description" value="${i.description || ''}" maxlength="200" aria-label="Line item description"></td>
        <td><input name="item_quantity" value="${i.quantity || ''}" inputmode="numeric" size="3" aria-label="Quantity"></td>
        <td><input name="item_unit" value="${i.unit_cents ? (i.unit_cents / 100).toFixed(2) : ''}" inputmode="decimal" size="8" aria-label="Unit price"></td>
      </tr>`)}</tbody></table>
    <div class="a-form--row">
      <label>Deposit %<input name="deposit_percent" value="${draft ? draft.deposit_percent : 50}" inputmode="numeric" size="3"></label>
      <label>Valid until<input type="date" name="valid_until" value="${draft && draft.valid_until ? draft.valid_until : ''}"></label>
    </div>
    <label>Terms<textarea name="terms" rows="4" maxlength="4000">${draft ? draft.terms : catalog.DEFAULT_TERMS}</textarea></label>
    <div class="a-actions">
      <button class="btn-a" type="submit" name="action" value="save">Save draft</button>
      ${draft && p.status === 'scoping' ? html`<button class="btn-a btn-a--solid" type="submit" name="action" value="send" data-confirm="Approve this quote and make it visible to the client?">Approve &amp; send to client</button>` : ''}
    </div>
  </form>
  ${action(ctx, `/admin/projects/${p.id}/automate`, 'Draft quote with automation', { fields: { task: 'quote' } })}` : ''}
  ${history.length ? html`<p class="muted small">Earlier versions: ${history.map((q) => `v${q.version} ${q.status}`).join(', ')}</p>` : ''}
</section>`;
}

function tasksSection(ctx, p, tasks, contractors, unlocked) {
  const proposed = tasks.filter((t) => t.status === 'proposed');
  const live = tasks.filter((t) => t.status !== 'proposed');
  const people = contractors.map((c) => [c.id, c.name]);
  return html`<section class="card" id="tasks"><h2>Tasks &amp; milestones</h2>
  ${!unlocked ? html`<p class="lock">Work is locked until the deposit is received. Tasks can be planned but not started.</p>` : ''}
  ${proposed.length ? html`<div class="panel"><p><strong>${proposed.length} proposed tasks</strong> ${sourceTag(proposed[0].source)}</p>
    <ul class="bullets">${proposed.map((t) => html`<li>${t.milestone ? html`<span class="muted">${t.milestone} · </span>` : ''}${t.title} <span class="muted">${fmtDate(t.due_date)}</span></li>`)}</ul>
    <div class="a-actions">${action(ctx, `/admin/projects/${p.id}/tasks/proposed`, 'Accept task list', { cls: 'btn-a btn-a--solid', fields: { decision: 'accept' } })}${action(ctx, `/admin/projects/${p.id}/tasks/proposed`, 'Discard', { fields: { decision: 'discard' } })}</div></div>` : ''}
  ${live.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Milestone</th><th>Task</th><th>Status · assignee · due</th><th></th></tr></thead>
    <tbody>${live.map((t) => html`<tr class="${t.status === 'done' ? 'is-done' : ''}">
      <td class="muted">${t.milestone || '—'}</td><td>${t.title}</td>
      <td><form class="inline inline--fields" method="post" action="/admin/tasks/${t.id}">${csrf(ctx)}
        <select name="status" aria-label="Status">${options(['todo', 'doing', 'review', 'done'], t.status)}</select>
        <select name="contractor_id" aria-label="Assignee">${options(people, t.contractor_id, 'Studio')}</select>
        <input type="date" name="due_date" value="${t.due_date || ''}" aria-label="Due date">
        <button class="btn-a" type="submit">Save</button></form></td>
      <td class="r">${action(ctx, `/admin/tasks/${t.id}/delete`, 'Remove', { cls: 'btn-link' })}</td>
    </tr>`)}</tbody></table>` : empty('No tasks yet.')}
  <form method="post" action="/admin/projects/${p.id}/tasks" class="a-form a-form--row">${csrf(ctx)}
    <label>New task<input name="title" maxlength="200" required></label>
    <label>Milestone<input name="milestone" maxlength="80" size="12"></label>
    <label>Due<input type="date" name="due_date"></label>
    <label>Assignee<select name="contractor_id">${options(people, '', 'Studio')}</select></label>
    <button class="btn-a" type="submit">Add task</button>
  </form>
  ${action(ctx, `/admin/projects/${p.id}/automate`, 'Propose task list with automation', { fields: { task: 'tasks' } })}
</section>`;
}

function deliverablesSection(ctx, p, deliverables, revisions, unlocked, balanceDue) {
  return html`<section class="card" id="deliverables"><h2>Deliverables &amp; revisions</h2>
  ${!unlocked ? html`<p class="lock">Deliverables open once the deposit is received.</p>` : html`
  ${deliverables.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Deliverable</th><th>File</th><th>Status</th><th>Next step</th></tr></thead>
    <tbody>${deliverables.map((d) => html`<tr>
      <td><strong>${d.title}</strong><br><span class="muted small">${titleCase(d.type)} · ${d.stage} ${sourceTag(d.source)}</span>${d.notes ? html`<br><span class="muted small">${d.notes}</span>` : ''}</td>
      <td>${d.file_id ? html`<a href="/admin/files/${d.file_id}">v${d.version} · ${d.original_name}</a>` : html`<span class="muted">No file</span>`}
        <form class="inline inline--fields" method="post" action="/admin/deliverables/${d.id}/upload" enctype="multipart/form-data">${csrf(ctx)}<input type="file" name="file" required aria-label="Upload new version"><button class="btn-a" type="submit">Upload ${d.file_id ? 'new version' : 'file'}</button></form></td>
      <td>${badge(d.status)}</td>
      <td>${d.status === 'in_review' ? action(ctx, `/admin/deliverables/${d.id}/approve`, 'Approve after review', { cls: 'btn-a btn-a--solid', confirm: 'Confirm you have reviewed this file and it is ready for the client.' })
        : d.status === 'approved' ? html`<form class="inline inline--fields" method="post" action="/admin/deliverables/${d.id}/release" data-confirm="Release this file to the client portal?">${csrf(ctx)}
            ${d.stage === 'final' && balanceDue > 0 ? html`<label class="chk"><input type="checkbox" name="override" value="yes"> Release although ${money(balanceDue)} is unpaid</label>` : ''}
            <button class="btn-a btn-a--solid" type="submit">Release to client</button></form>`
        : d.status === 'released' ? html`<span class="muted small">Released ${fmtDate(d.released_at)}</span>` : html`<span class="muted small">Upload a file</span>`}</td>
    </tr>`)}</tbody></table>` : empty('No deliverables yet.')}
  <form method="post" action="/admin/projects/${p.id}/deliverables" class="a-form a-form--row">${csrf(ctx)}
    <label>New deliverable<input name="title" maxlength="160" required></label>
    <label>Type<select name="type">${options(catalog.DELIVERABLE_TYPES, 'other')}</select></label>
    <label>Stage<select name="stage">${options([['final', 'Final file'], ['preview', 'Preview for review']], 'final')}</select></label>
    <button class="btn-a" type="submit">Add deliverable</button>
  </form>`}
  ${revisions.length ? html`<h3>Revision requests</h3><ul class="log log--stack">${revisions.map((r) => html`<li>
    <span>${badge(r.status)} <strong>${r.deliverable_title}</strong> <span class="muted">· ${r.requested_by.startsWith('client') ? 'client' : 'studio'} · ${fmtDate(r.created_at)}</span></span>
    <span>${r.notes}</span>${r.status === 'open' ? action(ctx, `/admin/revisions/${r.id}/resolve`, 'Mark resolved') : ''}</li>`)}</ul>` : ''}
</section>`;
}

function billingSection(ctx, p, d) {
  const { invoices, payments, remaining, money: m } = d;
  const pct = m.projectedMargin === null ? '—' : `${Math.round(m.projectedMargin * 100)}%`;
  return html`<section class="card" id="billing"><h2>Invoices &amp; payments</h2>
  ${invoices.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Invoice</th><th>Kind</th><th>Description</th><th class="r">Amount</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${invoices.map((i) => html`<tr>
      <td class="mono">${i.number}</td><td>${titleCase(i.kind)}</td><td>${i.description}</td><td class="r">${money(i.amount_cents)}</td>
      <td>${badge(i.status, i.status === 'open' ? 'Open — awaiting payment' : undefined)}${i.paid_at ? html`<br><span class="muted small">${fmtDate(i.paid_at, true)}</span>` : ''}</td>
      <td>${i.status === 'draft' ? action(ctx, `/admin/invoices/${i.id}/approve`, 'Approve & issue', { cls: 'btn-a btn-a--solid', confirm: `Issue ${i.number} for ${money(i.amount_cents)} to the client?` }) : ''}
        ${i.status === 'open' ? html`<form class="inline inline--fields" method="post" action="/admin/invoices/${i.id}/manual-payment" data-confirm="Record this invoice as paid outside checkout?">${csrf(ctx)}<input name="reference" placeholder="Transfer reference" maxlength="120" required aria-label="Transfer reference"><button class="btn-a" type="submit">Record payment</button></form>` : ''}
        ${['draft', 'open'].includes(i.status) ? action(ctx, `/admin/invoices/${i.id}/void`, 'Void', { cls: 'btn-link', confirm: `Void ${i.number}?` }) : ''}</td>
    </tr>`)}</tbody></table>` : empty('No invoices yet. The deposit invoice is raised automatically when the client accepts the quote.')}
  ${payments.some((x) => x.status !== 'succeeded') ? html`<div class="a-flash a-flash--error">${payments.filter((x) => x.status !== 'succeeded').map((x) => html`<p><strong>${titleCase(x.status)} payment on ${x.number}:</strong> ${x.note}</p>`)}</div>` : ''}
  <form method="post" action="/admin/projects/${p.id}/invoices" class="a-form a-form--row">${csrf(ctx)}
    <label>Draft invoice<select name="kind">${options([['final', 'Final balance'], ['other', 'Additional work']], 'final')}</select></label>
    <label>Amount (USD)<input name="amount" inputmode="decimal" size="9" value="${remaining ? (remaining / 100).toFixed(2) : ''}" required></label>
    <label>Description<input name="description" maxlength="200" value="${remaining ? 'Final balance' : ''}"></label>
    <button class="btn-a" type="submit">Create draft</button>
  </form>
  <p class="muted small">Draft invoices are invisible to the client until you approve them. Card payments are taken on the provider's hosted page; no card data touches this system.</p>

  <h3 id="profit">Profitability</h3>
  <div class="stats stats--small">
    <div class="stat"><span class="stat__v">${money(m.quoted)}</span><span class="label">Quoted</span></div>
    <div class="stat"><span class="stat__v">${money(m.collected)}</span><span class="label">Collected</span></div>
    <div class="stat"><span class="stat__v">${money(m.outstanding)}</span><span class="label">Invoiced, unpaid</span></div>
    <div class="stat"><span class="stat__v">${money(m.costs)}</span><span class="label">Costs</span></div>
    <div class="stat"><span class="stat__v">${money(m.projectedProfit)}</span><span class="label">Projected profit · ${pct}</span></div>
  </div>
  ${d.costs.length ? html`<table class="a-table a-table--tight"><thead><tr><th>Cost</th><th>Contractor</th><th class="r">Hours</th><th class="r">Amount</th><th></th></tr></thead>
    <tbody>${d.costs.map((c) => html`<tr><td>${c.description}</td><td>${c.contractor_name || '—'}</td><td class="r">${c.hours ?? '—'}</td><td class="r">${money(c.amount_cents)}</td><td class="r">${action(ctx, `/admin/costs/${c.id}/delete`, 'Remove', { cls: 'btn-link' })}</td></tr>`)}</tbody></table>` : ''}
  <form method="post" action="/admin/projects/${p.id}/costs" class="a-form a-form--row">${csrf(ctx)}
    <label>Log a cost<input name="description" maxlength="200" required></label>
    <label>Contractor<select name="contractor_id">${options(d.contractors.map((c) => [c.id, `${c.name} (${money(c.hourly_rate_cents)}/h)`]), '', 'None')}</select></label>
    <label>Hours<input name="hours" inputmode="decimal" size="5"></label>
    <label>or amount (USD)<input name="amount" inputmode="decimal" size="8"></label>
    <button class="btn-a" type="submit">Add cost</button>
  </form>
</section>`;
}

function project(ctx, d) {
  const { project: p, client, unlocked } = d;
  const next = { active: [['delivered', 'Mark delivered']], delivered: [['closed', 'Close project'], ['active', 'Reopen']], scoping: [['cancelled', 'Cancel project']], awaiting_deposit: [['cancelled', 'Cancel project']] }[p.status] || [];
  return shell(ctx, {
    title: p.code, path: '/admin/projects',
    body: html`<header class="a-head">
  <div><p class="label"><a href="/admin/projects">Projects</a> / ${p.code}</p><h1 class="display display--m">${p.name}</h1>
    <p class="muted">${client.brand_name} · ${client.contact_name} · <a href="mailto:${client.email}">${client.email}</a>${p.inquiry_id ? html` · <a href="/admin/leads/${p.inquiry_id}">Original inquiry</a>` : ''}</p></div>
  <div class="a-head__actions">${badge(p.status)}${next.map(([s, label]) => action(ctx, `/admin/projects/${p.id}/status`, label, { fields: { status: s }, confirm: `${label}?` }))}</div>
</header>
${d.portalKey ? html`<div class="a-flash a-flash--key"><p><strong>New portal access key — copy it now, it is not shown again.</strong></p><p>Portal: <span class="mono">${ctx.app.config.baseUrl}/portal</span></p><p>Access key: <span class="mono" data-select>${d.portalKey}</span></p><p class="small">Send both to the client by email. Issuing a new key revokes this one.</p></div>` : ''}
<nav class="tabs tabs--anchors"><a href="#brief">Brief</a><a href="#quote">Quote</a><a href="#tasks">Tasks</a><a href="#production">Production</a><a href="#files">Files</a><a href="#deliverables">Deliverables</a><a href="#billing">Billing</a><a href="#updates">Updates</a><a href="#production">Production</a><a href="#history">History</a></nav>

<div class="a-cols a-cols--wide">
<div>
  <section class="card" id="brief"><h2>Brief ${p.brief_status !== 'none' ? badge(p.brief_status) : ''} ${p.brief_status === 'draft' ? sourceTag(p.brief_source) : ''}</h2>
    <form method="post" action="/admin/projects/${p.id}/brief" class="a-form">${csrf(ctx)}
      <label class="sr">Project brief<textarea name="brief" rows="${p.brief ? 16 : 5}" maxlength="12000" placeholder="Write the brief, or let automation draft it from the intake submission.">${p.brief}</textarea></label>
      <div class="a-actions"><button class="btn-a" type="submit" name="action" value="save">Save draft</button>
        ${p.brief ? html`<button class="btn-a btn-a--solid" type="submit" name="action" value="approve">Save &amp; approve</button>` : ''}</div>
    </form>
    ${action(ctx, `/admin/projects/${p.id}/automate`, 'Draft brief with automation', { fields: { task: 'brief' } })}
    <p class="muted small">The client sees the brief in their portal only after it is approved.</p>
  </section>
  ${quoteSection(ctx, p, d.quotes)}
  ${tasksSection(ctx, p, d.tasks, d.contractors, unlocked)}
  ${require('./production').productionSection(ctx, p, d.production)}
  ${deliverablesSection(ctx, p, d.deliverables, d.revisions, unlocked, d.balanceDue)}
  ${billingSection(ctx, p, d)}
</div>
<div>
  <section class="card"><h2>Project</h2>
    <form method="post" action="/admin/projects/${p.id}/details" class="a-form">${csrf(ctx)}
      <label>Name<input name="name" value="${p.name}" maxlength="160" required></label>
      <label>Package<select name="package">${options(catalog.PACKAGES.map((k) => [k.id, k.name]), p.package, 'Not set')}</select></label>
      <label>Target delivery<input type="date" name="due_date" value="${p.due_date || ''}"></label>
      <button class="btn-a" type="submit">Save</button>
    </form>
    ${d.workflow ? html`<dl class="kv"><dt>Automation</dt><dd>${badge(d.workflow.state, (ctx.app.orchestrator.STATES[d.workflow.state] || {}).label)}${d.workflow.paused ? ' (paused)' : ''}${d.workflow.blocked_reason ? ' (blocked)' : ''} · <a href="/admin/ops/workflows/${d.workflow.id}">Inspect workflow</a></dd></dl>` : ''}
    <dl class="kv"><dt>Work</dt><dd>${unlocked ? `Unlocked ${fmtDate(p.started_at)}` : 'Locked until deposit'}</dd>
      <dt>Portal access</dt><dd>${client.portal_key_issued_at ? `Key issued ${fmtDate(client.portal_key_issued_at)}` : 'No key issued yet'}</dd></dl>
    ${action(ctx, `/admin/projects/${p.id}/portal-key`, client.portal_key_issued_at ? 'Issue new portal key' : 'Issue portal key', { confirm: client.portal_key_issued_at ? 'Issue a new key? The current key and any open client sessions stop working.' : '' })}
  </section>

  <section class="card" id="updates"><h2>Client updates</h2>
    ${d.updates.length ? html`<ul class="log log--stack">${d.updates.map((u) => html`<li>
      <span>${badge(u.status)} ${sourceTag(u.source)} <span class="muted">${fmtDate(u.published_at || u.created_at, true)}</span></span>
      ${u.status === 'draft' ? html`<form method="post" action="/admin/updates/${u.id}" class="a-form">${csrf(ctx)}
        <label class="sr">Update text<textarea name="body" rows="6" maxlength="4000">${u.body}</textarea></label>
        <div class="a-actions"><button class="btn-a" name="action" value="save" type="submit">Save</button>
          <button class="btn-a btn-a--solid" name="action" value="publish" type="submit" data-confirm="Publish this update to the client portal?">Approve &amp; publish</button>
          <button class="btn-link" name="action" value="discard" type="submit">Discard</button></div></form>`
        : html`<div class="prose">${paragraphs(u.body)}</div>`}</li>`)}</ul>` : empty('No updates yet.')}
    <form method="post" action="/admin/projects/${p.id}/updates" class="a-form">${csrf(ctx)}
      <label>Write an update<textarea name="body" rows="3" maxlength="4000" required></textarea></label>
      <button class="btn-a" type="submit">Save as draft</button>
    </form>
    ${action(ctx, `/admin/projects/${p.id}/automate`, 'Draft update with automation', { fields: { task: 'status' } })}
  </section>

  <section class="card" id="files"><h2>Files</h2>
    ${d.files.length ? html`<ul class="log log--stack">${d.files.map((f) => html`<li><a href="/admin/files/${f.id}">${f.label || f.original_name}</a><span class="muted small">${f.original_name} · ${humanSize(f.size)} · ${f.uploaded_by} · ${fmtDate(f.created_at)}</span></li>`)}</ul>` : empty('No files.')}
    <form method="post" action="/admin/projects/${p.id}/files" class="a-form" enctype="multipart/form-data">${csrf(ctx)}
      <label>Add working file<input type="file" name="file" required></label>
      <button class="btn-a" type="submit">Upload</button>
    </form>
    ${action(ctx, `/admin/projects/${p.id}/automate`, 'Organise file labels', { fields: { task: 'files' } })}
  </section>

  <section class="card" id="integrations"><h2>Production tools (INDEX V3 / FORM)</h2>
    ${d.integrations.map((i) => html`<div class="panel"><p><strong>${i.name}</strong> ${badge(i.connected ? 'completed' : 'idle', i.connected ? 'Connected' : 'Manual mode')}</p>
      ${unlocked ? html`<form method="post" action="/admin/projects/${p.id}/integrations" class="a-form a-form--row">${csrf(ctx)}<input type="hidden" name="product" value="${i.id}">
        <label>Request<select name="job_type">${options(Object.entries(i.jobTypes).map(([k, v]) => [k, v.label]))}</select></label>
        <label>Notes<input name="notes" maxlength="2000"></label>
        <button class="btn-a" type="submit">${i.connected ? 'Submit job' : 'Assign to a designer'}</button></form>` : html`<p class="lock">Available once the deposit is received.</p>`}</div>`)}
    ${d.jobs.length ? html`<ul class="log log--stack">${d.jobs.map((j) => html`<li><span>${badge(j.status)} <strong>${ctx.app.integrations.PRODUCTS[j.product].name}</strong> · ${titleCase(j.job_type)} <span class="muted">· ${j.mode} · ${fmtDate(j.created_at)}</span></span>
      ${j.result && j.result.error ? html`<span class="muted small">${j.result.error}</span>` : ''}
      ${j.mode === 'api' && ['queued', 'running'].includes(j.status) ? action(ctx, `/admin/jobs/${j.id}/refresh`, 'Check status') : ''}
      ${j.mode === 'manual' && j.status === 'needs_human' ? action(ctx, `/admin/jobs/${j.id}/complete`, 'Mark produced') : ''}</li>`)}</ul>` : ''}
    <p class="muted small">Generated or manual, every output arrives as a deliverable "in review" and needs a designer's approval before release.</p>
  </section>

  <section class="card" id="history"><h2>History</h2>
    <ul class="log log--history">${d.history.map((a) => html`<li><span class="mono">${fmtDate(a.created_at, true)}</span><span>${a.action}</span><span class="muted">${a.actor}${a.detail ? ` · ${a.detail}` : ''}</span></li>`)}</ul>
  </section>
</div>
</div>`,
  });
}

function approvals(ctx, d) {
  const group = (title, rows, render, none) => html`<section class="card"><h2>${title} <span class="count">${rows.length}</span></h2>${rows.length ? html`<ul class="log log--stack">${rows.map(render)}</ul>` : empty(none)}</section>`;
  const link = (r, anchor, text) => html`<a href="/admin/projects/${r.project_id}#${anchor}">${r.code} · ${text}</a>`;
  return shell(ctx, {
    title: 'Approvals', path: '/admin/approvals',
    body: html`<header class="a-head"><div><h1 class="display display--m">Approvals</h1><p class="muted">Everything waiting on a person before it can reach a client. Agent escalations and production hand-offs are in the <a href="/admin/ops">Operations</a> queue.</p></div></header>
<div class="a-cols">
  <div>
    ${group('Quotes to approve & send', d.quotes, (r) => html`<li>${link(r, 'quote', `Quote v${r.version} · ${money(r.total_cents)}`)} ${sourceTag(r.source)}</li>`, 'No draft quotes.')}
    ${group('Contractor assignments to approve', d.assignments, (r) => html`<li>${link(r, 'production', `${r.contractor_name} for "${r.task_title}" · ${money(r.fee_cents)}`)}</li>`, 'No recommendations waiting.')}
    ${group('Messages to approve', d.messages, (r) => html`<li><a href="/admin/messages#m${r.id}">${r.code || ''} · ${r.subject}</a> <span class="muted small">to ${r.recipient_type}</span></li>`, 'No draft messages.')}
    ${group('Invoices to approve', d.invoices, (r) => html`<li>${link(r, 'billing', `${r.number} · ${money(r.amount_cents)}`)}</li>`, 'No draft invoices.')}
    ${group('Deliverables to review or release', d.deliverables, (r) => html`<li>${link(r, 'deliverables', r.title)} ${badge(r.status)} ${sourceTag(r.source)}</li>`, 'Nothing in review.')}
    ${group('Payments needing review', d.payments, (r) => html`<li><a href="/admin/projects/${r.project_id}#billing">${r.number}</a> ${badge(r.status)} <span class="muted small">${r.note}</span></li>`, 'No payment exceptions.')}
  </div>
  <div>
    ${group('Briefs to approve', d.briefs, (r) => html`<li>${link(r, 'brief', r.name)} ${sourceTag(r.brief_source)}</li>`, 'No draft briefs.')}
    ${group('Client updates to publish', d.updates, (r) => html`<li>${link(r, 'updates', r.body.slice(0, 90))} ${sourceTag(r.source)}</li>`, 'No draft updates.')}
    ${group('Proposed task lists', d.tasks, (r) => html`<li>${link(r, 'tasks', `${r.n} proposed tasks`)}</li>`, 'No proposals.')}
    ${group('Revision requests', d.revisions, (r) => html`<li>${link(r, 'deliverables', r.notes.slice(0, 90))}</li>`, 'No open revisions.')}
  </div>
</div>`,
  });
}

function invoices(ctx, { rows }) {
  return shell(ctx, {
    title: 'Invoices', path: '/admin/invoices',
    body: html`<header class="a-head"><h1 class="display display--m">Invoices &amp; payments</h1></header>
${rows.length ? html`<table class="a-table"><thead><tr><th>Invoice</th><th>Project</th><th>Kind</th><th class="r">Amount</th><th>Status</th><th>Issued</th><th>Paid</th></tr></thead>
<tbody>${rows.map((i) => html`<tr><td class="mono"><a href="/admin/projects/${i.project_id}#billing">${i.number}</a></td><td>${i.project_code} · ${i.project_name}</td><td>${titleCase(i.kind)}</td><td class="r">${money(i.amount_cents)}</td><td>${badge(i.status)}</td><td>${fmtDate(i.approved_at)}</td><td>${fmtDate(i.paid_at)}</td></tr>`)}</tbody></table>` : empty('No invoices yet.')}`,
  });
}

module.exports = { shell, login, overview, leads, lead, projects, project, approvals, invoices };
