'use strict';
const { html, raw, money, fmtDate, paragraphs, humanSize } = require('../lib/util');
const { page } = require('./layout');
const { StatusPill } = require('./command-ui');

const STATUS = {
  scoping: 'Scoping', awaiting_deposit: 'Awaiting deposit', active: 'In development',
  delivered: 'Delivered', closed: 'Complete',
};
/** Sage for work that is under way or finished; filled ink when the client needs to act. */
const STATUS_TONE = { awaiting_deposit: 'review', active: 'success', delivered: 'success', closed: 'success' };

/** The one thing the client should do next, read from their records (nothing is estimated). */
function nextStep(p) {
  if (p.quote && p.quote.status === 'sent') return { text: 'Your quote is ready. Review the scope and accept it to begin.', href: `#quote-${p.quote.id}`, label: 'Review quote' };
  const due = p.invoices.find((i) => i.status === 'open');
  if (due) return { text: p.status === 'awaiting_deposit' ? `Deposit due. Your project is scheduled as soon as invoice ${due.number} is paid.` : `Invoice ${due.number} is due.`, href: `#invoices-${p.id}`, label: 'View invoice' };
  if (p.status === 'scoping') return { text: 'We are scoping your project. Your quote will appear here once it has been reviewed by the studio.' };
  if (p.deliverables.some((d) => d.stage === 'preview') && p.status === 'active') return { text: 'Files are ready for your review. Download them, and request a revision if anything should change.', href: `#files-${p.id}`, label: 'Review files' };
  if (p.status === 'active') return { text: 'Your project is in development. Updates and files appear here as soon as the studio releases them.' };
  if (p.deliverables.length) return { text: 'Your final files are ready to download.', href: `#files-${p.id}`, label: 'Go to files' };
  return null;
}
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ''}">`;

function quoteBlock(ctx, quote) {
  if (!quote) return '';
  const open = quote.status === 'sent';
  return html`<section class="p-block" id="quote-${quote.id}">
  <div class="p-block__head"><h3>Quote</h3>${StatusPill({ tone: open ? 'review' : 'success', label: open ? 'Awaiting your response' : `Accepted ${fmtDate(quote.responded_at)}` })}</div>
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

function invoicesBlock(ctx, invoices, paymentsEnabled, projectId) {
  if (!invoices.length) return '';
  return html`<section class="p-block" id="invoices-${projectId}">
  <div class="p-block__head"><h3>Invoices</h3></div>
  <table class="p-table">
    <thead><tr><th>Invoice</th><th>For</th><th class="num-col">Amount</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${invoices.map((i) => html`<tr>
      <td class="mono">${i.number}</td><td>${i.description}</td><td class="num-col">${money(i.amount_cents)}</td>
      <td>${i.status === 'paid' ? StatusPill({ tone: 'success', label: `Paid ${fmtDate(i.paid_at)}` }) : StatusPill({ tone: 'review', label: 'Due' })}</td>
      <td class="num-col">${i.status === 'open' ? (paymentsEnabled
        ? html`<form method="post" action="/portal/invoices/${i.id}/pay">${csrf(ctx)}<button class="btn btn--small" type="submit">Pay securely</button></form>`
        : 'Contact the studio to pay') : ''}</td>
    </tr>`)}</tbody>
  </table>
  ${paymentsEnabled ? html`<p class="field__hint">Payment is taken on our payment provider's secure page. We never see or store your card details.</p>` : ''}
</section>`;
}

function deliverablesBlock(ctx, deliverables, projectId) {
  if (!deliverables.length) return '';
  return html`<section class="p-block" id="files-${projectId}">
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
  const quoteReady = p.status === 'scoping' && p.quote;
  const next = nextStep(p);
  return html`<article class="p-project" id="project-${p.id}" aria-labelledby="project-${p.id}-name">
  <header class="p-project__head">
    <p class="label">${p.code}</p>
    <h2 class="display display--l" id="project-${p.id}-name">${p.name}</h2>
    <p class="p-status">${StatusPill({ tone: quoteReady ? 'review' : STATUS_TONE[p.status] || 'neutral', label: quoteReady ? 'Quote ready for review' : STATUS[p.status] || p.status })}${p.due_date ? html` <span class="field__hint">Target delivery ${fmtDate(p.due_date)}</span>` : ''}</p>
  </header>
  ${next ? html`<div class="p-next" role="status"><p class="label">Next step</p><p class="p-next__text">${next.text}</p>${next.href ? html`<a class="btn btn--small" href="${next.href}">${next.label}</a>` : ''}</div>` : ''}
  ${quoteBlock(ctx, p.quote)}
  ${invoicesBlock(ctx, p.invoices, paymentsEnabled, p.id)}
  ${p.updates.length ? html`<section class="p-block"><div class="p-block__head"><h3>Updates</h3></div>
    <ul class="p-updates">${p.updates.map((u) => html`<li><p class="label">${fmtDate(u.published_at)}</p><div class="prose">${paragraphs(u.body)}</div></li>`)}</ul></section>` : ''}
  ${deliverablesBlock(ctx, p.deliverables, p.id)}
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
    <div><p class="label">Client Portal</p><h1 class="portal__who">${ctx.client.brand_name} · ${ctx.client.contact_name}</h1></div>
    <form method="post" action="/portal/logout">${csrf(ctx)}<button class="btn btn--small btn--ghost" type="submit">Sign out</button></form>
  </div>
  ${notice ? html`<div class="form__notice" role="status">${notice}</div>` : ''}
  ${ctx.flash ? html`<div class="form__notice" role="status">${ctx.flash}</div>` : ''}
  ${projects.length > 1 ? html`<nav class="p-jump" aria-label="Your projects"><p class="label">Your projects</p><ul>${projects.map((p) => html`<li><a href="#project-${p.id}">${p.name}</a></li>`)}</ul></nav>` : ''}
  ${projects.length ? projects.map((p) => projectBlock(ctx, p, paymentsEnabled)) : html`<p class="lede">Your project is being set up. Check back soon.</p>`}
</section>`,
  });
}

module.exports = { home, raw };
