'use strict';
const { html, raw, esc, money } = require('../lib/util');
const { fmtLocal, ago, localHour } = require('../command/time');
const { REGISTRY } = require('../agents/definitions');
const { TOOLS } = require('../agents/tools');
const ui = require('./command-ui');

// ── Icons (24px line icons, currentColor) ─────────────────────────────
const I = {
  overview: '<rect x="4" y="4" width="7" height="9" rx="1"/><rect x="13" y="4" width="7" height="5" rx="1"/><rect x="13" y="11" width="7" height="9" rx="1"/><rect x="4" y="15" width="7" height="5" rx="1"/>',
  projects: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12l8.5 4.5 8.5-4.5"/><path d="M3.5 16l8.5 4.5 8.5-4.5"/>',
  approvals: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>',
  chat: '<path d="M4.5 5.5h15v10h-9l-4.5 3.8V15.5h-1.5z"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  brief: '<path d="M6 3.5h9l3 3v14H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
  agents: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.6-5.5 7-5.5s6.2 1.7 7 5.5"/>',
  performance: '<path d="M4 19.5h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>',
  bell: '<path d="M6.5 16.5v-5a5.5 5.5 0 0111 0v5l1.5 1.5h-14z"/><path d="M10 20.5a2.2 2.2 0 004 0"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  arrow: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  send: '<path d="M5 12h13M12.5 6l6 6-6 6"/>',
};
const icon = (name, cls = 'i') => raw(`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`);

// The five destinations (bottom tab bar on phones); the rail on wide screens adds the rest.
const NAV = [
  ['overview', '/command', 'Overview', true], ['projects', '/command/projects', 'Projects', true], ['agents', '/command/agents', 'Agents', true],
  ['approvals', '/command/approvals', 'Approvals', true], ['command', '/command/chat', 'Command', true],
  ['brief', '/command/brief', 'Morning Brief'], ['performance', '/command/performance', 'Performance'], ['settings', '/command/settings', 'Settings'],
];
const TAB_ALIAS = { chat: 'command', more: 'overview', notifications: 'overview', brief: 'overview', performance: 'overview', settings: 'overview' };

const tzOf = (ctx) => ctx.app.settings.get('timezone');
const dot = (status, label) => html`<span class="dot dot--${status}" ${label ? raw(`role="img" aria-label="${esc(label)}"`) : raw('aria-hidden="true"')}></span>`;
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session.csrf}">`;
const whole = (cents) => `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`;
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const empty = (text) => html`<p class="c-empty">${text}</p>`;
const firstName = (ctx) => String(ctx.user.name || '').split(/\s+/)[0] || 'there';

/** Safe, minimal formatting for chat replies: escape first, then bullets and bold. */
function richText(text) {
  const lines = esc(text).split('\n');
  let out = '';
  let list = false;
  for (const line of lines) {
    const m = /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(line);
    if (m) { if (!list) { out += '<ul>'; list = true; } out += `<li>${m[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line.trim()) out += `<p>${line}</p>`;
  }
  if (list) out += '</ul>';
  return raw(out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'));
}

function sampleBanner(ctx) {
  const row = ctx.app.db.get("SELECT value FROM ops_settings WHERE key = 'sample_data'");
  return row && row.value === 'true' ? html`<span class="ui-sample" role="note" title="Development records created by the seed script. Not real business activity.">Sample data<span class="c-sr"> — development records created by the seed script, not real business activity</span></span>` : '';
}

// ── Shell ─────────────────────────────────────────────────────────────
function shell(ctx, { title, tab, body, back, wide = false }) {
  const approvals = ctx.app.command.metrics.approvalsCount();
  const unread = ctx.app.command.notifications.unreadCount();
  // Exactly one item is the current page; on phones a secondary page also lights its section tab.
  const section = TAB_ALIAS[tab] || tab;
  const state = (id, primary) => (id === tab ? raw('aria-current="page"') : primary && id === section ? raw('data-section') : '');
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · Command</title>
<meta name="theme-color" content="#111111">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Command">
<meta name="robots" content="noindex, nofollow">
<meta name="csrf-token" content="${ctx.session ? ctx.session.csrf : ''}">
<link rel="manifest" href="/command/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/command/apple-touch-icon.png">
<link rel="icon" href="/assets/command/icon-192.png" type="image/png">
<link rel="preload" href="/assets/fonts/newsreader-display-latin-300-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/command.css">
<script src="/assets/js/command.js" defer></script>
</head>
<body class="c-body" data-tab="${tab}">
<a class="c-skip" href="#main">Skip to content</a>
<div class="c-app">
<nav class="ui-nav" aria-label="Command">
  <a class="ui-nav__brand" href="/command" aria-label="Sunday Division Command — Overview"><span>Sunday</span><span>Division</span></a>
  ${NAV.map(([id, href, label, primary]) => html`<a class="ui-nav__item ${primary ? '' : 'ui-nav__item--secondary'}" href="${href}" ${state(id, primary)}>${ui.Icon(id)}<span class="ui-nav__label">${label}</span>${id === 'approvals' && approvals ? html`<span class="ui-badge" aria-label="${approvals} waiting">${approvals > 99 ? '99+' : approvals}</span>` : ''}</a>`)}
</nav>
<div class="c-page">
<header class="ui-appbar">
  ${back ? html`<a class="ui-appbar__back" href="${back}">${ui.Icon('back')}<span>Back</span></a>` : html`<a class="ui-wordmark" href="/command" aria-label="Sunday Division — Overview"><span>Sunday</span><span>Division</span></a>`}
  ${sampleBanner(ctx)}
  <a class="ui-appbar__bell" href="/command/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${ui.Icon('bell')}${unread ? html`<span class="ui-appbar__unread" aria-hidden="true"></span>` : ''}</a>
</header>
<main id="main" class="c-main ${wide ? 'c-main--wide' : ''}" tabindex="-1">
${ctx.flash ? html`<p class="c-flash" role="status">${ctx.flash}</p>` : ''}
${body}
</main>
</div>
</div>
</body>
</html>`;
}

function bare(ctx, { title, body }) {
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · Command</title><meta name="theme-color" content="#111111"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex, nofollow">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Command">
<link rel="manifest" href="/command/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/command/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/tokens.css"><link rel="stylesheet" href="/assets/css/command.css"></head>
<body class="c-body c-body--bare"><main id="main" class="c-bare">${body}</main></body></html>`;
}

function login(ctx, { error, email = '' }) {
  return bare(ctx, {
    title: 'Sign in',
    body: html`<div class="c-login">
  <p class="c-login__brand">Sunday Division</p>
  <h1 class="c-serif c-login__title">Command</h1>
  <p class="c-muted">Private to the founder. Access is checked on the server for every request.</p>
  ${error ? html`<p class="c-flash c-flash--error" role="alert">${error}</p>` : ''}
  <form method="post" action="/command/login" class="c-form">
    <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${email}" autocapitalize="none">
    <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
    <button class="c-btn c-btn--primary" type="submit">Sign in</button>
  </form>
</div>`,
  });
}

function offline(ctx) {
  return bare(ctx, { title: 'Offline', body: html`<div class="c-login"><p class="c-login__brand">Sunday Division</p><h1 class="c-serif c-login__title">You're offline</h1><p class="c-muted">Command never stores business data on this device, so there is nothing to show without a connection. Reconnect and try again.</p><p><a class="c-btn c-btn--primary" href="/command">Try again</a></p></div>` });
}

function errorPage(ctx, status, message) {
  const body = html`<section class="c-section"><p class="c-eyebrow">Error ${status}</p><h1 class="c-serif c-h1">${status === 404 ? 'Not found' : status === 409 ? 'Not possible right now' : status === 403 ? 'Not allowed' : 'That did not go through'}</h1><p>${message}</p><p><a class="c-link" href="/command">Back to Overview</a></p></section>`;
  return ctx.user && ctx.user.founder && ctx.session ? shell(ctx, { title: 'Error', tab: '', body }) : bare(ctx, { title: 'Error', body });
}

// ── Overview ──────────────────────────────────────────────────────────
function overview(ctx, { health, trailing, counts, focus, brief, pendingBrief, paused }) {
  const tz = tzOf(ctx);
  const h = localHour(Date.now(), tz);
  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  // Said only when it is true: derived from the health checks.
  const subtitle = paused ? 'Automation is paused. Here’s what matters today.'
    : health.overall === 'ok' ? 'Everything is running normally. Here’s what matters today.'
      : health.overall === 'watch' ? 'A few things to keep an eye on today.' : 'Some things need you today.';
  const t = trailing;
  const signed = (x, unit) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(unit === 'pp' ? 0 : 0)}${unit}`;
  const revDelta = t.revenueDelta === null ? null : { text: signed(t.revenueDelta * 100, '%'), tone: t.revenueDelta >= 0 ? 'up' : 'down' };
  const marginDelta = t.marginDeltaPp === null ? null : { text: `${signed(t.marginDeltaPp, ' pp')}`, tone: t.marginDeltaPp >= 0 ? 'up' : 'down' };
  return shell(ctx, {
    title: 'Overview', tab: 'overview',
    body: html`${ui.Hero({ image: '/assets/command/hero-drape.jpg', eyebrow: 'Command', title: `${greeting}, ${firstName(ctx)}.`, subtitle })}

<div class="ui-overview">
<div class="ui-overview__figures">
${ui.StatCard({
    label: `Revenue (${t.days}d)`, value: whole(t.cur.revenue), delta: revDelta,
    chart: ui.Sparkline(t.series, { label: `Cumulative verified payments over the last ${t.days} days` }),
    sub: t.cur.revenue ? html`${t.cur.payments} verified payment${t.cur.payments === 1 ? '' : 's'}${t.prev.revenue ? html` · vs ${whole(t.prev.revenue)} the ${t.days} days before` : ''}${t.cur.simulatedRevenue ? html` · <span class="ui-sim">${whole(t.cur.simulatedRevenue)} simulated</span>` : ''}` : `No verified payments in the last ${t.days} days`,
    href: '/command/performance', cls: 'ui-stat--wide',
  })}
<div class="ui-pair">
${ui.StatCard({ label: 'Active projects', value: String(counts.active), sub: counts.active ? [[counts.inProduction, 'in production'], [counts.awaitingDeposit, 'awaiting deposit'], [counts.scoping, 'scoping']].filter(([k]) => k).map(([k, l]) => `${k} ${l}`).join(' · ') : 'None yet', href: '/command/projects' })}
${ui.StatCard({ label: `Margin (${t.days}d)`, value: t.cur.margin === null ? '—' : pct(t.cur.margin), delta: marginDelta, sub: t.cur.margin === null ? 'Needs revenue in the period' : `${whole(t.cur.expenses)} costs`, href: '/command/performance' })}
</div>
</div>

${ui.Section({ title: 'Today’s focus', id: 'focus', body: focus.length ? ui.List(focus.map((f) => ({ icon: f.icon, tone: f.tone, title: f.title, href: f.href })), { cls: 'ui-list--card' }) : ui.EmptyState({ title: 'Nothing needs you right now.', body: 'Approvals, risks and failures will appear here as they happen.' }) })}

${ui.Section({ title: 'Company health', id: 'health', body: html`<details class="ui-card ui-health">
  <summary class="ui-health__summary">${ui.StatusDot(health.overall === 'ok' ? 'success' : health.overall === 'watch' ? 'attention' : 'danger')}<span class="ui-health__state">${health.label}</span><span class="ui-health__hint">${health.checks.filter((c) => c.status !== 'ok').length ? `${health.checks.filter((c) => c.status !== 'ok').length} of ${health.checks.length} checks need a look` : `All ${health.checks.length} checks clear`}</span>${ui.Icon('chevron', 'ui-health__chev')}</summary>
  ${ui.List(health.checks.map((c) => ({ dot: c.status === 'ok' ? 'success' : c.status === 'watch' ? 'attention' : 'danger', title: c.label, meta: c.detail, href: c.link })))}
</details>` })}

${ui.Section({ title: 'Morning Brief', id: 'brief', body: ui.Card({ href: '/command/brief', cls: 'ui-brief-card', body: brief ? html`<p class="ui-brief-card__headline">${brief.content.headline.text}</p><p class="ui-brief-card__meta">${fmtLocal(brief.ready_at, tz)} · from ${brief.facts.length} verified facts</p>` : pendingBrief ? html`<p class="ui-brief-card__meta">Your brief is being written…</p>` : html`<p class="ui-brief-card__meta">No brief yet. It arrives each morning at ${ctx.app.settings.get('brief_hour')}:00, or generate one now.</p>` }) })}

${ui.Section({ title: 'Studio', id: 'studio', body: ui.List([
    { icon: 'performance', title: 'Performance', meta: 'Revenue, profit, turnaround, efficiency', href: '/command/performance' },
    { icon: 'bell', title: 'Notifications', href: '/command/notifications' },
    { icon: 'settings', title: 'Settings', meta: 'Notifications, agent permissions, providers, budgets', href: '/command/settings' },
  ], { cls: 'ui-list--card' }) })}
</div>`,
  });
}

// ── Morning Brief ─────────────────────────────────────────────────────
const BRAIN_LABEL = { anthropic: 'Written by Claude', openai: 'Written by OpenAI', simulated: 'Written by a SIMULATED test model', rules: 'Compiled from records without AI' };
function brief(ctx, { brief: b, pending, history }) {
  const tz = tzOf(ctx);
  const facts = b ? new Map(b.facts.map((f) => [f.id, f])) : new Map();
  const cite = (ids) => html`<span class="c-cite">${ids.map((id) => html`<a href="#fact-${id}" aria-label="Source ${id}">${id.slice(1)}</a>`)}</span>`;
  const genForm = html`<form method="post" action="/command/actions">${csrf(ctx)}<input type="hidden" name="type" value="generate_brief"><button class="c-btn" type="submit">Generate a new brief</button></form>`;
  return shell(ctx, {
    title: 'Morning Brief', tab: 'brief',
    body: html`${pending ? html`<p class="c-flash" role="status">A new brief is being written. Refresh in a moment.</p>` : ''}
${!b ? html`<section class="c-section"><h1 class="c-serif c-h1">No brief yet</h1><p class="c-muted">Each morning at ${ctx.app.settings.get('brief_hour')}:00 (${tz}) the app collects verified events since the last brief and summarises them.</p>${genForm}</section>` : html`
<article class="c-brief">
  <p class="c-eyebrow">${fmtLocal(b.window_start, tz)} – ${fmtLocal(b.window_end, tz)}</p>
  <h1 class="c-serif c-h1">${b.content.headline.text}${b.content.headline.fact_ids.length ? cite(b.content.headline.fact_ids) : ''}</h1>
  <p class="c-provenance">${dot(b.brain === 'rules' ? 'neutral' : 'ok')}${BRAIN_LABEL[b.brain] || b.brain} from ${b.facts.length} verified facts.${b.dropped ? html` <strong>${b.dropped} statement(s) removed</strong> because no fact supported them.` : ''}</p>
  ${b.content.sections.map((s) => html`<section class="c-brief__section"><h2 class="c-label">${s.title}</h2><ul class="c-brief__items">${s.items.map((it) => html`<li>${it.text}${cite(it.fact_ids)}</li>`)}</ul></section>`)}
  ${b.content.actions.length ? html`<section class="c-brief__section"><h2 class="c-label">Recommended</h2><ul class="c-actions-list">${b.content.actions.map((a) => html`<li><span>${a.text}${cite(a.fact_ids)}</span>${a.action_type ? html`<form method="post" action="/command/actions">${csrf(ctx)}<input type="hidden" name="type" value="${a.action_type}"><input type="hidden" name="target" value="${a.target_id}"><input type="hidden" name="source" value="brief"><button class="c-btn c-btn--small" type="submit">Review</button></form>` : html`<a class="c-btn c-btn--small" href="/command/approvals">Open</a>`}</li>`)}</ul></section>` : ''}
  <details class="c-sources"><summary>Sources (${b.facts.length})</summary><ol>${b.facts.map((f) => html`<li id="fact-${f.id}">${f.link ? html`<a class="c-source" href="${f.link}"><span class="c-mono">${f.id}</span><span>${f.text}</span></a>` : html`<span class="c-source"><span class="c-mono">${f.id}</span><span>${f.text}</span></span>`}</li>`)}</ol></details>
</article>
${genForm}`}
${history.length > 1 ? html`<section class="c-section"><h2 class="c-section-title">Earlier briefs</h2><ul class="c-list">${history.filter((h) => !b || h.id !== b.id).map((h) => html`<li><a class="c-list__row" href="/command/brief/${h.id}"><span>${h.brief_date} <span class="c-muted c-small">${h.status === 'ready' ? (BRAIN_LABEL[h.brain] || h.brain) : h.status}</span></span>${icon('arrow', 'i i--end')}</a></li>`)}</ul></section>` : ''}`,
  });
}

// ── Projects ──────────────────────────────────────────────────────────
const PROJECT_TABS = [['active', 'Active'], ['production', 'Production'], ['review', 'Review'], ['attention', 'Attention'], ['done', 'Done']];
const PROJECT_EMPTY = {
  active: ['No active projects', 'New inquiries become projects once the Sales Agent has scoped them.'],
  production: ['Nothing in production', 'Projects move here when the deposit is verified.'],
  review: ['Nothing waiting for your review', 'Quotes, offers and deliverables that need you will show here.'],
  attention: ['Nothing needs attention', 'Blocked, overdue or waiting projects will show here.'],
  done: ['No finished projects yet', ''],
};
function projects(ctx, { rows, counts, tab }) {
  return shell(ctx, {
    title: 'Projects', tab: 'projects',
    body: html`${ui.PageHeader({ title: 'Projects' })}
${ui.SegmentedTabs(PROJECT_TABS.map(([id, label]) => ({ label, count: counts[id], href: `/command/projects?tab=${id}`, current: tab === id })), { label: 'Filter projects' })}
${rows.length ? html`<ul class="ui-projects">${rows.map((p) => html`<li><a class="ui-card ui-card--link ui-project" href="/command/projects/${p.id}">
  ${ui.Thumb({ src: p.thumbFileId ? `/command/projects/${p.id}/thumb` : null, alt: p.thumbFileId ? `Client reference for ${p.name}` : `${p.category || 'Garment'} — studio drawing`, garment: p.garment })}
  <span class="ui-project__body">
    <span class="ui-project__top"><span class="ui-project__code">${p.code}</span>${ui.StatusPill({ tone: p.status_.tone, label: p.status_.label })}</span>
    <span class="ui-project__name">${p.name}</span>
    <span class="ui-project__meta">${p.packageLabel}${p.due_date ? ` · due ${p.due_date}` : ''}</span>
    ${p.prod_total ? ui.ProgressBar({ value: p.prod_done, max: p.prod_total, label: `Production tasks done for ${p.code}` }) : html`<span class="ui-project__stage">${p.stage}</span>`}
  </span>
  ${ui.Icon('chevron', 'ui-project__chev')}
</a></li>`)}</ul>` : ui.EmptyState({ title: PROJECT_EMPTY[tab][0], body: PROJECT_EMPTY[tab][1] })}`,
  });
}

const STAGES = ['triage', 'scoping', 'awaiting_quote_approval', 'awaiting_client_acceptance', 'awaiting_deposit', 'setup', 'in_production', 'awaiting_final_payment', 'ready_for_release', 'completed'];
function project(ctx, { p, states }) {
  const tz = tzOf(ctx);
  const currentIdx = STAGES.indexOf(p.workflow_state);
  const statusDot = (s) => dot({ signed_off: 'ok', approved: 'ok', released: 'ok', done: 'ok', paid: 'ok', submitted: 'watch', in_review: 'watch', recommended: 'watch', offered: 'neutral', accepted: 'neutral', changes_requested: 'watch', declined: 'act', rejected: 'neutral', open: 'watch', draft: 'neutral' }[s] || 'neutral');
  return shell(ctx, {
    title: p.code, tab: 'projects', back: '/command/projects',
    body: html`<section class="c-hero">
  <p class="c-eyebrow"><span class="c-mono">${p.code}</span> · ${p.brand_name}</p>
  <h1 class="c-serif c-h1">${p.name}</h1>
  <p class="c-muted">${p.stage}${p.due_date ? ` · due ${p.due_date}` : ''}${p.workflow_paused ? ' · paused' : ''}</p>
  ${p.blocked_reason ? html`<p class="c-flash c-flash--error">${p.blocked_reason}</p>` : ''}
</section>
${p.workflow_state ? html`<ol class="c-stages" aria-label="Stages">${STAGES.map((s, i) => html`<li class="${i < currentIdx ? 'is-done' : i === currentIdx ? 'is-current' : ''}" ${i === currentIdx ? raw('aria-current="step"') : ''}><span>${(states[s] || {}).label || s}</span></li>`)}</ol>` : ''}
<div class="c-grid">
<section class="c-card"><h2 class="c-label">Money</h2><dl class="c-kv">
  <dt>Quoted</dt><dd>${money(p.money.quoted)}</dd><dt>Collected</dt><dd>${money(p.money.collected)}</dd><dt>Costs</dt><dd>${money(p.money.costs)}</dd>
  <dt>Projected profit</dt><dd>${money(p.money.projectedProfit)} <span class="c-muted">${pct(p.money.projectedMargin)}</span></dd></dl>
  ${p.invoices.length ? html`<ul class="c-mini">${p.invoices.map((i) => html`<li>${statusDot(i.status)}<span>${i.number} · ${i.kind}</span><span>${money(i.amount_cents)} · ${i.status}</span></li>`)}</ul>` : ''}
</section>
<section class="c-card"><h2 class="c-label">Waiting on people</h2>${p.openActions.length ? html`<ul class="c-mini">${p.openActions.map((h) => html`<li>${dot(h.kind === 'escalation' ? 'act' : 'watch')}<span>${h.title}</span></li>`)}</ul>` : empty('Nothing open.')}</section>
</div>
<section class="c-section"><h2 class="c-section-title">Production</h2>
${p.tasks.length ? html`<ul class="c-cards">${p.tasks.map((t) => {
    const as = p.assignments.filter((a) => a.task_id === t.id);
    return html`<li class="c-card"><div class="c-project__top">${statusDot(t.status)}<strong>${t.title}</strong><span class="c-pill">${t.route || 'unrouted'}</span></div>
    ${as.length ? html`<ul class="c-mini">${as.map((a) => html`<li>${statusDot(a.status)}<span>${a.contractor_name}</span><span>${a.status.replace('_', ' ')} · ${money(a.fee_cents)}${a.due_date ? ` · due ${a.due_date}` : ''}</span></li>`)}</ul>` : ''}</li>`;
  })}</ul>` : empty('No production tasks yet.')}
</section>
<section class="c-section"><h2 class="c-section-title">Deliverables</h2>
${p.deliverables.length ? html`<ul class="c-list">${p.deliverables.map((d) => html`<li class="c-list__row">${statusDot(d.status)}<span><strong>${d.title}</strong> <span class="c-muted c-small">v${d.version} · ${d.status.replace('_', ' ')}${d.qa ? ` · QA ${d.qa.result.toUpperCase()}` : ''}</span></span></li>`)}</ul>` : empty('No deliverables yet.')}
</section>
<section class="c-section"><h2 class="c-section-title">Timeline</h2>
${p.timeline.length ? html`<ol class="c-timeline">${p.timeline.map((t) => html`<li><span class="c-small c-muted">${fmtLocal(t.created_at, tz)}</span> ${t.label}</li>`)}</ol>` : empty('No workflow history.')}
</section>
<a class="c-card c-card--link c-cta" href="/command/chat?project=${p.id}"><span>Ask Command about ${p.code}</span>${icon('arrow')}</a>`,
  });
}

// ── Approvals & action previews ───────────────────────────────────────
const GROUPS = [['quotes', 'Quotes'], ['contractors', 'Contractor assignments'], ['finance', 'Financial'], ['deliverables', 'Deliverable reviews'], ['messages', 'Messages']];
const AGENT_NAME = { sales: 'Sales Agent', talent: 'Talent Agent', client_success: 'Client Success', project_manager: 'Project Manager', production: 'Production', orchestrator: 'Orchestrator', qa: 'QA Agent' };
function sourceLabel(x) {
  if (!x.source || x.source === 'manual' || x.source.startsWith('staff:')) return '';
  if (x.source.startsWith('agent:')) return ` · from ${AGENT_NAME[x.source.slice(6)] || x.source.slice(6)}`;
  if (x.group === 'quotes') return ` · drafted by Sales Agent (${{ rules: 'rules', claude: 'Claude', openai: 'OpenAI' }[x.source] || x.source})`;
  return ` · from ${x.source}`;
}
const ALT_LABEL = { reject_assignment: 'Reject', discard_message: 'Discard' };
function approvals(ctx, { items }) {
  const tz = tzOf(ctx);
  const review = (type, target, label, cls = '') => html`<form method="post" action="/command/actions">${csrf(ctx)}<input type="hidden" name="type" value="${type}"><input type="hidden" name="target" value="${target}"><button class="c-btn ${cls}" type="submit">${label}</button></form>`;
  return shell(ctx, {
    title: 'Approvals', tab: 'approvals',
    body: html`<h1 class="c-serif c-h1 c-h1--page">Approvals</h1>
<p class="c-muted">Nothing here happens until you review the preview and confirm. Quotes, offers, messages, invoices and releases need your password if you last signed in more than 12 hours ago.</p>
${items.length ? GROUPS.map(([g, label]) => {
    const list = items.filter((x) => x.group === g);
    if (!list.length) return '';
    return html`<section class="c-section" id="${g === 'finance' ? 'finance' : g}"><h2 class="c-section-title">${label} <span class="c-count">${list.length}</span></h2>
<ul class="c-cards">${list.map((x) => html`<li class="c-card c-approval">
  <div class="c-approval__main"><p class="c-approval__title">${x.exception ? dot('act') : ''}${x.title}</p><p class="c-muted c-small">${x.detail}</p>
  <p class="c-small c-muted">${x.amount ? html`<strong class="c-amount">${x.amount}</strong> · ` : ''}waiting ${ago(x.since, Date.now())}${sourceLabel(x)}</p></div>
  <div class="c-approval__actions">
  ${x.needsNote ? html`<form method="post" action="/command/actions" class="c-form c-form--inline">${csrf(ctx)}<input type="hidden" name="type" value="${x.type}"><input type="hidden" name="target" value="${x.targetId}"><label for="note-${x.targetId}" class="c-sr">Your note</label><input id="note-${x.targetId}" name="note" required maxlength="500" placeholder="What did you check or do?"><button class="c-btn" type="submit">Review</button></form>`
    : html`${review(x.type, x.targetId, 'Review', 'c-btn--primary')}${x.alt ? review(x.alt, x.targetId, ALT_LABEL[x.alt], 'c-btn--ghost') : ''}`}
  ${x.projectId ? html`<a class="c-btn c-btn--small c-btn--ghost" href="/command/projects/${x.projectId}">Project</a>` : ''}
  </div></li>`)}</ul></section>`;
  }) : html`<section class="c-section c-done">${dot('ok')}<p class="c-serif c-h2">All clear.</p><p class="c-muted">Nothing is waiting for you${tz ? '' : ''}.</p></section>`}`,
  });
}

function action(ctx, { a, needsPassword }) {
  const p = a.preview;
  const open = a.status === 'proposed';
  return shell(ctx, {
    title: 'Review', tab: a.source === 'chat' ? 'chat' : 'approvals', back: a.source === 'chat' && a.conversation_id ? `/command/chat/${a.conversation_id}` : '/command/approvals',
    body: html`<article class="c-preview">
  <p class="c-eyebrow">${p.label}</p>
  <h1 class="c-serif c-h1">${p.title}</h1>
  <p class="c-risk c-risk--${a.risk}">${a.risk === 'high' ? 'High impact' : 'Low impact'} · ${p.why}</p>
  ${p.rows && p.rows.length ? html`<dl class="c-kv c-kv--preview">${p.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : ''}
  ${p.items && p.items.length ? html`<ul class="c-preview__items">${p.items.map((i) => html`<li>${i}</li>`)}</ul>` : ''}
  ${p.text ? html`<div class="c-preview__text">${p.text.split(/\n{2,}/).map((para) => html`<p>${para}</p>`)}</div>` : ''}
  ${p.warnings && p.warnings.length ? html`<div class="c-flash c-flash--error" role="alert">${p.warnings.map((w) => html`<p>${w}</p>`)}</div>` : ''}
  <h2 class="c-label">What happens when you confirm</h2>
  <ul class="c-effects">${p.effects.map((e) => html`<li>${e}</li>`)}</ul>
  <p class="c-small c-muted">Proposed by ${a.proposed_by.replace('staff:', '')} via ${a.source}. The preview was built from the records, not by a model. If anything changes before you confirm, this proposal expires instead of running.</p>
  ${open ? html`<form method="post" action="/command/actions/${a.id}/confirm" class="c-form c-confirm">${csrf(ctx)}<input type="hidden" name="digest" value="${a.digest}">
    ${needsPassword ? html`<label for="password">Your password <span class="c-muted c-small">(required for high-impact actions after 12 hours)</span></label><input id="password" name="password" type="password" autocomplete="current-password" required>` : ''}
    <button class="c-btn c-btn--primary c-btn--block" type="submit">Confirm</button></form>
  <form method="post" action="/command/actions/${a.id}/cancel">${csrf(ctx)}<button class="c-btn c-btn--ghost c-btn--block" type="submit">Cancel</button></form>`
    : html`<p class="c-flash ${a.status === 'failed' || a.status === 'expired' ? 'c-flash--error' : ''}">This action was ${a.status}${a.result && a.result.message ? html`: ${a.result.message}` : ''}${a.error ? html` — ${a.error}` : ''}.</p>`}
</article>`,
  });
}

// ── Agent Studio ──────────────────────────────────────────────────────
const STATE_DOT = { working: 'ok', idle: 'neutral', queued: 'neutral', failing: 'act', paused: 'watch' };
function agents(ctx, { agents: list, failed, recent, provider, spent, budget, paused }) {
  const usd = (micros) => `$${(micros / 1e6).toFixed(2)}`;
  const review = (jobId) => html`<form method="post" action="/command/actions">${csrf(ctx)}<input type="hidden" name="type" value="retry_task"><input type="hidden" name="target" value="${jobId}"><button class="c-btn c-btn--small" type="submit">Retry</button></form>`;
  return shell(ctx, {
    title: 'Agent Studio', tab: 'agents',
    body: html`<h1 class="c-serif c-h1 c-h1--page">Agent Studio</h1>
<section class="c-card"><dl class="c-kv"><dt>Model</dt><dd>${provider}</dd><dt>AI spend this month</dt><dd>${usd(spent)} of $${budget}<meter min="0" max="${budget}" value="${spent / 1e6}" high="${budget * 0.75}" optimum="0" aria-label="AI budget used">${usd(spent)}</meter></dd><dt>Automation</dt><dd>${paused ? 'Paused' : 'Running'}</dd></dl></section>
<section class="c-section"><h2 class="c-section-title">Agents</h2><ul class="c-cards">${list.map((a) => {
    const def = REGISTRY[a.id];
    return html`<li class="c-card"><div class="c-project__top">${dot(STATE_DOT[a.state], a.state)}<strong>${def ? def.name : a.id}</strong><span class="c-pill">${a.state}</span>${a.mode !== 'auto' ? html`<span class="c-pill c-pill--warn">${a.mode}</span>` : ''}</div>
    <p class="c-muted c-small">${def ? def.purpose : ''}</p>
    <p class="c-small">${a.succeeded} done · ${a.queued} queued · ${a.running} running · ${a.failed ? html`<strong class="c-bad">${a.failed} failed</strong>` : '0 failed'} · ${usd(a.costMonthMicros)} this month</p></li>`;
  })}</ul></section>
<section class="c-section"><h2 class="c-section-title">Failures <span class="c-count">${failed.length}</span></h2>
${failed.length ? html`<ul class="c-cards">${failed.map((j) => html`<li class="c-card"><p><a href="/command/agents/tasks/${j.id}"><strong>${j.agent}.${j.action}</strong></a> ${j.project_code ? html`<span class="c-mono c-small">${j.project_code}</span>` : ''}</p><p class="c-small c-muted">${j.error_kind}: ${j.error}</p>${review(j.id)}</li>`)}</ul>` : empty('No failed tasks.')}
</section>
<section class="c-section"><h2 class="c-section-title">Recent tasks</h2>
<ul class="c-list">${recent.map((j) => html`<li><a class="c-list__row" href="/command/agents/tasks/${j.id}">${dot(j.status === 'succeeded' ? 'ok' : j.status === 'failed' ? 'act' : j.status === 'running' ? 'watch' : 'neutral')}<span><strong>${j.agent}.${j.action}</strong> <span class="c-small c-muted">${j.project_code || ''} · ${j.brain === 'model' ? (j.simulated ? 'simulated model' : (j.provider || 'model')) : j.brain || '—'} · ${usd(j.cost_micros || 0)}</span></span>${icon('arrow', 'i i--end')}</a></li>`)}</ul>
</section>`,
  });
}

function agentTask(ctx, { job, session, runs, transcript }) {
  const usd = (micros) => `$${(micros / 1e6).toFixed(4)}`;
  const block = (b) => {
    if (b.type === 'text') return html`<div class="c-turn__text">${richText(b.text)}</div>`;
    if (b.type === 'tool_use') return html`<div class="c-call"><span class="c-call__name">→ ${b.name}</span><pre>${JSON.stringify(b.input, null, 1)}</pre></div>`;
    if (b.type === 'tool_result') {
      const content = Array.isArray(b.content) ? b.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} attached]`)).join('\n') : String(b.content);
      return html`<div class="c-call ${b.is_error ? 'c-call--error' : ''}"><span class="c-call__name">← result${b.is_error ? ' (refused)' : ''}</span><pre>${content.slice(0, 3000)}</pre></div>`;
    }
    if (b.type === 'thinking') return html`<p class="c-small c-muted">Reasoning (not shown)</p>`;
    return '';
  };
  const simulated = runs.some((r) => r.provider === 'simulated');
  return shell(ctx, {
    title: `Task ${job.id}`, tab: 'agents', back: '/command/agents',
    body: html`<p class="c-eyebrow">Agent task #${job.id}</p><h1 class="c-serif c-h1">${job.agent}.${job.action}</h1>
<p class="c-muted">${job.status} · ${job.attempts}/${job.max_attempts} attempt(s) · ${session ? (session.brain === 'model' ? `model (${simulated ? 'SIMULATED' : session.provider})` : 'rules') : 'not started'}${session ? ` · ${session.turns} turn(s) · ${session.tool_calls} tool call(s) · ${usd(session.cost_micros)}` : ''}</p>
${job.error ? html`<p class="c-flash c-flash--error">${job.error_kind}: ${job.error}</p>` : ''}
${simulated ? html`<p class="c-flash">Simulated model: these turns came from a scripted test double, not a real provider.</p>` : ''}
<section class="c-section"><h2 class="c-section-title">Execution log</h2>
${!session ? empty('Not started.') : session.brain === 'rules'
    ? html`<ol class="c-log">${transcript.map((e, i) => html`<li class="c-turn"><p class="c-label">Step ${i + 1} · rules</p><div class="c-call"><span class="c-call__name">→ ${e.tool}</span><pre>${JSON.stringify(e.input, null, 1)}</pre></div><div class="c-call"><span class="c-call__name">← result</span><pre>${String(e.result).slice(0, 3000)}</pre></div></li>`)}</ol>`
    : html`<ol class="c-log">${transcript.map((m, i) => html`<li class="c-turn c-turn--${m.role}"><p class="c-label">${i === 0 ? 'Task' : m.role === 'assistant' ? 'Agent' : 'Tool results'}</p>${Array.isArray(m.content) ? m.content.map(block) : html`<div class="c-turn__text">${richText(String(m.content))}</div>`}</li>`)}</ol>`}
</section>
<section class="c-section"><h2 class="c-section-title">Model calls</h2>
${runs.length ? html`<ul class="c-list">${runs.map((r) => html`<li class="c-list__row"><span><strong>${r.task.split('#')[1] ? `Turn ${r.task.split('#')[1]}` : r.task}</strong> <span class="c-small c-muted">${r.provider} · ${r.model_served || r.model_requested || '—'} · ${r.input_tokens}/${r.output_tokens} tokens · ${usd(r.cost_micros)} · ${r.status}</span></span></li>`)}</ul>` : empty('No model calls.')}
</section>
<a class="c-link" href="/admin/ops/tasks/${job.id}">Open in the studio dashboard</a>`,
  });
}

// ── Command Chat ──────────────────────────────────────────────────────
const SUGGESTIONS = ['What happened overnight?', 'Which projects need my attention?', 'What did we earn this week?', 'Which agents are blocked?', 'Find an approved technical designer for this project', 'Prepare a quote for this customer'];
function actionCard(ctx, a) {
  if (!a) return '';
  const open = a.status === 'proposed';
  return html`<a class="ui-action ui-action--${a.risk} ui-action--${a.status}" href="/command/actions/${a.id}">
  <span class="ui-action__text"><span class="ui-overline">${open ? (a.risk === 'high' ? 'High impact · needs you' : 'Needs your confirmation') : a.status}</span><span class="ui-action__title">${a.preview.title}</span></span>
  <span class="ui-action__go">${open ? 'Review' : 'View'}${ui.Icon('chevron')}</span></a>`;
}
function chatMessage(ctx, msg) {
  const data = msg.data || {};
  if (msg.role === 'user') return html`<li class="ui-msg ui-msg--user"><div class="ui-msg__bubble">${msg.content}</div>${ui.Avatar(ctx.user.name)}</li>`;
  const acts = (data.actions || []).map((id) => ctx.app.command.actions.get(id)).filter(Boolean);
  const by = { rules: 'Answered from the records (rules)', simulated: 'Simulated test model', anthropic: 'Claude', openai: 'OpenAI' }[data.brain] || '';
  const read = (data.tools || []).filter((t) => t !== 'propose_action');
  return html`<li class="ui-msg ui-msg--assistant"><div class="ui-reply">
  <p class="ui-reply__head">${ui.Icon('spark')}<span>Command</span></p>
  <div class="ui-reply__body">${richText(msg.content)}</div>
  ${acts.length ? html`<div class="ui-reply__actions">${acts.map((a) => actionCard(ctx, a))}</div>` : ''}
</div>${by ? html`<p class="ui-msg__meta">${by}${read.length ? ` · read ${read.join(', ').replace(/_/g, ' ')}` : ''}</p>` : ''}</li>`;
}
function chat(ctx, { conversation, messages, conversations, projectId, mode }) {
  return shell(ctx, {
    title: 'Command', tab: 'command',
    body: html`<div class="ui-chat" data-chat>
${ui.PageHeader({ title: 'Command', subtitle: 'Ask about the business. Anything that would change something comes back to you to confirm.', actions: conversation ? ui.Button({ label: 'New', href: '/command/chat', variant: 'secondary', small: true }) : '' })}
<p class="ui-chat__mode">${ui.StatusDot(mode.model ? 'success' : 'neutral')}<span>${mode.label}</span></p>
<ol class="ui-chat__log" aria-live="polite" aria-label="Conversation" data-chat-log>${messages.map((m) => chatMessage(ctx, m))}</ol>
<div class="ui-prompts" id="prompts" data-suggest ${messages.length ? raw('hidden') : ''}>
  <p class="ui-overline">Try asking</p>
  <ul class="ui-list ui-list--card">${SUGGESTIONS.map((s) => html`<li><button type="button" class="ui-row ui-row--button" data-fill="${s}"><span class="ui-row__text"><span class="ui-row__title">${s}</span></span>${ui.Icon('chevron', 'ui-row__chevron')}</button></li>`)}</ul>
</div>
<form class="ui-composer" method="post" action="/command/chat" data-chat-form>
  ${csrf(ctx)}<input type="hidden" name="conversation_id" value="${conversation ? conversation.id : ''}"><input type="hidden" name="project_id" value="${projectId || ''}">
  <button type="button" class="ui-iconbtn ui-composer__more" aria-label="Suggested questions" aria-controls="prompts" aria-expanded="${messages.length ? 'false' : 'true'}" data-prompts-toggle>${ui.Icon('plus')}</button>
  <label for="q" class="c-sr">Message Command</label>
  <textarea id="q" name="text" rows="1" maxlength="2000" required placeholder="${projectId ? 'Ask about this project…' : 'Message Command…'}" enterkeyhint="send"></textarea>
  <button class="ui-iconbtn ui-composer__send" type="submit" aria-label="Send">${ui.Icon('send')}</button>
</form>
${conversations.length && !conversation ? ui.Section({ title: 'Recent conversations', id: 'recent', body: ui.List(conversations.map((c) => ({ title: c.title, meta: fmtLocal(c.updated_at, tzOf(ctx)), href: `/command/chat/${c.id}` })), { cls: 'ui-list--card' }) }) : ''}
</div>`,
  });
}

// ── Performance ───────────────────────────────────────────────────────
function performance(ctx, { period, periodName, weeks, months, eff }) {
  const chips = [['this_week', 'Week'], ['this_month', 'Month'], ['last_month', 'Last month'], ['year_to_date', 'Year']];
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.revenue, w.expenses)));
  const W = 320; const H = 120; const bw = W / weeks.length;
  const bars = weeks.map((w, i) => {
    const rh = Math.round((w.revenue / max) * (H - 18));
    const eh = Math.round((w.expenses / max) * (H - 18));
    return `<rect class="bar ${w.partial ? 'bar--partial' : ''}" x="${(i * bw + 3).toFixed(1)}" y="${H - 14 - rh}" width="${(bw * 0.62 - 3).toFixed(1)}" height="${Math.max(rh, 1)}"><title>Week of ${w.week}: ${whole(w.revenue)} in</title></rect><rect class="bar bar--exp" x="${(i * bw + bw * 0.62).toFixed(1)}" y="${H - 14 - eh}" width="${(bw * 0.3).toFixed(1)}" height="${Math.max(eh, 1)}"><title>Week of ${w.week}: ${whole(w.expenses)} out</title></rect>`;
  }).join('');
  const nd = (n) => html`<span class="c-muted">Not enough data yet${n !== undefined ? ` (${n})` : ''}</span>`;
  const days = (d) => (d === null ? nd() : `${d.toFixed(1)} days`);
  return shell(ctx, {
    title: 'Performance', tab: 'performance', wide: true,
    body: html`<h1 class="c-serif c-h1 c-h1--page">Performance</h1>
<nav class="c-chips" aria-label="Period">${chips.map(([k, l]) => html`<a class="c-chip" href="/command/performance?period=${k}" ${periodName === k ? raw('aria-current="true"') : ''}>${l}</a>`)}</nav>
<div class="c-kpis">
  <div class="c-kpi"><p class="c-kpi__label">Revenue</p><p class="c-kpi__value">${whole(period.revenue)}</p><p class="c-kpi__sub">${period.payments} verified payment(s)${period.simulatedRevenue ? html`<br><span class="c-sim">incl. ${whole(period.simulatedRevenue)} simulated</span>` : ''}</p></div>
  <div class="c-kpi"><p class="c-kpi__label">Expenses</p><p class="c-kpi__value">${whole(period.expenses)}</p><p class="c-kpi__sub">Contractors ${whole(period.contractorCosts)} · AI ${money(period.aiCents)}</p></div>
  <div class="c-kpi"><p class="c-kpi__label">Profit</p><p class="c-kpi__value">${whole(period.profit)}</p><p class="c-kpi__sub">${period.margin === null ? 'No revenue' : `${pct(period.margin)} margin`}</p></div>
  <div class="c-kpi"><p class="c-kpi__label">Booked</p><p class="c-kpi__value">${whole(period.booked)}</p><p class="c-kpi__sub">Quotes accepted</p></div>
</div>
<section class="c-card"><h2 class="c-label">Last 12 weeks</h2>
  <figure class="c-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly money in and out for the last 12 weeks; detail in the table below">${raw(bars)}<line class="axis" x1="0" x2="${W}" y1="${H - 14}" y2="${H - 14}"/><text class="tick" x="0" y="${H - 2}">${weeks[0].week.slice(5)}</text><text class="tick" x="${W}" y="${H - 2}" text-anchor="end">now</text></svg>
  <figcaption class="c-legend"><span class="c-legend__in">Money in</span><span class="c-legend__out">Money out</span></figcaption></figure>
</section>
<section class="c-card"><h2 class="c-label">By month</h2>
<div class="c-table-wrap"><table class="c-table"><thead><tr><th scope="col">Month</th><th scope="col" class="r">In</th><th scope="col" class="r">Out</th><th scope="col" class="r">Profit</th><th scope="col" class="r">Margin</th></tr></thead>
<tbody>${months.map((m) => html`<tr><th scope="row">${m.month}${m.partial ? '*' : ''}</th><td class="r">${whole(m.revenue)}</td><td class="r">${whole(m.expenses)}</td><td class="r">${whole(m.profit)}</td><td class="r">${pct(m.margin)}</td></tr>`)}</tbody></table></div>
<p class="c-note">* month to date. Cash basis: verified payments minus recorded costs, AI and external services.</p></section>
<div class="c-grid">
<section class="c-card"><h2 class="c-label">Turnaround</h2><dl class="c-kv">
  <dt>Inquiry → quote sent</dt><dd>${days(eff.turnaround.inquiryToQuote)}</dd>
  <dt>Deposit → production</dt><dd>${days(eff.turnaround.depositToProduction)}</dd>
  <dt>Inquiry → completed</dt><dd>${days(eff.turnaround.inquiryToCompletion)}</dd></dl></section>
<section class="c-card"><h2 class="c-label">Production efficiency</h2><dl class="c-kv">
  <dt>QA pass on first version</dt><dd>${eff.qaSample ? html`${pct(eff.qaFirstPass)} <span class="c-muted">of ${eff.qaSample}</span>` : nd(0)}</dd>
  <dt>Submissions needing changes</dt><dd>${eff.revisionSample ? html`${pct(eff.revisionRate)} <span class="c-muted">of ${eff.revisionSample}</span>` : nd(0)}</dd>
  <dt>Contractor work on time</dt><dd>${eff.onTimeSample ? html`${pct(eff.onTime)} <span class="c-muted">of ${eff.onTimeSample}</span>` : nd(0)}</dd>
  <dt>Offer response time</dt><dd>${eff.offerSample ? `${eff.offerResponseHours.toFixed(1)} h` : nd(0)}</dd>
  <dt>Automation rate</dt><dd>${eff.automationRate === null ? nd() : html`${pct(eff.automationRate)} <span class="c-muted">${eff.automationBasis.agentSteps} agent / ${eff.automationBasis.routineHumanSteps} routine human steps</span>`}</dd></dl></section>
</div>`,
  });
}

// ── Settings ──────────────────────────────────────────────────────────
const MODE_HELP = { auto: 'Model when available', rules: 'Rules only, never a model', paused: 'Paused — tasks wait' };
function settings(ctx, { values, providers, devices, integrationsConnected, vapidKey, kinds }) {
  const sel = (name, options, value, id) => html`<select id="${id || name}" name="${name}">${options.map(([v, l]) => html`<option value="${v}" ${String(value) === String(v) ? raw('selected') : ''}>${l}</option>`)}</select>`;
  const toolSummary = (agentId) => {
    const def = REGISTRY[agentId];
    const names = new Set();
    for (const a of Object.values(def.actions)) for (const t of a.tools) if (t !== 'submit_result') names.add(t);
    const by = { read: [], internal: [], draft: [], external: [] };
    for (const n of names) (by[TOOLS[n].effect] || []).push(n);
    return html`<p class="c-small c-muted">Reads ${by.read.length} · records ${by.internal.length} · drafts ${by.draft.length}${by.external.length ? ` · external ${by.external.length} (only with autonomous production)` : ''}</p>`;
  };
  return shell(ctx, {
    title: 'Settings', tab: 'settings',
    body: html`<h1 class="c-serif c-h1 c-h1--page">Settings</h1>

<section class="c-card" id="notifications" aria-labelledby="n-h"><h2 id="n-h" class="c-label">Notifications</h2>
  <div class="c-push" data-push data-key="${vapidKey}">
    <p class="c-small" data-push-status>Push notifications: ${devices} device(s) registered.</p>
    <button class="c-btn" type="button" data-push-enable hidden>Enable on this device</button>
    <button class="c-btn c-btn--ghost" type="button" data-push-disable hidden>Turn off on this device</button>
    <p class="c-small c-muted">On iPhone, add Command to your Home Screen first (Share → Add to Home Screen). Pushes carry no business data; your phone fetches the details over your signed-in session.</p>
  </div>
  <form method="post" action="/command/settings/preferences" class="c-form">${csrf(ctx)}
    <fieldset><legend>Send a push for</legend>
    ${kinds.map(([k, label]) => html`<label class="c-check"><input type="checkbox" name="push_${k}" value="true" ${values[`push_${k}`] ? raw('checked') : ''}> ${label}</label>`)}</fieldset>
    <label for="brief_hour">Morning Brief time</label>${sel('brief_hour', Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`]), values.brief_hour)}
    <label for="timezone">Time zone</label><div class="c-row"><input id="timezone" name="timezone" value="${values.timezone}" autocapitalize="none" spellcheck="false"><button class="c-btn c-btn--small c-btn--ghost" type="button" data-tz-fill>Use this device's</button></div>
    <button class="c-btn c-btn--primary" type="submit">Save preferences</button>
  </form>
</section>

<section class="c-card" id="permissions" aria-labelledby="p-h"><h2 id="p-h" class="c-label">Agent permissions</h2>
  <p class="c-small c-muted">Each agent's tools are fixed in code: none can send, approve, pay, release files or change settings. Here you choose how each one runs. Changes are previewed and confirmed.</p>
  <form method="post" action="/command/settings/changes" class="c-form">${csrf(ctx)}
  ${ctx.app.settings.AGENT_IDS.map((id) => html`<div class="c-agent-setting"><label for="agent_mode_${id}"><strong>${REGISTRY[id].name}</strong></label>${toolSummary(id)}${sel(`agent_mode_${id}`, ctx.app.settings.AGENT_MODES.map((m) => [m, `${m} — ${MODE_HELP[m]}`]), values[`agent_mode_${id}`])}</div>`)}
  <label class="c-check"><input type="checkbox" name="orchestrator_paused" value="true" ${values.orchestrator_paused ? raw('checked') : ''}> Pause all automation</label>
  <label class="c-check"><input type="checkbox" name="autonomous_production" value="true" ${values.autonomous_production ? raw('checked') : ''} ${integrationsConnected || values.autonomous_production ? '' : raw('disabled')}> Autonomous production (INDEX V3 / FORM)${integrationsConnected ? '' : html` <span class="c-muted c-small">— connect a service first</span>`}</label>
  <input type="hidden" name="section" value="permissions">
  <button class="c-btn c-btn--primary" type="submit">Review changes</button></form>
</section>

<section class="c-card" id="providers" aria-labelledby="m-h"><h2 id="m-h" class="c-label">Model provider</h2>
  <form method="post" action="/command/settings/changes" class="c-form">${csrf(ctx)}<input type="hidden" name="section" value="provider">
  <fieldset><legend class="c-sr">Provider</legend>
  ${[['auto', 'Automatic', 'Anthropic if configured, else OpenAI, else rules'], ...providers.map((p) => [p.id, p.label, p.configured ? `${p.model} · configured${p.simulated ? ' (SIMULATED test double)' : ''}` : `Not configured — ${p.missing}`]), ['rules', 'Rules only', 'No model calls at all']].map(([v, l, d]) => html`<label class="c-radio"><input type="radio" name="ai_provider" value="${v}" ${values.ai_provider === v ? raw('checked') : ''} ${v !== 'auto' && v !== 'rules' && !providers.find((p) => p.id === v).configured ? raw('disabled') : ''}><span><strong>${l}</strong><span class="c-small c-muted">${d}</span></span></label>`)}
  </fieldset>
  <button class="c-btn c-btn--primary" type="submit">Review change</button></form>
  <p class="c-small c-muted">API keys are set on the server (environment), never in this app.</p>
</section>

<section class="c-card" id="budgets" aria-labelledby="b-h"><h2 id="b-h" class="c-label">Operational budgets</h2>
  <form method="post" action="/command/settings/changes" class="c-form">${csrf(ctx)}<input type="hidden" name="section" value="budgets">
  ${['ai_monthly_budget_usd', 'ai_project_budget_usd', 'external_project_budget_usd', 'external_job_estimate_usd', 'unusual_expense_usd'].map((k) => html`<label for="${k}">${ctx.app.settings.DEFINITIONS[k].label}</label><input id="${k}" name="${k}" value="${values[k]}" inputmode="decimal">`)}
  <button class="c-btn c-btn--primary" type="submit">Review changes</button></form>
</section>

<section class="c-card" aria-labelledby="s-h"><h2 id="s-h" class="c-label">Session</h2>
  <p class="c-small c-muted">Signed in as ${ctx.user.email}. Founder access is granted on the server only (FOUNDER_EMAIL or the founder script).</p>
  <div class="c-row"><form method="post" action="/command/logout">${csrf(ctx)}<button class="c-btn" type="submit">Sign out</button></form>
  <form method="post" action="/command/logout-all">${csrf(ctx)}<button class="c-btn c-btn--ghost" type="submit">Sign out all devices</button></form></div>
</section>`,
  });
}

function notifications(ctx, { rows, labels }) {
  const sev = { info: 'neutral', attention: 'watch', urgent: 'act' };
  return shell(ctx, {
    title: 'Notifications', tab: 'notifications',
    body: html`<div class="c-chat__head"><h1 class="c-serif c-h1 c-h1--page">Notifications</h1>${rows.some((r) => !r.read_at) ? html`<form method="post" action="/command/notifications/read">${csrf(ctx)}<button class="c-btn c-btn--small c-btn--ghost" type="submit">Mark all read</button></form>` : ''}</div>
${rows.length ? html`<ul class="c-list">${rows.map((n) => html`<li class="${n.read_at ? '' : 'is-unread'}"><a class="c-list__row" href="/command/notifications/${n.id}">${dot(sev[n.severity] || 'neutral')}<span><span class="c-label">${labels[n.kind]} · ${ago(n.created_at, Date.now())}</span><strong>${n.title}</strong>${n.body ? html`<span class="c-small c-muted">${n.body}</span>` : ''}</span></a></li>`)}</ul>` : empty('No notifications yet.')}`,
  });
}

function more(ctx) {
  const items = [['brief', '/command/brief', 'Morning Brief', 'Verified events and recommended actions'], ['agents', '/command/agents', 'Agent Studio', 'Status, logs, failures and cost'], ['performance', '/command/performance', 'Performance', 'Revenue, profit, turnaround, efficiency'], ['settings', '/command/settings', 'Settings', 'Notifications, agent permissions, providers, budgets'], ['bell', '/command/notifications', 'Notifications', 'Everything that needed you']];
  return shell(ctx, {
    title: 'More', tab: 'more',
    body: html`<h1 class="c-serif c-h1 c-h1--page">More</h1><ul class="c-list c-list--big">${items.map(([i, href, l, d]) => html`<li><a class="c-list__row" href="${href}">${icon(i)}<span><strong>${l}</strong><span class="c-small c-muted">${d}</span></span>${icon('arrow', 'i i--end')}</a></li>`)}</ul>
<p class="c-small c-muted"><a class="c-link" href="/admin">Open the studio dashboard</a> (separate sign-in)</p>`,
  });
}

module.exports = { shell, login, offline, errorPage, overview, brief, projects, project, approvals, action, agents, agentTask, chat, chatMessage, performance, settings, notifications, more, richText };
