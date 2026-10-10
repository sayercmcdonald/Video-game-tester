/* Shared helpers. Everything hangs off the global QA namespace so the app
   runs from plain <script> tags (works over file:// and any static server). */
window.QA = window.QA || {};

(function (QA) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function pct(earned, possible) {
    if (!possible) return 0;
    return Math.max(0, Math.min(100, Math.round((earned / possible) * 100)));
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function words(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }

  /* Split free text into non-empty lines, stripping list numbering like "1." "2)" "-" */
  function lines(text) {
    return String(text || '')
      .split(/\n+/)
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
      .filter(Boolean);
  }

  /* Keyword groups: each group is an array of alternative substrings / regexes.
     Returns which groups matched. */
  function matchGroups(text, groups) {
    const t = String(text || '').toLowerCase();
    return (groups || []).map((g) => {
      const alts = Array.isArray(g.any) ? g.any : g;
      const hit = alts.some((a) => (a instanceof RegExp ? a.test(t) : t.includes(String(a).toLowerCase())));
      return { label: g.label || alts[0], hit };
    });
  }

  function scoreTone(p) {
    if (p >= 80) return 'good';
    if (p >= 55) return 'warn';
    return 'bad';
  }

  function scoreRing(p, label) {
    return `<div class="score-ring" style="--p:${p}" role="img" aria-label="${esc(label || 'Score')}: ${p} percent"><div>${p}%</div></div>`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function fbItems(items) {
    if (!items || !items.length) return '';
    return '<ul>' + items.map((i) => `<li class="${esc(i.kind || 'info')}">${i.html ? i.html : esc(i.text)}</li>`).join('') + '</ul>';
  }

  QA.util = { esc, $, $$, pct, toast, uid, words, lines, matchGroups, scoreTone, scoreRing, fmtDate, fbItems };
})(window.QA);
