'use strict';
const { html, raw, money, fmtDate, paragraphs, humanSize } = require('../lib/util');
const { page } = require('./layout');

const STATUS = {
  scoping: 'Scoping', awaiting_deposit: 'Awaiting deposit', active: 'In development',
  delivered: 'Delivered', closed: 'Complete',
};
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ''}">`;

function quoteBlock(ctx, quote) {
  if (!quote) return '';
  const open = quote.status === 'sent';
  return html`<section class="p-block" id="quote-${quote.id}">
  <div class="p-block__head"><h3>Quote</h3><span class="tag">${open ? 'Awaiting your response' : `Accepted ${fmtDate(quote.responded_at)}`}</span></div>
  <div class="prose">${paragraphs(quote.scope)}</div>
  <table class="p-table">
    <thead><tr><th>Item</th><th class="num-col">Qty</th><th class="num-col">Price</th><th class="num-col">Amount</th></tr></thead>
    <tbody>${quote.line_items.map((i) => html`<tr><td>${i.description}</td><td class="num-col">${i.quantity}</td><td class="num-col">${money(i.unit_cents)}</td><td class="num-col">${money(i.unit_cents * i.quantity)}</td></tr>`)}</tbody>
    <tfoot>
      <tr><th colspan="3">Total</th><td class="num-col">${money(quote.total_cents)}</td></tr>
      <tr><th colspan="3">Deposit to begin (${quote.deposit_percent}%)</th><td class="num-col">${money(quote.deposit_cents)}</td></tr>
    </tfoot>
  </table>
  <div class="p-terms"><p class="label">Terms</p>${paragraphs(quote.terms)}${quote.valid_until ? html`<p>Valid until ${fmtDate(quote.valid_until)}.</p>` : ''}</div>
  ${open ? html`<form class="form form--short p-accept" method="post" action="/portal/quotes/${quote.id}/respond">
    ${csrf(ctx)}
    <div class="field"><label for="sign-${quote.id}">Type your full name to accept</label><input id="sign-${quote.id}" name="signed_name" maxlength="120" autocomplete="name"></div>
    <label class="check"><input type="checkbox" name="agree" value="yes"><span>I accept this quote and its terms on behalf of my brand.</span></label>
    <div class="p-actions">
      <button class="btn" type="submit" name="decision" value="accept">Accept quote</button>
      <button class="btn btn--ghost" type="submit" name="decision" value="decline">Decline</button>
    </div>
    <p class="field__hint">Accepting raises your deposit invoice. Work is scheduled once the deposit is received.</p>
  </form>` : html`<p class="field__hint">Accepted by ${quote.accepted_name}.</p>`}
</section>`;
}

function invoicesBlock(ctx, invoices, paymentsEnabled) {
  if (!invoices.length) return '';
  return html`<section class="p-block">
  <div class="p-block__head"><h3>Invoices</h3></div>
  <table class="p-table">
    <thead><tr><th>Invoice</th><th>For</th><th class="num-col">Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${invoices.map((i) => html`<tr>
      <td class="mono">${i.number}</td><td>${i.description}</td><td class="num-col">${money(i.amount_cents)}</td>
      <td>${i.status === 'paid' ? `Paid ${fmtDate(i.paid_at)}` : 'Due'}</td>
      <td class="num-col">${i.status === 'open' ? (paymentsEnabled
        ? html`<form method="post" action="/portal/invoices/${i.id}/pay">${csrf(ctx)}<button class="btn btn--small" type="submit">Pay securely</button></form>`
        : 'Contact the studio to pay') : ''}</td>
    </tr>`)}</tbody>
  </table>
  ${paymentsEnabled ? html`<p class="field__hint">Payment is taken on our payment provider's secure page. We never see or store your card details.</p>` : ''}
</section>`;
}

function deliverablesBlock(ctx, deliverables) {
  if (!deliverables.length) return '';
  return html`<section class="p-block">
  <div class="p-block__head"><h3>Files from the studio</h3></div>
  <ul class="p-list">${deliverables.map((d) => html`<li>
    <div>
      <strong>${d.title}</strong>
      <p class="field__hint">Version ${d.version} · ${d.stage === 'preview' ? 'Preview for review' : 'Final file'} · released ${fmtDate(d.released_at)} · ${humanSize(d.size || 0)}</p>
      <details class="p-details"><summary class="link">Request a revision</summary>
        <form class="form form--short" method="post" action="/portal/deliverables/${d.id}/revision">${csrf(ctx)}
          <div class="field"><label for="rev-${d.id}">What should change?</label><textarea id="rev-${d.id}" name="notes" rows="4" maxlength="3000" required></textarea></div>
          <button class="btn btn--small" type="submit">Send revision request</button>
        </form>
      </details>
    </div>
    <a class="btn btn--small btn--ghost" href="/portal/files/${d.file_id}">Download</a>
  </li>`)}</ul>
</section>`;
}

function projectBlock(ctx, p, paymentsEnabled) {
  const awaitingQuote = p.status === 'scoping' && !p.quote;
  return html`<article class="p-project" id="project-${p.id}">
  <header class="p-project__head">
    <p class="label">${p.code}</p>
    <h2 class="display display--l">${p.name}</h2>
    <p class="p-status"><span class="tag">${p.status === 'scoping' && p.quote ? 'Quote ready for review' : STATUS[p.status] || p.status}</span>${p.due_date ? html` <span class="field__hint">Target delivery ${fmtDate(p.due_date)}</span>` : ''}</p>
  </header>
  ${awaitingQuote ? html`<p class="lede">We are scoping your project. Your quote will appear here once it has been reviewed by the studio.</p>` : ''}
  ${p.status === 'awaiting_deposit' ? html`<div class="form__notice"><strong>Deposit due.</strong> Your project is scheduled as soon as the deposit invoice below is paid.</div>` : ''}
  ${quoteBlock(ctx, p.quote)}
  ${invoicesBlock(ctx, p.invoices, paymentsEnabled)}
  ${p.updates.length ? html`<section class="p-block"><div class="p-block__head"><h3>Updates</h3></div>
    <ul class="p-updates">${p.updates.map((u) => html`<li><p class="label">${fmtDate(u.published_at)}</p><div class="prose">${paragraphs(u.body)}</div></li>`)}</ul></section>` : ''}
  ${deliverablesBlock(ctx, p.deliverables)}
  ${p.brief ? html`<section class="p-block"><details class="p-details"><summary><h3>Project brief</h3></summary><pre class="p-brief">${p.brief}</pre></details></section>` : ''}
  <section class="p-block">
    <div class="p-block__head"><h3>Your reference files</h3></div>
    ${p.files.length ? html`<ul class="p-list p-list--compact">${p.files.map((f) => html`<li><span>${f.original_name} <span class="field__hint">${humanSize(f.size)}</span></span><a class="link" href="/portal/files/${f.id}">Download</a></li>`)}</ul>` : html`<p class="field__hint">No files shared yet.</p>`}
    <form class="form form--short p-upload" method="post" action="/portal/projects/${p.id}/files" enctype="multipart/form-data">${csrf(ctx)}
      <div class="field"><label for="up-${p.id}">Add reference files</label><input id="up-${p.id}" type="file" name="references" multiple required accept="image/jpeg,image/png,image/webp,application/pdf"><p class="field__hint">JPG, PNG, WebP or PDF, up to 8 MB each.</p></div>
      <button class="btn btn--small btn--ghost" type="submit">Upload</button>
    </form>
  </section>
</article>`;
}

function home(ctx, { projects, paymentsEnabled, notice }) {
  return page(ctx, {
    title: 'Client Portal',
    path: '/portal',
    body: html`<section class="section portal">
  <div class="portal__bar">
    <div><p class="label">Client Portal</p><p class="portal__who">${ctx.client.brand_name} · ${ctx.client.contact_name}</p></div>
    <form method="post" action="/portal/logout">${csrf(ctx)}<button class="btn btn--small btn--ghost" type="submit">Sign out</button></form>
  </div>
  ${notice ? html`<div class="form__notice" role="status">${notice}</div>` : ''}
  ${ctx.flash ? html`<div class="form__notice" role="status">${ctx.flash}</div>` : ''}
  ${projects.length ? projects.map((p) => projectBlock(ctx, p, paymentsEnabled)) : html`<p class="lede">Your project is being set up. Check back soon.</p>`}
</section>`,
  });
}

module.exports = { home, raw };
