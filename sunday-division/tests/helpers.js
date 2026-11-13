'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfig } = require('../src/config');
const { createApp } = require('../src/app');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ADMIN = { email: 'studio@example.test', password: 'correct-horse-battery-staple' };

/** Boot an isolated app on a random port with its own temporary data directory. */
async function startApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
  const config = createConfig({
    NODE_ENV: 'test', DATA_DIR: dataDir, AI_PROVIDER: 'rules', PAYMENTS_PROVIDER: 'simulated', ORCHESTRATOR_POLL_MS: '0',
    ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ...env,
  });
  const app = createApp(config);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  config.baseUrl = base;
  return {
    app, base,
    close: async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

/** A tiny cookie-keeping HTTP client that behaves like a browser submitting forms. */
class Browser {
  constructor(base) { this.base = base; this.cookies = new Map(); this.csrf = ''; }
  async request(method, url, { body, headers = {} } = {}) {
    const res = await fetch(url.startsWith('http') ? url : this.base + url, {
      method, body, redirect: 'manual',
      headers: { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const value = pair.slice(i + 1);
      if (value && !/Max-Age=0/.test(line)) this.cookies.set(pair.slice(0, i), value);
      else this.cookies.delete(pair.slice(0, i));
    }
    const isText = /text|json/.test(res.headers.get('content-type') || '');
    const out = { status: res.status, location: res.headers.get('location'), headers: res.headers };
    if (isText) {
      out.text = await res.text();
      const m = /name="_csrf" value="([^"]+)"/.exec(out.text);
      if (m) this.csrf = m[1];
    } else {
      out.bytes = Buffer.from(await res.arrayBuffer());
    }
    return out;
  }
  get(url) { return this.request('GET', url); }
  /** GET, following redirects. */
  async open(url) {
    let res = await this.get(url);
    while (res.status === 303) res = await this.get(res.location);
    return res;
  }
  post(url, fields = {}, { csrf = true, headers } = {}) {
    const body = new URLSearchParams();
    if (csrf && this.csrf) body.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) body.append(k, item);
    return this.request('POST', url, { body, headers });
  }
  upload(url, fields = {}, files = []) {
    const form = new FormData();
    if (this.csrf) form.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) form.append(k, item);
    for (const f of files) form.append(f.field, new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name);
    return this.request('POST', url, { body: form });
  }
}

const INQUIRY = {
  brand_name: 'Northfield Atelier', contact_name: 'Jordan Reyes', email: 'jordan@northfield.test',
  phone: '+1 555 0100', garment_category: 'Outerwear', package_interest: 'development',
  description: 'A waxed cotton field jacket for city cyclists, with a two-way zip and a packable hood. We have sketches and need it taken through to a factory-ready pack.',
  measurements: 'Unisex XS–XL, base size M. Chest 112 cm finished.', fabric_preferences: '8oz waxed cotton, brushed cotton lining.',
  budget: '$2,000 – $5,000', timeline: '2–4 weeks', deliverables: ['flats', 'techpack', '3d'], consent: 'yes',
};

async function signInAdmin(base) {
  const admin = new Browser(base);
  await admin.get('/admin/login');
  const res = await admin.post('/admin/login', ADMIN);
  if (res.status !== 303) throw new Error(`admin login failed: ${res.status}`);
  await admin.open('/admin');
  return admin;
}

module.exports = { startApp, Browser, PNG, ADMIN, INQUIRY, signInAdmin };
