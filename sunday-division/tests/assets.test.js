'use strict';
/** Cache busting: pages link content-hashed asset URLs, and only current hashes are cached for good. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assetUrl } = require('../src/lib/assets');
const { startApp, ADMIN } = require('./helpers');

test('asset URLs follow the file content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-assets-'));
  fs.mkdirSync(path.join(dir, 'css'));
  const file = path.join(dir, 'css', 'x.css');
  fs.writeFileSync(file, 'a{color:red}');
  const first = assetUrl('css/x.css', dir);
  assert.match(first, /^\/assets\/css\/x\.css\?v=[0-9a-f]{12}$/);
  assert.equal(assetUrl('/assets/css/x.css', dir), first, 'accepts a full /assets path');
  fs.writeFileSync(file, 'a{color:blue}');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(assetUrl('css/x.css', dir), first, 'a changed file gets a new URL');
  assert.equal(assetUrl('css/missing.css', dir), '/assets/css/missing.css');
});

test('every surface links versioned assets; only the current version is cached for good', async (t) => {
  const { base, close } = await startApp({ FOUNDER_EMAIL: ADMIN.email });
  t.after(close);
  const versioned = /\/assets\/(?:css|js|command)\/[\w.-]+\?v=[0-9a-f]{12}/g;
  const seen = new Set();
  for (const [page, expect] of [['/', ['css/tokens.css', 'css/ui.css', 'css/site.css', 'js/site.js']], ['/portal', ['css/site.css']], ['/admin/login', ['css/studio.css', 'js/admin.js']], ['/command/login', ['css/command.css']], ['/command/offline', ['css/command.css']]]) {
    const body = await (await fetch(base + page)).text();
    for (const f of expect) assert.match(body, new RegExp(`/assets/${f.replace('.', '\\.')}\\?v=[0-9a-f]{12}`), `${page} links ${f} with a version`);
    assert.doesNotMatch(body, /\/assets\/(?:css|js)\/[\w.-]+\.(?:css|js)"/, `${page} has no unversioned stylesheet or script`);
    for (const u of body.match(versioned) || []) seen.add(u);
  }
  assert.ok(seen.size >= 7);
  for (const u of seen) {
    const res = await fetch(base + u);
    assert.equal(res.status, 200, u);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', u);
  }
  const stale = await fetch(`${base}/assets/css/site.css?v=000000000000`);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('cache-control'), 'no-cache', 'an old version is revalidated, never pinned');

  // The Command service worker caches exactly the versioned files the pages use, and its scope
  // includes the overview at /command (the installed app's start page).
  const swRes = await fetch(`${base}/command/sw.js`);
  assert.equal(swRes.headers.get('service-worker-allowed'), '/command');
  const manifest = await (await fetch(`${base}/command/manifest.webmanifest`)).json();
  assert.ok(manifest.start_url.startsWith(manifest.scope), 'start_url is inside the app scope');
  const sw = await swRes.text();
  const config = JSON.parse(/^self\.SD_ASSETS = (.*);$/m.exec(sw)[1]);
  assert.match(config.version, /^command-[0-9a-f]{12}$/);
  const login = await (await fetch(`${base}/command/login`)).text();
  for (const f of ['css/tokens.css', 'css/ui.css', 'css/command.css', 'js/command.js']) {
    const url = config.shell.find((s) => s.startsWith(`/assets/${f}?v=`));
    assert.ok(url, `service worker caches ${f}`);
    assert.equal(url, assetUrl(f), `same version as the pages for ${f}`);
    if (f.startsWith('css/')) assert.ok(login.includes(url), `the sign-in page links the same version of ${f}`);
  }
});
