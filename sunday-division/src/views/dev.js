'use strict';
const { html, money } = require('../lib/util');
const { page } = require('./layout');

/** Stand-in for the hosted checkout page when PAYMENTS_PROVIDER=simulated. */
function checkout(ctx, { session, invoice }) {
  return page(ctx, {
    title: 'Simulated checkout',
    body: html`<section class="section section--narrow">
  <p class="label">Development only · no real payment</p>
  <h1 class="display display--l">Simulated checkout</h1>
  <p class="lede">In production this step happens on Stripe's hosted payment page. Here you can simulate the outcome for <strong class="mono">${invoice.number}</strong> — ${money(session.amount_cents)}.</p>
  ${session.status !== 'open' ? html`<div class="form__notice">This checkout session is ${session.status}.</div>` : html`
  <form method="post" action="/dev/checkout/${session.session_id}" class="form form--short">
    <div class="form__submit">
      <button class="btn" name="outcome" value="pay" type="submit">Simulate successful payment</button>
      <button class="btn btn--ghost" name="outcome" value="cancel" type="submit">Cancel and return</button>
    </div>
  </form>`}
</section>`,
  });
}

module.exports = { checkout };
