'use strict';
const { html, raw, money, fmtDate, titleCase } = require('../lib/util');
const catalog = require('../services/catalog');

/** Staff views for contractors, production tasks and assignments, and the message outbox. */
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ''}">`;
const ON = new Set(['recommended', 'draft', 'candidate', 'submitted', 'changes_requested', 'offered']);
const OFF = new Set(['signed_off', 'sent', 'approved', 'rejected', 'declined', 'cancelled', 'discarded', 'suspended']);
const badge = (s, label) => html`<span class="badge ${ON.has(s) ? 'badge--on' : OFF.has(s) ? 'badge--off' : ''}">${label || titleCase(s)}</span>`;
const simBadge = (channel) => (channel === 'simulated' ? html`<span class="badge badge--sim" title="Development/test delivery: nothing was actually sent">Simulated</span>` : '');
const jobLabel = (j) => (catalog.JOB_TYPES[j] || { label: j || '—' }).label;
const btn = (ctx, url, label, { solid = false, confirm = '', fields = {} } = {}) => html`<form class="inline" method="post" action="${url}" data-confirm="${confirm}">${csrf(ctx)}${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<button class="btn-a ${solid ? 'btn-a--solid' : ''}" type="submit">${label}</button></form>`;

function contractors(ctx, { rows, newKey }) {
  const { shell } = require('./admin');
  const jobChecks = (selected = []) => Object.entries(catalog.JOB_TYPES).map(([id, j]) => html`<label class="chk"><input type="checkbox" name="skills" value="${id}" ${selected.includes(id) ? raw('checked') : ''}> ${j.label}</label>`);
  const catChecks = (selected = []) => catalog.GARMENT_CATEGORIES.map((c) => html`<label class="chk"><input type="checkbox" name="categories" value="${c}" ${selected.includes(c) ? raw('checked') : ''}> ${c}</label>`);
  return shell(ctx, {
    title: 'Contractors', path: '/admin/contractors',
    body: html`<header class="a-head"><div><h1 class="display display--m">Contractors</h1><p class="muted">Only approved contractors can be recommended by the Talent Agent, offered work or sign in to the contractor portal. Agents never see contact details.</p></div></header>
${newKey ? html`<div class="a-flash a-flash--key"><p><strong>Portal access key for ${newKey.name} — copy it now, it is not shown again.</strong></p><p>Portal: <span class="mono">${ctx.app.config.baseUrl}/contractor</span></p><p>Access key: <span class="mono" data-select>${newKey.key}</span></p><p class="small">Send it to the contractor securely. Issuing a new key revokes this one.</p></div>` : ''}
${rows.length ? html`<table class="a-table"><thead><tr><th>Contractor</th><th>Status</th><th>Approved for</th><th class="r">Rate</th><th class="r">Load</th><th class="r">Done</th><th>Portal</th><th></th></tr></thead><tbody>
${rows.map((c) => html`<tr>
  <td><strong>${c.name}</strong><br><span class="muted small">${c.discipline || ''}${c.email ? ` · ${c.email}` : ' · no email'}</span>${c.categories.length ? html`<br><span class="muted small">${c.categories.join(', ')}</span>` : ''}</td>
  <td>${badge(c.status)}</td>
  <td class="small">${c.skills.map(jobLabel).join(', ') || html`<span class="muted">none</span>`}</td>
  <td class="r">${money(c.hourly_rate_cents)}/h</td><td class="r">${c.load}/${c.capacity}</td><td class="r">${c.signed_off}</td>
  <td class="small">${c.portal_key_issued_at ? `Key ${fmtDate(c.portal_key_issued_at)}` : '—'}</td>
  <td class="r"><span class="a-actions">
    ${c.status !== 'approved' ? btn(ctx, `/admin/contractors/${c.id}/status`, 'Approve', { solid: true, fields: { status: 'approved' }, confirm: `Approve ${c.name}? The Talent Agent may then recommend them for work.` }) : btn(ctx, `/admin/contractors/${c.id}/status`, 'Suspend', { fields: { status: 'suspended' }, confirm: `Suspend ${c.name}? They lose portal access and will not be recommended.` })}
    ${c.status === 'approved' ? btn(ctx, `/admin/contractors/${c.id}/portal-key`, c.portal_key_issued_at ? 'New portal key' : 'Issue portal key', { confirm: c.portal_key_issued_at ? 'Issue a new key? The current key stops working.' : '' }) : ''}
  </span></td>
</tr>`)}</tbody></table>` : html`<p class="empty">No contractors yet.</p>`}
<section class="card"><h2>Add a contractor</h2>
  <form method="post" action="/admin/contractors" class="a-form">${csrf(ctx)}
    <div class="a-form--row">
      <label>Name<input name="name" maxlength="120" required></label>
      <label>Email<input type="email" name="email" maxlength="254"></label>
      <label>Discipline<input name="discipline" maxlength="120" placeholder="Technical design"></label>
      <label>Hourly rate (USD)<input name="rate" inputmode="decimal" size="7"></label>
      <label>Capacity<input name="capacity" inputmode="numeric" size="3" value="2"></label>
    </div>
    <fieldset class="chk-grid"><legend class="label">Approved for</legend>${jobChecks()}</fieldset>
    <fieldset class="chk-grid"><legend class="label">Garment categories</legend>${catChecks()}</fieldset>
    <label>Portfolio link<input name="portfolio_url" maxlength="300"></label>
    <label>Notes<textarea name="notes" rows="2" maxlength="1000"></textarea></label>
    <label class="chk"><input type="checkbox" name="status" value="approved"> Approve now (I have vetted this contractor)</label>
    <button class="btn-a btn-a--solid" type="submit">Add contractor</button>
  </form>
</section>`,
  });
}

/** Project page section: production tasks, their briefs, routes and contractor assignments. */
function productionSection(ctx, p, { tasks, assignments, messages }) {
  const byTask = (id) => assignments.filter((a) => a.task_id === id);
  return html`<section class="card" id="production"><h2>Production tasks &amp; contractors</h2>
  ${tasks.length ? html`<ul class="log log--stack">${tasks.map((t) => {
    const list = byTask(t.id);
    const current = list.filter((a) => !['rejected', 'declined', 'cancelled'].includes(a.status)).pop();
    return html`<li class="ptask">
      <span><strong>${t.title}</strong> <span class="muted small">${jobLabel(t.job_type)} · due ${fmtDate(t.due_date)}</span> ${badge(t.status)} ${t.route ? badge('route', `Route: ${titleCase(t.route)}`) : badge('draft', 'Not routed')}</span>
      ${t.brief ? html`<details><summary class="small">Technical brief &amp; checklist</summary><pre class="json">${t.brief}</pre><ul class="bullets small">${t.checklist.map((c) => html`<li>${c}</li>`)}</ul></details>` : html`<span class="muted small">Waiting for the Production Agent's brief.</span>`}
      ${current ? html`<div class="panel">
        <p>${badge(current.status)} <strong>${current.contractor_name}</strong> · ${current.estimated_hours} h · ${money(current.fee_cents)}${current.due_date ? ` · due ${fmtDate(current.due_date)}` : ''} <span class="muted small">recommended by ${current.recommended_by.replace('agent:', '')}</span></p>
        ${current.rationale ? html`<p class="small">${current.rationale}</p>` : ''}
        ${current.status === 'recommended' ? html`<form method="post" action="/admin/assignments/${current.id}/approve" class="a-form a-form--row" data-confirm="Offer this work to ${current.contractor_name}? The offer message is sent as part of approving.">${csrf(ctx)}
            <label>Fee (USD)<input name="fee" inputmode="decimal" size="8" value="${(current.fee_cents / 100).toFixed(2)}"></label>
            <label>Due<input type="date" name="due_date" value="${current.due_date || ''}"></label>
            <button class="btn-a btn-a--solid" type="submit">Approve &amp; send offer</button></form>
          <form method="post" action="/admin/assignments/${current.id}/reject" class="a-form a-form--row">${csrf(ctx)}<label>Reason<input name="note" maxlength="500"></label><button class="btn-a" type="submit">Reject — recommend someone else</button></form>` : ''}
        ${current.status === 'submitted' ? html`<form method="post" action="/admin/assignments/${current.id}/changes" class="a-form">${csrf(ctx)}<label>Send back to the contractor<textarea name="notes" rows="2" maxlength="3000" placeholder="What needs to change"></textarea></label><button class="btn-a" type="submit" data-confirm="Send these change notes to the contractor?">Request changes</button></form>
          <p class="small muted">To sign off, approve the deliverable in Deliverables below (technical reviewers only).</p>` : ''}
        ${current.response_note ? html`<p class="small">Contractor note: ${current.response_note}</p>` : ''}
        ${['offered', 'accepted', 'changes_requested'].includes(current.status) ? btn(ctx, `/admin/assignments/${current.id}/cancel`, 'Cancel assignment', { confirm: 'Cancel this assignment? Tell the contractor yourself.' }) : ''}
      </div>` : ''}
      ${list.filter((a) => a !== current).length ? html`<span class="small muted">Earlier: ${list.filter((a) => a !== current).map((a) => `${a.contractor_name} (${a.status})`).join(', ')}</span>` : ''}
      <form method="post" action="/admin/tasks/${t.id}/route" class="inline inline--fields">${csrf(ctx)}<select name="route" aria-label="Route">${['contractor', 'studio', 'index_v3', 'form'].map((r) => html`<option value="${r}" ${t.route === r ? raw('selected') : ''}>${titleCase(r)}</option>`)}</select><button class="btn-a" type="submit">Change route</button></form>
    </li>`;
  })}</ul>` : html`<p class="empty">No production tasks yet. The Project Manager Agent creates them once the deposit is verified.</p>`}
  ${messages.length ? html`<h3>Messages</h3><ul class="log log--stack">${messages.map((m) => html`<li><span>${badge(m.status)} ${simBadge(m.channel)} <a href="/admin/messages#m${m.id}">${m.subject}</a> <span class="muted small">to ${m.recipient_type} · ${fmtDate(m.created_at, true)}</span></span></li>`)}</ul>` : ''}
</section>`;
}

function messagesPage(ctx, { rows, provider, status }) {
  const { shell } = require('./admin');
  const filters = ['', 'draft', 'approved', 'sent', 'discarded'];
  return shell(ctx, {
    title: 'Messages', path: '/admin/messages',
    body: html`<header class="a-head"><div><h1 class="display display--m">Messages</h1>
  <p class="muted">Everything agents or staff prepare for clients and contractors. Nothing is sent until a member of staff approves it. Delivery: ${provider === 'simulated' ? html`${simBadge('simulated')} development mode — approved messages are recorded as sent but nothing leaves the server.` : 'manual — after approval, send the message yourself and mark it sent.'}</p></div>
  <nav class="tabs">${filters.map((f) => html`<a href="/admin/messages${f ? `?status=${f}` : ''}" ${status === f ? raw('aria-current="page"') : ''}>${f ? titleCase(f) : 'All'}</a>`)}</nav></header>
${rows.length ? rows.map((m) => html`<section class="card" id="m${m.id}">
  <h2>${m.subject} ${badge(m.status)} ${simBadge(m.channel)}</h2>
  <p class="small muted">To ${m.recipient_type} <span class="mono">${m.to_address}</span> · ${m.purpose} · ${m.project_code || ''} · prepared by ${m.prepared_by.replace('agent:', '')} · ${fmtDate(m.created_at, true)}${m.sent_at ? ` · sent ${fmtDate(m.sent_at, true)}` : ''}${m.provider_ref ? ` · ${m.provider_ref}` : ''}</p>
  ${m.status === 'draft' ? html`<form method="post" action="/admin/messages/${m.id}/approve" class="a-form" data-confirm="Approve and send this message?">${csrf(ctx)}
      <label class="sr">Message<textarea name="body" rows="8" maxlength="6000">${m.body}</textarea></label>
      <div class="a-actions"><button class="btn-a btn-a--solid" type="submit">Approve &amp; send</button></div></form>
      ${btn(ctx, `/admin/messages/${m.id}/discard`, 'Discard')}` : html`<pre class="json">${m.body}</pre>`}
  ${m.status === 'approved' && m.channel === 'manual' ? btn(ctx, `/admin/messages/${m.id}/sent`, 'I have sent this', { solid: true }) : ''}
</section>`) : html`<p class="empty">No messages.</p>`}`,
  });
}

module.exports = { contractors, productionSection, messagesPage, simBadge };
