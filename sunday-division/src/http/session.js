'use strict';
const { token, sha256, safeEqual } = require('../lib/crypto');
const { now } = require('../lib/util');

const COOKIE = { admin: 'sd_admin', portal: 'sd_portal', contractor: 'sd_contractor' };
const TTL_MS = { admin: 12 * 3600e3, portal: 7 * 24 * 3600e3, contractor: 7 * 24 * 3600e3 };
const SUBJECT = { admin: 'user_id', portal: 'client_id', contractor: 'contractor_id' };

function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieString(name, value, { maxAgeMs, secure }) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs !== undefined) attrs.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function createSessions({ db, config }) {
  const secure = config.secureCookies;
  return {
    COOKIE,
    /** Create a server-side session; only a hash of the cookie token is stored. */
    start(kind, subjectId) {
      const value = token(32);
      db.insert('sessions', {
        token_hash: sha256(value),
        kind,
        user_id: kind === 'admin' ? subjectId : null,
        client_id: kind === 'portal' ? subjectId : null,
        contractor_id: kind === 'contractor' ? subjectId : null,
        csrf: token(24),
        created_at: now(),
        expires_at: new Date(Date.now() + TTL_MS[kind]).toISOString(),
      });
      return cookieString(COOKIE[kind], value, { maxAgeMs: TTL_MS[kind], secure });
    },
    load(kind, cookies) {
      const value = cookies[COOKIE[kind]];
      if (!value) return null;
      const row = db.get('SELECT * FROM sessions WHERE token_hash = ? AND kind = ?', sha256(value), kind);
      if (!row || row.expires_at < now()) return null;
      return row;
    },
    end(kind, cookies) {
      const value = cookies[COOKIE[kind]];
      if (value) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(value));
      return cookieString(COOKIE[kind], '', { maxAgeMs: 0, secure });
    },
    endAllFor(kind, subjectId) {
      db.run(`DELETE FROM sessions WHERE kind = ? AND ${SUBJECT[kind]} = ?`, kind, subjectId);
    },
    checkCsrf: (session, submitted) => Boolean(session && submitted && safeEqual(session.csrf, submitted)),
    purgeExpired: () => db.run('DELETE FROM sessions WHERE expires_at < ?', now()),
    flashCookie: (message) => cookieString('sd_flash', message, { maxAgeMs: message ? 60e3 : 0, secure }),
  };
}

/** Fixed-window in-memory rate limiter (single-process deployment). */
function createRateLimiter() {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, 60e3);
  timer.unref();
  return {
    /** Returns true when the action is allowed. */
    take(key, max, windowMs) {
      const t = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset < t) { entry = { count: 0, reset: t + windowMs }; hits.set(key, entry); }
      entry.count += 1;
      return entry.count <= max;
    },
    reset: (key) => hits.delete(key),
  };
}

module.exports = { createSessions, createRateLimiter, parseCookies };
