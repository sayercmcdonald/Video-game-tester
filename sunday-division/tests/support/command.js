'use strict';
/** Helpers for Sunday Division Command tests. */
const assert = require('node:assert/strict');
const { Browser, ADMIN } = require('../helpers');

/** Sign in to Command as the founder; returns a Browser holding the founder session + CSRF token. */
async function signInFounder(base, creds = ADMIN) {
  const b = new Browser(base);
  await b.get('/command/login');
  const res = await b.post('/command/login', creds, { csrf: false });
  assert.equal(res.status, 303, 'founder sign-in');
  await refreshCsrf(b);
  return b;
}
async function refreshCsrf(b) {
  const page = await b.get('/command/more');
  const m = /name="csrf-token" content="([^"]+)"/.exec(page.text || '');
  if (m) b.csrf = m[1];
  return b;
}
async function json(b, url, body, { csrf = true } = {}) {
  const res = await b.request('POST', url, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': b.csrf } : {}) } });
  let data = null;
  try { data = JSON.parse(res.text); } catch { /* not JSON */ }
  return { ...res, data };
}
/** Propose an action through the Approvals form; returns the action id. */
async function propose(b, type, target, extra = {}) {
  const res = await b.post('/command/actions', { type, target, ...extra });
  assert.equal(res.status, 303, `propose ${type}: ${res.status} ${res.text || ''}`);
  return Number(/\/command\/actions\/(\d+)/.exec(res.location)[1]);
}
async function digestOf(b, id) {
  const page = await b.get(`/command/actions/${id}`);
  return /name="digest" value="([^"]+)"/.exec(page.text)[1];
}
async function confirm(b, id, extra = {}) {
  return b.post(`/command/actions/${id}/confirm`, { digest: await digestOf(b, id), ...extra });
}

module.exports = { signInFounder, refreshCsrf, json, propose, digestOf, confirm };
