'use strict';
const { html, raw, money, fmtDate, humanSize } = require('../lib/util');
const { page } = require('./layout');
const catalog = require('../services/catalog');

const STATUS = { offered: 'Offer — awaiting your answer', accepted: 'Accepted — in progress', submitted: 'Submitted — in review', changes_requested: 'Changes requested', signed_off: 'Signed off' };
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ''}">`;

function access(ctx, { error = '' } = {}) {
  return page(ctx, {
    title: 'Contractor Portal',
    body: html`<section class="section section--narrow">
  <p class="label">Contractor Portal</p>
  <h1 class="display display--l">Your Sunday Division assignments.</h1>
  <p class="lede">Read briefs, accept or decline offers, and submit your work.</p>
  <form class="form form--short" method="post" action="/contractor/access">
    ${error ? html`<div class="form__alert" role="alert">${error}</div>` : ''}
    <div class="field"><label for="f-key">Access key</label><input id="f-key" name="key" type="password" required autocomplete="off" maxlength="200">
      <p class="field__hint">The studio gives you an access key when you join the roster.</p></div>
    <div class="form__submit"><button class="btn" type="submit">Open portal</button></div>
  </form>
</section>`,
  });
}

function assignment(ctx, a, files, history) {
  const checklist = JSON.parse(a.checklist || '[]');
  const canSubmit = ['accepted', 'changes_requested'].includes(a.status);
  return html`<article class="p-project" id="a${a.id}">
  <header class="p-project__head">
    <p class="label">${a.project_code} · ${(catalog.JOB_TYPES[a.job_type] || {}).label || a.job_type}</p>
    <h2 class="display display--l">${a.task_title}</h2>
    <p class="p-status"><span class="tag">${STATUS[a.status] || a.status}</span> <span class="field__hint">Fee ${money(a.fee_cents)} · ${a.estimated_hours} h${a.due_date ? ` · due ${fmtDate(a.due_date)}` : ''}</span></p>
  </header>
  ${a.status === 'changes_requested' && history.length ? html`<div class="form__notice"><strong>Changes requested.</strong><pre class="p-brief">${history[history.length - 1].body}</pre></div>` : ''}
  <section class="p-block"><div class="p-block__head"><h3>Technical brief</h3></div><pre class="p-brief">${a.brief || 'The studio will add the brief shortly.'}</pre></section>
  ${checklist.length ? html`<section class="p-block"><div class="p-block__head"><h3>What QA will check</h3></div><ul class="ticks">${checklist.map((c) => html`<li>${c}</li>`)}</ul></section>` : ''}
  ${files.length ? html`<section class="p-block"><div class="p-block__head"><h3>Reference files</h3></div><ul class="p-list p-list--compact">${files.map((f) => html`<li><span>${f.label || f.original_name} <span class="field__hint">${humanSize(f.size)}</span></span><a class="link" href="/contractor/files/${f.id}?a=${a.id}">Download</a></li>`)}</ul></section>` : ''}
  ${a.status === 'offered' ? html`<section class="p-block"><div class="p-block__head"><h3>Your answer</h3></div>
    <form class="form form--short p-accept" method="post" action="/contractor/assignments/${a.id}/respond">${csrf(ctx)}
      <label class="check"><input type="checkbox" name="agree" value="yes"><span>I accept this assignment at ${money(a.fee_cents)}${a.due_date ? `, due ${fmtDate(a.due_date)}` : ''}.</span></label>
      <div class="field"><label for="note-${a.id}">Note to the studio <span class="optional">optional</span></label><textarea id="note-${a.id}" name="note" rows="3" maxlength="1000"></textarea></div>
      <div class="p-actions"><button class="btn" type="submit" name="decision" value="accept">Accept</button><button class="btn btn--ghost" type="submit" name="decision" value="decline">Decline</button></div>
    </form></section>` : ''}
  ${canSubmit ? html`<section class="p-block"><div class="p-block__head"><h3>Submit your work</h3></div>
    <form class="form form--short" method="post" action="/contractor/assignments/${a.id}/submit" enctype="multipart/form-data">${csrf(ctx)}
      <div class="field"><label for="file-${a.id}">File</label><input id="file-${a.id}" type="file" name="file" required><p class="field__hint">One file, up to 50 MB. A PDF for flats and tech packs; GLB or ZIP for 3D.</p></div>
      <div class="field"><label for="sn-${a.id}">Notes for the reviewer</label><textarea id="sn-${a.id}" name="note" rows="3" maxlength="1500"></textarea></div>
      <button class="btn" type="submit">Submit for review</button>
    </form></section>` : ''}
</article>`;
}

function home(ctx, { assignments, filesFor, historyFor, notice }) {
  return page(ctx, {
    title: 'Contractor Portal',
    body: html`<section class="section portal">
  <div class="portal__bar">
    <div><p class="label">Contractor Portal</p><p class="portal__who">${ctx.contractor.name}</p></div>
    <form method="post" action="/contractor/logout">${csrf(ctx)}<button class="btn btn--small btn--ghost" type="submit">Sign out</button></form>
  </div>
  ${notice ? html`<div class="form__notice" role="status">${notice}</div>` : ''}
  ${ctx.flash ? html`<div class="form__notice" role="status">${ctx.flash}</div>` : ''}
  ${assignments.length ? assignments.map((a) => assignment(ctx, a, filesFor(a), historyFor(a))) : html`<p class="lede">No assignments yet. When the studio offers you work it appears here.</p>`}
</section>`,
  });
}

module.exports = { access, home, raw };
