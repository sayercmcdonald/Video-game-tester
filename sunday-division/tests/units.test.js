'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../src/config');
const { verifyWebhook, signPayload, formEncode } = require('../src/payments/stripe');
const { parseMultipart } = require('../src/http/body');
const { computeTotals } = require('../src/services/quotes');
const { hashPassword, verifyPassword } = require('../src/lib/crypto');
const { html, raw, parseMoney } = require('../src/lib/util');
const rules = require('../src/ai/rules');
const { INQUIRY } = require('./helpers');

test('config: simulated payments are refused in production', () => {
  const prod = { NODE_ENV: 'production', BASE_URL: 'https://sundaydivision.example' };
  assert.throws(() => createConfig({ ...prod, PAYMENTS_PROVIDER: 'simulated' }), /refused in production/);
  assert.throws(() => createConfig({ ...prod, STRIPE_SECRET_KEY: 'sk_live_x' }), /STRIPE_WEBHOOK_SECRET/);
  assert.throws(() => createConfig({ NODE_ENV: 'production', BASE_URL: 'http://insecure.example' }), /https/);
  assert.equal(createConfig(prod).payments.provider, 'none');
  assert.equal(createConfig({ ...prod, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }).payments.provider, 'stripe');
  assert.equal(createConfig({}).payments.provider, 'simulated');
});

test('stripe: webhook signature verification', () => {
  const secret = 'whsec_test';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  assert.equal(verifyWebhook(Buffer.from(payload), signPayload(payload, secret), secret).id, 'evt_1');
  assert.throws(() => verifyWebhook(Buffer.from(payload), signPayload(payload, 'other'), secret), /Invalid webhook signature/);
  assert.throws(() => verifyWebhook(Buffer.from(payload + ' '), signPayload(payload, secret), secret), /Invalid webhook signature/);
  assert.throws(() => verifyWebhook(Buffer.from(payload), signPayload(payload, secret, 1000), secret), /tolerance/);
  assert.throws(() => verifyWebhook(Buffer.from(payload), undefined, secret), /Missing/);
});

test('stripe: nested params are form-encoded the way the API expects', () => {
  const encoded = formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { unit_amount: 5000 } }], metadata: { invoice_id: 7 } }).toString();
  assert.equal(decodeURIComponent(encoded), 'mode=payment&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=5000&metadata[invoice_id]=7');
});

test('multipart parser handles fields, repeated fields and binary files', () => {
  const b = 'XBOUNDARY';
  const binary = Buffer.from([0, 255, 13, 10, 45, 45, 1]);
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="a"\r\n\r\none\r\n--${b}\r\nContent-Disposition: form-data; name="a"\r\n\r\ntwo\r\n--${b}\r\nContent-Disposition: form-data; name="f"; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    binary, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const parsed = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.deepEqual(parsed.fields.a, ['one', 'two']);
  assert.equal(parsed.files.length, 1);
  assert.ok(parsed.files[0].data.equals(binary));
});

test('quotes: totals and deposit are computed in cents and clamped', () => {
  const t = computeTotals([{ description: 'A', quantity: 2, unit_cents: 12550 }, { description: '', unit_cents: 999 }, { description: 'B', quantity: 1, unit_cents: 1 }], 30);
  assert.deepEqual([t.items.length, t.total, t.deposit], [2, 25101, 7530]);
  assert.equal(computeTotals([], 5).percent, 10);
  assert.equal(computeTotals([], 500).percent, 100);
});

test('money parsing rejects ambiguous input', () => {
  assert.equal(parseMoney('$1,250.50'), 125050);
  assert.equal(parseMoney('750'), 75000);
  for (const bad of ['', '-5', '12.345', 'abc', '1e3']) assert.equal(parseMoney(bad), null);
});

test('passwords: scrypt hash verifies and rejects', () => {
  const hash = hashPassword('a long passphrase');
  assert.ok(verifyPassword('a long passphrase', hash));
  assert.ok(!verifyPassword('a long passphrasE', hash));
  assert.ok(!verifyPassword('x', 'not-a-hash'));
});

test('templates escape interpolated values by default', () => {
  const out = String(html`<p title="${'"><script>'}">${'<b>&'}</p>${raw('<i>ok</i>')}${[html`<u>${'<'}</u>`]}`);
  assert.equal(out, '<p title="&quot;&gt;&lt;script&gt;">&lt;b&gt;&amp;</p><i>ok</i><u>&lt;</u>');
});

test('rules-based drafting: package fit, flags and price floors', () => {
  const inquiry = { ...INQUIRY, package_interest: '', triage: null };
  assert.equal(rules.suggestPackage(inquiry), 'development');
  assert.equal(rules.suggestPackage({ ...inquiry, garment_category: 'Full collection' }), 'collection');
  assert.equal(rules.suggestPackage({ ...inquiry, deliverables: ['design'], budget: 'Under $750' }), 'concept');
  const flagged = rules.triage({ ...inquiry, budget: 'Under $750', description: `${inquiry.description} We also need a factory for bulk order.` });
  assert.ok(flagged.risk_flags.some((f) => /below the Development starting price/.test(f)));
  assert.ok(flagged.risk_flags.some((f) => /outside the current offer/.test(f)));
  for (const [pkg, floor] of [['concept', 750], ['development', 2000], ['collection', 5000]]) {
    const q = rules.quote(inquiry, { project: { package: pkg } });
    const total = q.line_items.reduce((s, i) => s + i.quantity * i.unit_price_usd, 0);
    assert.ok(total >= floor, `${pkg} quote ${total} >= ${floor}`);
  }
  const tasks = rules.tasks(inquiry, { project: { package: 'development' } }).tasks;
  assert.ok(tasks.some((t) => /Internal technical review/.test(t.title)));
});
