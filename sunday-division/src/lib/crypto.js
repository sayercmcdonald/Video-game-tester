'use strict';
const crypto = require('node:crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, key] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(actual, expected);
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmacSha256 = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** Short human-friendly reference, no ambiguous characters. */
function refCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(len), (b) => alphabet[b % alphabet.length]).join('');
}

module.exports = { hashPassword, verifyPassword, token, sha256, hmacSha256, safeEqual, refCode };
