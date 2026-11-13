'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Web Push with VAPID (RFC 8292), sending no payload: a push only wakes the founder's
 * service worker, which then fetches the notification over the signed-in session. No
 * business data passes through Apple's, Google's or Mozilla's push services, so no
 * payload encryption is needed.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function loadKeys(config) {
  const { vapid } = config.command;
  if (vapid.publicKey && vapid.privateKey) return { publicKey: vapid.publicKey, privateJwk: privateJwkFrom(vapid.publicKey, vapid.privateKey) };
  // Generated once per installation and kept beside the database (mode 0600).
  const file = path.join(config.dataDir, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* create below */ }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const keys = { publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])), privateJwk: jwk };
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}
function privateJwkFrom(publicKey, privateKey) {
  const raw = Buffer.from(publicKey, 'base64url');
  return { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: privateKey };
}

function vapidJwt(keys, audience, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(sig)}`;
}

function createWebPush(app) {
  const { config, db } = app;
  let keys = null;
  const getKeys = () => (keys ||= loadKeys(config));
  const subject = () => config.command.vapid.subject || (config.baseUrl.startsWith('https://') ? config.baseUrl : 'mailto:founder@sunday-division.invalid');

  /** Only real browser push services (plus test hosts outside production) may receive requests. */
  function allowedEndpoint(endpoint) {
    let u;
    try { u = new URL(endpoint); } catch { return false; }
    const host = u.hostname.toLowerCase();
    if (config.command.pushExtraHosts.includes(u.host.toLowerCase()) || config.command.pushExtraHosts.includes(host)) return true;
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(host));
  }

  async function sendOne(sub, { urgency = 'normal' } = {}) {
    const audience = new URL(sub.endpoint).origin;
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { TTL: '86400', Urgency: urgency, 'Content-Length': '0', Authorization: `vapid t=${vapidJwt(getKeys(), audience, subject())}, k=${getKeys().publicKey}` },
        signal: AbortSignal.timeout(10e3),
        redirect: 'error',
      });
      if (res.status === 404 || res.status === 410) { db.run('DELETE FROM push_subscriptions WHERE id = ?', sub.id); return false; }
      if (!res.ok) throw new Error(`push service answered ${res.status}`);
      db.run('UPDATE push_subscriptions SET failures = 0, last_success_at = ? WHERE id = ?', new Date().toISOString(), sub.id);
      return true;
    } catch (err) {
      db.run('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?', sub.id);
      db.run('DELETE FROM push_subscriptions WHERE id = ? AND failures >= 10', sub.id);
      console.error('[push] delivery failed:', err.message);
      return false;
    }
  }

  return {
    publicKey: () => getKeys().publicKey,
    allowedEndpoint,
    subscribe(userId, { endpoint, keys: k = {}, label = '' }) {
      if (!allowedEndpoint(endpoint)) return false;
      db.run(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, label = excluded.label, failures = 0`,
      userId, endpoint, String(k.p256dh || '').slice(0, 200), String(k.auth || '').slice(0, 100), String(label).slice(0, 80), new Date().toISOString());
      return true;
    },
    unsubscribe: (userId, endpoint) => db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, endpoint).changes > 0,
    subscriptions: () => db.all('SELECT p.*, u.email FROM push_subscriptions p JOIN users u ON u.id = p.user_id WHERE u.founder = 1'),
    /** Wake every founder device. Resolves to the number of devices reached. */
    async notifyAll(opts) {
      const subs = db.all('SELECT p.* FROM push_subscriptions p JOIN users u ON u.id = p.user_id WHERE u.founder = 1');
      const results = await Promise.all(subs.map((s) => sendOne(s, opts)));
      return results.filter(Boolean).length;
    },
  };
}

module.exports = { createWebPush, vapidJwt, PUSH_HOSTS };
