'use strict';
/**
 * Sunday Division design system — server-rendered components for Command.
 *
 * Each component returns escaped HTML (see lib/util html``) and maps 1:1 to a block in
 * public/css/ui.css (`ui-<component>`; Command-only blocks in command.css). Components take data, never fetch it, and
 * never invent values: optional parts (deltas, charts, thumbnails) render only when given.
 */
const { html, raw, esc } = require('../lib/util');
const { flat } = require('./flats');

// ── Icons: 24px line icons, 1.5 stroke, currentColor ────────────────────
const PATHS = {
  overview: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
  projects: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12l8.5 4.5 8.5-4.5"/><path d="M3.5 16l8.5 4.5 8.5-4.5"/>',
  agents: '<path d="M12 3.5c.5 4.3 2.2 6 6.5 6.5-4.3.5-6 2.2-6.5 6.5-.5-4.3-2.2-6-6.5-6.5 4.3-.5 6-2.2 6.5-6.5z"/><path d="M18.5 15.5c.2 1.6.8 2.2 2.4 2.4-1.6.2-2.2.8-2.4 2.4-.2-1.6-.8-2.2-2.4-2.4 1.6-.2 2.2-.8 2.4-2.4z"/>',
  approvals: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.6 2.6 4.9-5.3"/>',
  command: '<path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8.5L6 20v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M8.5 10.5h7M8.5 13.5h4"/>',
  bell: '<path d="M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 1.5h-14z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevron: '<path d="M10 6.5 15.5 12 10 17.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5.5M6 11l6-6 6 6"/>',
  brief: '<path d="M6 3.5h9l3 3v14H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
  performance: '<path d="M4 19.5h16"/><path d="M7 16v-4M12 16V8M17 16v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  update: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M17.5 3.5v3.5H14M6.5 20.5V17H10"/>',
  cash: '<rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/><circle cx="12" cy="12" r="2.5"/>',
  check: '<path d="M6.5 12.5l3.6 3.6 7.4-8.2"/>',
  spark: '<path d="M12 3.5c.5 4.3 2.2 6 6.5 6.5-4.3.5-6 2.2-6.5 6.5-.5-4.3-2.2-6-6.5-6.5 4.3-.5 6-2.2 6.5-6.5z"/>',
};
const Icon = (name, cls = '') => raw(`<svg class="ui-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`);

// ── Status ─────────────────────────────────────────────────────────────
/** tone: success (sage — operating / done) · review (bone — needs a decision) · attention · danger · neutral */
const StatusDot = (tone = 'neutral', label = '') => html`<span class="ui-dot ui-dot--${tone}" ${label ? raw(`role="img" aria-label="${esc(label)}"`) : raw('aria-hidden="true"')}></span>`;
const StatusPill = ({ tone = 'neutral', label }) => html`<span class="ui-pill ui-pill--${tone}">${tone === 'success' ? html`<span class="ui-pill__dot" aria-hidden="true"></span>` : ''}${label}</span>`;

const ProgressBar = ({ value, max, label }) => {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return html`<div class="ui-progress"><progress max="${max || 1}" value="${value}" aria-label="${label || 'Progress'}">${pct}%</progress><span class="ui-progress__value">${pct}%</span></div>`;
};

// ── Layout ─────────────────────────────────────────────────────────────
const PageHeader = ({ eyebrow, title, subtitle, actions }) => html`<header class="ui-header">
  <div>${eyebrow ? html`<p class="ui-overline">${eyebrow}</p>` : ''}<h1 class="ui-header__title">${title}</h1>${subtitle ? html`<p class="ui-header__subtitle">${subtitle}</p>` : ''}</div>
  ${actions ? html`<div class="ui-header__actions">${actions}</div>` : ''}
</header>`;

/** Editorial hero with an image behind the title (image is decorative). */
const Hero = ({ image, eyebrow, title, subtitle }) => html`<header class="ui-hero">
  <img class="ui-hero__img" src="${image}" alt="" width="1170" height="1170" decoding="async" fetchpriority="high">
  <div class="ui-hero__text">${eyebrow ? html`<p class="ui-overline">${eyebrow}</p>` : ''}<h1 class="ui-hero__title">${title}</h1>${subtitle ? html`<p class="ui-hero__subtitle">${subtitle}</p>` : ''}</div>
</header>`;

const Section = ({ title, id, count, action, body }) => html`<section class="ui-section" ${id ? raw(`id="${esc(id)}"`) : ''} ${title ? raw(`aria-labelledby="${esc(id || slug(title))}-h"`) : ''}>
  ${title ? html`<div class="ui-section__head"><h2 class="ui-overline" id="${id || slug(title)}-h">${title}${count !== undefined ? html` <span class="ui-count">${count}</span>` : ''}</h2>${action || ''}</div>` : ''}
  ${body}
</section>`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// ── Content ────────────────────────────────────────────────────────────
const Card = ({ body, href, cls = '' }) => (href
  ? html`<a class="ui-card ui-card--link ${cls}" href="${href}">${body}</a>`
  : html`<div class="ui-card ${cls}">${body}</div>`);

/** A figure with an optional, real comparison and an optional chart. */
const StatCard = ({ label, value, delta, sub, chart, href, cls = '' }) => Card({
  href, cls: `ui-stat ${cls}`,
  body: html`<p class="ui-stat__label">${label}</p>
  <div class="ui-stat__row"><p class="ui-stat__value">${value}</p>${delta ? html`<span class="ui-delta ui-delta--${delta.tone}">${delta.text}</span>` : ''}${chart || ''}</div>
  ${sub ? html`<p class="ui-stat__sub">${sub}</p>` : ''}`,
});

/** Line chart of a real series (e.g. cumulative cash). Renders nothing without data. */
function Sparkline(series, { label }) {
  if (!series || series.length < 2 || series.every((v) => v === series[0])) return '';
  const W = 120; const H = 36; const max = Math.max(...series); const min = Math.min(...series);
  const pts = series.map((v, i) => [(i / (series.length - 1)) * W, H - 3 - ((v - min) / (max - min || 1)) * (H - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return raw(`<svg class="ui-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><path class="ui-spark__area" d="${d} L${W} ${H} L0 ${H} Z"/><path class="ui-spark__line" d="${d}"/></svg>`);
}

/** Grouped rows (iOS-style inset list). rows: [{ icon, title, meta, trailing, href, tone }] */
const List = (rows, { cls = '' } = {}) => html`<ul class="ui-list ${cls}">${rows.map((r) => html`<li>${ListRow(r)}</li>`)}</ul>`;
function ListRow({ icon, title, meta, trailing, href, tone, dot }) {
  const inner = html`${icon ? html`<span class="ui-row__icon ${tone ? `ui-row__icon--${tone}` : ''}">${Icon(icon)}</span>` : ''}${dot ? StatusDot(dot) : ''}<span class="ui-row__text"><span class="ui-row__title">${title}</span>${meta ? html`<span class="ui-row__meta">${meta}</span>` : ''}</span>${trailing ? html`<span class="ui-row__trailing">${trailing}</span>` : ''}${href ? Icon('chevron', 'ui-row__chevron') : ''}`;
  return href ? html`<a class="ui-row" href="${href}">${inner}</a>` : html`<div class="ui-row">${inner}</div>`;
}

/** Segmented tabs with counts. items: [{ label, count, href, current }] */
const SegmentedTabs = (items, { label }) => html`<nav class="ui-tabs" aria-label="${label}">${items.map((t) => html`<a class="ui-tabs__item" href="${t.href}" ${t.current ? raw('aria-current="page"') : ''}>${t.label}${t.count !== undefined ? html`<span class="ui-tabs__count">${t.count}</span>` : ''}</a>`)}</nav>`;

/** Project thumbnail: the client's own reference image, else the studio's flat drawing for the category. */
const Thumb = ({ src, alt, garment }) => html`<span class="ui-thumb">${src ? html`<img src="${src}" alt="${alt}" loading="lazy" decoding="async">` : garment ? html`<span class="ui-thumb__flat">${flat(garment, 'front', { title: alt })}</span>` : html`<span class="ui-thumb__mark" aria-hidden="true">SD</span>`}</span>`;

const EmptyState = ({ title, body, action }) => html`<div class="ui-empty"><p class="ui-empty__title">${title}</p>${body ? html`<p class="ui-empty__body">${body}</p>` : ''}${action || ''}</div>`;

/** variant: primary (bone) · secondary (outline) · ghost (text) */
function Button({ label, href, variant = 'secondary', icon, type = 'submit', small = false, attrs = '' }) {
  const cls = `ui-btn ui-btn--${variant}${small ? ' ui-btn--small' : ''}`;
  const inner = html`<span>${label}</span>${icon ? Icon(icon) : ''}`;
  return href ? html`<a class="${cls}" href="${href}" ${raw(attrs)}>${inner}</a>` : html`<button class="${cls}" type="${type}" ${raw(attrs)}>${inner}</button>`;
}
const IconButton = ({ icon, label, href, attrs = '', cls = '' }) => (href
  ? html`<a class="ui-iconbtn ${cls}" href="${href}" aria-label="${label}" ${raw(attrs)}>${Icon(icon)}</a>`
  : html`<button class="ui-iconbtn ${cls}" type="button" aria-label="${label}" ${raw(attrs)}>${Icon(icon)}</button>`);

const Avatar = (name) => html`<span class="ui-avatar" aria-hidden="true">${String(name || '?').trim().charAt(0).toUpperCase()}</span>`;

module.exports = { Icon, StatusDot, StatusPill, ProgressBar, PageHeader, Hero, Section, Card, StatCard, Sparkline, List, ListRow, SegmentedTabs, Thumb, EmptyState, Button, IconButton, Avatar };
