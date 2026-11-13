'use strict';

/** HTML rendering with escape-by-default interpolation. */
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return new Raw(out);
}
/** Plain text with line breaks → safe paragraphs. */
function paragraphs(text) {
  return raw(String(text || '').trim().split(/\n{2,}/).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (cents) => usd.format((Number(cents) || 0) / 100);
/** "1,250.50" / "$1250" → cents, or null when not a valid non-negative amount. */
function parseMoney(input) {
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

const now = () => new Date().toISOString();
function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleString('en-US', opts) + (withTime ? ' UTC' : '');
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Trimmed, length-limited string from untrusted input. */
function str(v, max = 500) {
  if (Array.isArray(v)) v = v[0];
  return String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}
const list = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const isEmail = (s) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(s) && s.length <= 254;
const int = (v) => (/^\d{1,12}$/.test(String(v ?? '')) ? Number(v) : null);
function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
function humanSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = {
  Raw, raw, esc, html, render, paragraphs, money, parseMoney, now, fmtDate, isDate,
  str, list, isEmail, int, safeJson, humanSize, titleCase, HttpError,
};
