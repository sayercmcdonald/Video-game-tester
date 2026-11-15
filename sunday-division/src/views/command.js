'use strict';
const { html, raw, esc, money } = require('../lib/util');
const { assetUrl } = require('../lib/assets');
const { fmtLocal, ago, localHour } = require('../command/time');
const { REGISTRY } = require('../agents/definitions');
const { TOOLS } = require('../agents/tools');
const ui = require('./command-ui');

// The five destinations (bottom tab bar on phones); the rail on wide screens adds the rest.
const NAV = [
  ['overview', '/command', 'Overview', true], ['projects', '/command/projects', 'Projects', true], ['agents', '/command/agents', 'Agents', true],
  ['approvals', '/command/approvals', 'Approvals', true], ['command', '/command/chat', 'Command', true],
  ['brief', '/command/brief', 'Morning Brief'], ['performance', '/command/performance', 'Performance'], ['settings', '/command/settings', 'Settings'],
];
const TAB_ALIAS = { chat: 'command', more: 'overview', notifications: 'overview', brief: 'overview', performance: 'overview', settings: 'overview' };

const tzOf = (ctx) => ctx.app.settings.get('timezone');
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session.csrf}">`;
const whole = (cents) => `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`;
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
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
<link rel="preload" href="/assets/fonts/cormorant-garamond-lining-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assetUrl('css/tokens.css')}">
<link rel="stylesheet" href="${assetUrl('css/ui.css')}">
<link rel="stylesheet" href="${assetUrl('css/command.css')}">
<script src="${assetUrl('js/command.js')}" defer></script>
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
${ctx.flash ? html`<p class="ui-flash" role="status">${ctx.flash}</p>` : ''}
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
<link rel="preload" href="/assets/fonts/cormorant-garamond-lining-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assetUrl('css/tokens.css')}"><link rel="stylesheet" href="${assetUrl('css/ui.css')}"><link rel="stylesheet" href="${assetUrl('css/command.css')}"></head>
<body class="c-body c-body--bare"><main id="main" class="c-bare">${body}</main></body></html>`;
}

const field = (id, label, control, help) => html`<div class="ui-field"><label class="ui-field__label" for="${id}">${label}</label>${control}${help ? html`<p class="ui-field__help">${help}</p>` : ''}</div>`;

function login(ctx, { error, email = '' }) {
  return bare(ctx, {
    title: 'Sign in',
    body: html`<div class="ui-login">
  <p class="ui-wordmark"><span>Sunday</span><span>Division</span></p>
  <h1 class="ui-login__title">Command</h1>
  <p class="ui-login__lede">Private to the founder. Access is checked on the server for every request.</p>
  ${error ? html`<p class="ui-flash ui-flash--danger" role="alert">${error}</p>` : ''}
  <form method="post" action="/command/login" class="ui-form">
    ${field('email', 'Email', html`<input class="ui-input" id="email" name="email" type="email" autocomplete="username" required value="${email}" autocapitalize="none">`)}
    ${field('password', 'Password', html`<input class="ui-input" id="password" name="password" type="password" autocomplete="current-password" required>`)}
    ${ui.Button({ label: 'Sign in', variant: 'primary', attrs: 'data-block' })}
  </form>
</div>`,
  });
}

function offline(ctx) {
  return bare(ctx, { title: 'Offline', body: html`<div class="ui-login"><p class="ui-wordmark"><span>Sunday</span><span>Division</span></p><h1 class="ui-login__title">You’re offline</h1><p class="ui-login__lede">Command never stores business data on this device, so there is nothing to show without a connection. Reconnect and try again.</p>${ui.Button({ label: 'Try again', href: '/command', variant: 'primary' })}</div>` });
}

function errorPage(ctx, status, message) {
  const title = { 404: 'Not found', 409: 'Not possible right now', 403: 'Not allowed', 429: 'Too many attempts' }[status] || 'That did not go through';
  const body = html`${ui.PageHeader({ eyebrow: `Error ${status}`, title, subtitle: message })}${ui.Button({ label: 'Back to Overview', href: '/command', variant: 'secondary' })}`;
  return ctx.user && ctx.user.founder && ctx.session ? shell(ctx, { title: 'Error', tab: '', body }) : bare(ctx, { title: 'Error', body: html`<div class="ui-login">${body}</div>` });
}

/** A one-button form that proposes an action (nothing changes until the preview is confirmed). */
const actionForm = (ctx, { type, target, label, variant = 'secondary', source }) => html`<form method="post" action="/command/actions" class="ui-inline-form">${csrf(ctx)}<input type="hidden" name="type" value="${type}">${target !== undefined && target !== null ? html`<input type="hidden" name="target" value="${target}">` : ''}${source ? html`<input type="hidden" name="source" value="${source}">` : ''}${ui.Button({ label, variant, small: true })}</form>`;

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
    body: html`${ui.Hero({ image: assetUrl('command/hero-drape.jpg'), eyebrow: 'Command', title: `${greeting}, ${firstName(ctx)}.`, subtitle })}

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
  const cite = (ids) => (ids && ids.length ? html`<sup class="ui-cite">${ids.map((id) => html`<a href="#fact-${id}" aria-label="Source ${id}">${id.slice(1)}</a>`)}</sup>` : '');
  const generate = html`<form method="post" action="/command/actions" class="ui-inline-form">${csrf(ctx)}<input type="hidden" name="type" value="generate_brief">${ui.Button({ label: 'Generate a new brief', variant: 'secondary' })}</form>`;
  const earlier = history.filter((h) => !b || h.id !== b.id);
  return shell(ctx, {
    title: 'Morning Brief', tab: 'brief', back: '/command',
    body: html`${pending ? html`<p class="ui-flash" role="status">A new brief is being written. Refresh in a moment.</p>` : ''}
${!b ? html`${ui.PageHeader({ eyebrow: 'Morning Brief', title: 'No brief yet', subtitle: `Each morning at ${ctx.app.settings.get('brief_hour')}:00 (${tz}) Command collects the verified events since the last brief and summarises them.` })}${generate}` : html`
<article class="ui-brief">
${ui.PageHeader({ eyebrow: `Morning Brief · ${fmtLocal(b.window_start, tz)} – ${fmtLocal(b.window_end, tz)}`, title: html`${b.content.headline.text}${cite(b.content.headline.fact_ids)}` })}
<p class="ui-provenance">${ui.Icon(b.brain === 'rules' ? 'brief' : 'spark')}<span>${BRAIN_LABEL[b.brain] || b.brain} from ${b.facts.length} verified facts.${b.dropped ? html` <strong>${b.dropped} statement${b.dropped === 1 ? '' : 's'} removed</strong> because no fact supported ${b.dropped === 1 ? 'it' : 'them'}.` : ''}</span></p>
${b.content.sections.map((sec) => ui.Section({ title: sec.title, body: html`<ul class="ui-card ui-brief__items">${sec.items.map((it) => html`<li>${it.text}${cite(it.fact_ids)}</li>`)}</ul>` }))}
${b.content.actions.length ? ui.Section({ title: 'Recommended', body: html`<ul class="ui-list ui-list--card">${b.content.actions.map((a) => html`<li><div class="ui-row"><span class="ui-row__text"><span class="ui-row__title">${a.text}${cite(a.fact_ids)}</span></span>${a.action_type ? actionForm(ctx, { type: a.action_type, target: a.target_id, source: 'brief', label: 'Review' }) : ui.Button({ label: 'Open', href: '/command/approvals', small: true })}</div></li>`)}</ul>` }) : ''}
${ui.Section({ title: 'Sources', body: html`<details class="ui-card ui-sources"><summary>${b.facts.length} verified facts${ui.Icon('chevron', 'ui-sources__chev')}</summary><ol>${b.facts.map((f) => html`<li id="fact-${f.id}">${f.link ? html`<a class="ui-source" href="${f.link}"><span class="ui-source__id">${f.id}</span><span>${f.text}</span></a>` : html`<span class="ui-source"><span class="ui-source__id">${f.id}</span><span>${f.text}</span></span>`}</li>`)}</ol></details>` })}
<div class="ui-actions-bar">${generate}</div>
</article>`}
${earlier.length ? ui.Section({ title: 'Earlier briefs', body: ui.List(earlier.map((h) => ({ title: h.brief_date, meta: h.status === 'ready' ? (BRAIN_LABEL[h.brain] || h.brain) : h.status, href: h.status === 'ready' ? `/command/brief/${h.id}` : null })), { cls: 'ui-list--card' }) }) : ''}`,
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

const TASK_PILL = { done: ['success', 'Done'], doing: ['neutral', 'In progress'], review: ['review', 'In review'], todo: ['neutral', 'To do'], proposed: ['neutral', 'Proposed'] };
const ASSIGNMENT_PILL = { recommended: ['review', 'Awaiting approval'], offered: ['neutral', 'Offered'], accepted: ['neutral', 'Accepted'], submitted: ['review', 'Submitted'], changes_requested: ['attention', 'Changes requested'], signed_off: ['success', 'Signed off'], declined: ['attention', 'Declined'], rejected: ['neutral', 'Rejected'], cancelled: ['neutral', 'Cancelled'] };
const DELIVERABLE_PILL = { in_progress: ['neutral', 'In progress'], in_review: ['review', 'In review'], approved: ['success', 'Signed off'], released: ['success', 'Released'] };
const INVOICE_PILL = { paid: ['success', 'Paid'], open: ['review', 'Open'], draft: ['neutral', 'Draft'], void: ['neutral', 'Void'] };
const pill = (map, key) => { const [tone, label] = map[key] || ['neutral', String(key || '').replace(/_/g, ' ')]; return ui.StatusPill({ tone, label }); };
const ROUTE_LABEL = { contractor: 'Contractor', studio: 'Studio', index_v3: 'INDEX V3', form: 'FORM' };

function project(ctx, { p, card }) {
  const tz = tzOf(ctx);
  const done = p.stages.filter((st) => st.done).length;
  const total = p.stages.length;
  const live = (a) => !['rejected', 'cancelled', 'declined'].includes(a.status);
  const assignmentFor = (t) => p.assignments.find((a) => a.task_id === t.id && live(a)) || p.assignments.find((a) => a.task_id === t.id);
  const gallery = p.images.length
    ? html`<div class="ui-gallery" role="region" aria-label="Client reference images" tabindex="0">${p.images.map((f, i) => html`<img src="/command/projects/${p.id}/images/${f.id}" alt="Client reference image ${i + 1} of ${p.images.length}" loading="${i ? 'lazy' : 'eager'}" decoding="async">`)}</div>${p.images.length > 1 ? html`<p class="ui-gallery__hint">${p.images.length} client reference images — swipe</p>` : ''}`
    : card && card.garment ? html`<figure class="ui-card ui-drawing">${ui.Thumb({ garment: card.garment, alt: `${p.category} — studio drawing` })}<figcaption>Studio drawing for ${p.category.toLowerCase()}. No client reference images yet.</figcaption></figure>` : '';
  return shell(ctx, {
    title: p.code, tab: 'projects', back: '/command/projects',
    body: html`${ui.PageHeader({ eyebrow: `${p.code} · ${p.brand_name}`, title: p.name, subtitle: `${card ? card.packageLabel : ''}${p.due_date ? ` · due ${p.due_date}` : ''}`, actions: card ? ui.StatusPill(card.status_) : '' })}
${p.blocked_reason ? html`<p class="ui-flash ui-flash--danger" role="alert">${p.blocked_reason}</p>` : ''}
${gallery}
<section class="ui-card ui-devprogress" aria-labelledby="dev-h">
  <div class="ui-devprogress__head"><h2 id="dev-h" class="ui-devprogress__title">Development progress</h2><span class="ui-devprogress__count">${done} of ${total} stages</span></div>
  ${ui.ProgressBar({ value: done, max: total, label: 'Development stages complete' })}
  <ol class="ui-stages">${p.stages.map((st) => html`<li class="${st.done ? 'is-done' : st.current ? 'is-current' : ''}" ${st.current ? raw('aria-current="step"') : ''}><span class="ui-stages__mark" aria-hidden="true">${st.done ? ui.Icon('check') : ''}</span><span class="ui-stages__label">${st.label}${st.detail ? html`<span class="ui-stages__detail">${st.detail}</span>` : ''}</span><span class="c-sr">${st.done ? 'done' : st.current ? 'in progress' : 'not started'}</span></li>`)}</ol>
</section>
${ui.Section({ title: 'Production', count: p.tasks.length, body: p.tasks.length ? html`<ul class="ui-list ui-list--card">${p.tasks.map((t) => {
    const a = assignmentFor(t);
    const meta = a ? `${a.contractor_name} · ${money(a.fee_cents)}${a.due_date ? ` · due ${a.due_date}` : ''}` : t.route === 'contractor' ? 'Contractor · awaiting a recommendation' : t.route ? ROUTE_LABEL[t.route] || t.route : 'Not routed yet';
    return html`<li>${ui.ListRow({ title: t.title, meta, trailing: a ? pill(ASSIGNMENT_PILL, a.status) : pill(TASK_PILL, t.status) })}</li>`;
  })}</ul>` : ui.EmptyState({ title: 'No production tasks yet', body: 'The Project Manager plans production once the deposit is verified.' }) })}
${ui.Section({ title: 'Deliverables', count: p.deliverables.length, body: p.deliverables.length ? ui.List(p.deliverables.map((d) => ({ title: d.title, meta: `v${d.version}${d.qa ? ` · automated QA ${d.qa.result}` : ''}`, trailing: pill(DELIVERABLE_PILL, d.status) })), { cls: 'ui-list--card' }) : ui.EmptyState({ title: 'No deliverables yet' }) })}
${ui.Section({ title: 'Money', body: html`<div class="ui-pair">
  ${ui.StatCard({ label: 'Quoted', value: whole(p.money.quoted), sub: p.quote ? `Quote v${p.quote.version} · ${p.quote.status}` : 'No quote yet' })}
  ${ui.StatCard({ label: 'Collected', value: whole(p.money.collected), sub: p.money.outstanding ? `${whole(p.money.outstanding)} outstanding` : 'Nothing outstanding' })}
  ${ui.StatCard({ label: 'Costs', value: whole(p.money.costs), sub: `incl. ${money(p.money.automationCosts)} AI & services` })}
  ${ui.StatCard({ label: 'Projected margin', value: pct(p.money.projectedMargin), sub: `${whole(p.money.projectedProfit)} projected profit` })}
</div>${p.invoices.length ? html`<div class="ui-gap">${ui.List(p.invoices.map((i) => ({ title: `${i.number} · ${i.kind}`, meta: money(i.amount_cents), trailing: pill(INVOICE_PILL, i.status) })), { cls: 'ui-list--card' })}</div>` : ''}` })}
${ui.Section({ title: 'Waiting on people', count: p.openActions.length, body: p.openActions.length ? ui.List(p.openActions.map((h) => ({ dot: h.kind === 'escalation' ? 'danger' : 'review', title: h.title, meta: ago(h.created_at, Date.now()) }))) : ui.EmptyState({ title: 'Nothing open' }) })}
${ui.Section({ title: 'Timeline', body: p.timeline.length ? html`<ol class="ui-timeline">${p.timeline.map((t) => html`<li><span class="ui-timeline__time">${fmtLocal(t.created_at, tz)}</span><span>${t.label}</span></li>`)}</ol>` : ui.EmptyState({ title: 'No history yet' }) })}
<div class="ui-actions-bar">${ui.Button({ label: `Ask Command about ${p.code}`, href: `/command/chat?project=${p.id}`, variant: 'secondary', icon: 'command' })}</div>`,
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
  const noteForm = (x) => html`<form method="post" action="/command/actions" class="ui-note-form">${csrf(ctx)}<input type="hidden" name="type" value="${x.type}"><input type="hidden" name="target" value="${x.targetId}">${field(`note-${x.targetId}`, 'What did you check or do?', html`<input class="ui-input" id="note-${x.targetId}" name="note" required maxlength="500">`)}${ui.Button({ label: 'Review', variant: 'primary', small: true })}</form>`;
  return shell(ctx, {
    title: 'Approvals', tab: 'approvals',
    body: html`${ui.PageHeader({ title: 'Approvals', subtitle: 'Nothing here happens until you review the preview and confirm.' })}
${items.length ? GROUPS.map(([g, label]) => {
    const list = items.filter((x) => x.group === g);
    if (!list.length) return '';
    return ui.Section({ title: label, id: g, count: list.length, body: html`<ul class="ui-approvals">${list.map((x) => html`<li class="ui-card ui-approval">
  <div class="ui-approval__top"><p class="ui-approval__title">${x.exception ? ui.StatusDot('danger', 'Exception') : ''}${x.title}</p>${x.amount ? html`<p class="ui-approval__amount">${x.amount}</p>` : ''}</div>
  <p class="ui-approval__detail">${x.detail}</p>
  <p class="ui-approval__meta">Waiting ${ago(x.since, Date.now())}${sourceLabel(x)}</p>
  <div class="ui-approval__actions">${x.needsNote ? noteForm(x) : html`${actionForm(ctx, { type: x.type, target: x.targetId, label: 'Review', variant: 'primary' })}${x.alt ? actionForm(ctx, { type: x.alt, target: x.targetId, label: ALT_LABEL[x.alt] }) : ''}`}${x.projectId ? ui.Button({ label: 'Project', href: `/command/projects/${x.projectId}`, variant: 'ghost', small: true }) : ''}</div>
</li>`)}</ul>` });
  }) : ui.EmptyState({ title: 'All clear.', body: 'Nothing is waiting for you.' })}`,
  });
}

const who = (by) => String(by).replace(/^staff:/, '').replace(/^model:/, 'a model (').replace(/^a model \((.+)$/, 'a model ($1)');
function action(ctx, { a, needsPassword }) {
  const p = a.preview;
  const open = a.status === 'proposed';
  const high = a.risk === 'high';
  return shell(ctx, {
    title: 'Review', tab: a.source === 'chat' ? 'chat' : 'approvals', back: a.source === 'chat' && a.conversation_id ? `/command/chat/${a.conversation_id}` : '/command/approvals',
    body: html`<article class="ui-review">
${ui.PageHeader({ eyebrow: p.label, title: p.title })}
<p class="ui-review__risk">${ui.StatusPill({ tone: high ? 'review' : 'neutral', label: high ? 'High impact' : 'Low impact' })}<span>${p.why}</span></p>
${p.warnings && p.warnings.length ? html`<div class="ui-flash ui-flash--danger" role="alert">${p.warnings.map((w) => html`<p>${w}</p>`)}</div>` : ''}
${ui.Section({ title: 'When you confirm', body: html`<ul class="ui-card ui-effects">${p.effects.map((e) => html`<li>${e}</li>`)}</ul>` })}
${p.rows && p.rows.length ? ui.Section({ title: 'Details', body: html`<dl class="ui-card ui-kv">${p.rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` }) : ''}
${p.items && p.items.length ? ui.Section({ title: 'Line items', body: html`<ul class="ui-card ui-plainlist">${p.items.map((i) => html`<li>${i}</li>`)}</ul>` }) : ''}
${p.text ? ui.Section({ title: p.textLabel || 'Details', body: html`<div class="ui-card ui-text">${p.text.split(/\n{2,}/).map((para) => html`<p>${para}</p>`)}</div>` }) : ''}
<p class="ui-review__note">Proposed by ${who(a.proposed_by)} via ${a.source}. This preview was built from the records, not by a model. If anything changes before you confirm, it expires instead of running.</p>
${open ? html`<div class="ui-confirm">
  <form method="post" action="/command/actions/${a.id}/confirm" class="ui-form">${csrf(ctx)}<input type="hidden" name="digest" value="${a.digest}">
    ${needsPassword ? field('password', 'Your password — required for high-impact actions after 12 hours', html`<input class="ui-input" id="password" name="password" type="password" autocomplete="current-password" required>`) : ''}
    ${high
    ? html`<button class="ui-btn ui-btn--primary ui-hold" type="submit" data-hold data-block><span class="ui-hold__fill" aria-hidden="true"></span><span class="ui-hold__label" data-hold-label>Confirm</span></button><p class="ui-hold__hint" data-hold-hint hidden aria-live="polite">Press and hold to confirm — or press twice.</p>`
    : ui.Button({ label: 'Confirm', variant: 'primary', attrs: 'data-block' })}
  </form>
  <form method="post" action="/command/actions/${a.id}/cancel">${csrf(ctx)}${ui.Button({ label: 'Cancel — change nothing', variant: 'secondary', attrs: 'data-block' })}</form>
</div>` : html`<p class="ui-flash ${a.status === 'failed' || a.status === 'expired' ? 'ui-flash--danger' : ''}" role="status">This action was ${a.status}${a.result && a.result.message ? html`: ${a.result.message}` : ''}${a.error ? html` — ${a.error}` : ''}.</p>`}
</article>`,
  });
}

// ── Agent Studio ──────────────────────────────────────────────────────
const AGENT_ICON = { sales: 'cash', project_manager: 'brief', talent: 'person', production: 'projects', qa: 'approvals', client_success: 'command', command: 'spark', orchestrator: 'update' };
const AGENT_STATE = { working: ['success', 'Working'], queued: ['neutral', 'Queued'], idle: ['neutral', 'Idle'], failing: ['danger', 'Failing'], paused: ['attention', 'Paused'] };
const JOB_DOT = { succeeded: 'success', failed: 'danger', running: 'review', queued: 'neutral', cancelled: 'neutral' };
function agents(ctx, { agents: list, failed, recent, provider, spent, budget, paused }) {
  const usd = (micros) => `$${(micros / 1e6).toFixed(2)}`;
  const running = list.reduce((k, a) => k + a.running, 0);
  const queued = list.reduce((k, a) => k + a.queued, 0);
  const [tone, state] = paused ? ['attention', 'Automation is paused'] : failed.length ? ['danger', `${failed.length} failed task${failed.length === 1 ? '' : 's'} need you`] : ['success', 'Operating normally'];
  return shell(ctx, {
    title: 'Agent Studio', tab: 'agents',
    body: html`${ui.PageHeader({ title: 'Agent Studio', subtitle: 'Your AI team: what each agent is doing, what failed and what it costs.' })}
<section class="ui-card ui-status-card" aria-label="Status">
  <p class="ui-status-card__state">${ui.StatusDot(tone)}<span>${state}</span></p>
  <p class="ui-status-card__meta">${running} task${running === 1 ? '' : 's'} in progress · ${queued} queued</p>
  <dl class="ui-kv ui-kv--flat"><div><dt>Model</dt><dd>${provider}</dd></div><div><dt>AI spend this month</dt><dd>${usd(spent)} of $${budget}</dd></div></dl>
  ${ui.ProgressBar({ value: Math.min(spent / 1e6, budget), max: budget || 1, label: 'AI budget used this month' })}
</section>
${ui.Section({ title: 'Agents', body: ui.List(list.map((a) => {
    const [t, label] = AGENT_STATE[a.state] || ['neutral', a.state];
    const def = REGISTRY[a.id];
    return { icon: AGENT_ICON[a.id] || 'agents', title: def ? def.name : a.id, meta: `${a.summary}${a.mode === 'rules' ? ' · rules only' : ''} · ${usd(a.costMonthMicros)} this month`, trailing: ui.StatusPill({ tone: t, label: a.state === 'queued' ? `${label} · ${a.queued}` : label }) };
  }), { cls: 'ui-list--card' }) })}
${ui.Section({ title: 'Failures', count: failed.length, body: failed.length ? html`<ul class="ui-approvals">${failed.map((j) => html`<li class="ui-card ui-approval">
  <div class="ui-approval__top"><p class="ui-approval__title">${ui.StatusDot('danger', 'Failed')}${j.agent}.${j.action}</p>${j.project_code ? html`<p class="ui-approval__amount">${j.project_code}</p>` : ''}</div>
  <p class="ui-approval__detail">${j.error_kind}: ${j.error}</p>
  <div class="ui-approval__actions">${actionForm(ctx, { type: 'retry_task', target: j.id, label: 'Retry', variant: 'primary' })}${ui.Button({ label: 'Log', href: `/command/agents/tasks/${j.id}`, variant: 'ghost', small: true })}</div>
</li>`)}</ul>` : ui.EmptyState({ title: 'No failed tasks.' }) })}
${ui.Section({ title: 'Recent activity', body: recent.length ? ui.List(recent.map((j) => ({ dot: JOB_DOT[j.status] || 'neutral', title: `${j.agent}.${j.action}`, meta: `${j.project_code ? `${j.project_code} · ` : ''}${j.brain === 'model' ? (j.simulated ? 'simulated model' : (j.provider || 'model')) : j.brain || 'not started'} · ${usd(j.cost_micros || 0)} · ${ago(j.finished_at || j.started_at || j.created_at, Date.now())}`, href: `/command/agents/tasks/${j.id}` })), { cls: 'ui-list--card' }) : ui.EmptyState({ title: 'No agent activity yet' }) })}`,
  });
}

function agentTask(ctx, { job, session, runs, transcript }) {
  const usd = (micros) => `$${(micros / 1e6).toFixed(4)}`;
  const block = (b) => {
    if (b.type === 'text') return html`<div class="ui-turn__text">${richText(b.text)}</div>`;
    if (b.type === 'tool_use') return html`<div class="ui-call"><span class="ui-call__name">→ ${b.name}</span><pre>${JSON.stringify(b.input, null, 1)}</pre></div>`;
    if (b.type === 'tool_result') {
      const content = Array.isArray(b.content) ? b.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} attached]`)).join('\n') : String(b.content);
      return html`<div class="ui-call ${b.is_error ? 'ui-call--error' : ''}"><span class="ui-call__name">← result${b.is_error ? ' (refused)' : ''}</span><pre>${content.slice(0, 3000)}</pre></div>`;
    }
    if (b.type === 'thinking') return html`<p class="ui-turn__note">Reasoning (not shown)</p>`;
    return '';
  };
  const simulated = runs.some((r) => r.provider === 'simulated');
  const brain = session ? (session.brain === 'model' ? `model (${simulated ? 'SIMULATED' : session.provider})` : 'rules') : 'not started';
  return shell(ctx, {
    title: `Task ${job.id}`, tab: 'agents', back: '/command/agents',
    body: html`${ui.PageHeader({ eyebrow: `Agent task #${job.id}`, title: `${job.agent}.${job.action}`, subtitle: `${job.status} · ${job.attempts}/${job.max_attempts} attempt(s) · ${brain}${session ? ` · ${session.turns} turn(s) · ${session.tool_calls} tool call(s) · ${usd(session.cost_micros)}` : ''}` })}
${job.error ? html`<p class="ui-flash ui-flash--danger" role="alert">${job.error_kind}: ${job.error}</p>` : ''}
${simulated ? html`<p class="ui-flash" role="note">Simulated model: these turns came from a scripted test double, not a real provider.</p>` : ''}
${ui.Section({ title: 'Execution log', body: !session ? ui.EmptyState({ title: 'Not started yet' }) : session.brain === 'rules'
    ? html`<ol class="ui-log">${transcript.map((e, i) => html`<li class="ui-turn"><p class="ui-overline">Step ${i + 1} · rules</p><div class="ui-call"><span class="ui-call__name">→ ${e.tool}</span><pre>${JSON.stringify(e.input, null, 1)}</pre></div><div class="ui-call"><span class="ui-call__name">← result</span><pre>${String(e.result).slice(0, 3000)}</pre></div></li>`)}</ol>`
    : html`<ol class="ui-log">${transcript.map((m, i) => html`<li class="ui-turn ui-turn--${m.role}"><p class="ui-overline">${i === 0 ? 'Task' : m.role === 'assistant' ? 'Agent' : 'Tool results'}</p>${Array.isArray(m.content) ? m.content.map(block) : html`<div class="ui-turn__text">${richText(String(m.content))}</div>`}</li>`)}</ol>` })}
${ui.Section({ title: 'Model calls', count: runs.length, body: runs.length ? ui.List(runs.map((r) => ({ title: r.task.split('#')[1] ? `Turn ${r.task.split('#')[1]}` : r.task, meta: `${r.provider} · ${r.model_served || r.model_requested || '—'} · ${r.input_tokens}/${r.output_tokens} tokens · ${usd(r.cost_micros)}`, trailing: r.status })), { cls: 'ui-list--card' }) : ui.EmptyState({ title: 'No model calls' }) })}
<div class="ui-actions-bar">${ui.Button({ label: 'Open in the studio dashboard', href: `/admin/ops/tasks/${job.id}`, variant: 'ghost' })}</div>`,
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
  const periods = [['this_week', 'Week'], ['this_month', 'Month'], ['last_month', 'Last month'], ['year_to_date', 'Year']];
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.revenue, w.expenses)));
  const W = 320; const H = 120; const bw = W / weeks.length;
  const bars = weeks.map((w, i) => {
    const rh = Math.round((w.revenue / max) * (H - 18));
    const eh = Math.round((w.expenses / max) * (H - 18));
    return `<rect class="ui-bars__in ${w.partial ? 'is-partial' : ''}" x="${(i * bw + 3).toFixed(1)}" y="${H - 14 - rh}" width="${(bw * 0.58 - 3).toFixed(1)}" height="${Math.max(rh, 1)}"><title>Week of ${w.week}: ${whole(w.revenue)} in</title></rect><rect class="ui-bars__out" x="${(i * bw + bw * 0.58).toFixed(1)}" y="${H - 14 - eh}" width="${(bw * 0.3).toFixed(1)}" height="${Math.max(eh, 1)}"><title>Week of ${w.week}: ${whole(w.expenses)} out</title></rect>`;
  }).join('');
  const none = (n) => html`<span class="ui-muted">Not enough data${n !== undefined ? ` (${n})` : ''}</span>`;
  const days = (d) => (d === null ? none() : `${d.toFixed(1)} days`);
  const rate = (x, k) => (k ? html`${pct(x)} <span class="ui-muted">of ${k}</span>` : none(0));
  return shell(ctx, {
    title: 'Performance', tab: 'performance', back: '/command', wide: true,
    body: html`${ui.PageHeader({ title: 'Performance', subtitle: 'Cash basis: verified payments received minus recorded costs, AI and external services.' })}
${ui.SegmentedTabs(periods.map(([k, l]) => ({ label: l, href: `/command/performance?period=${k}`, current: periodName === k })), { label: 'Period' })}
<div class="ui-grid4">
  ${ui.StatCard({ label: 'Revenue', value: whole(period.revenue), sub: html`${period.payments} verified payment${period.payments === 1 ? '' : 's'}${period.simulatedRevenue ? html` · <span class="ui-sim">${whole(period.simulatedRevenue)} simulated</span>` : ''}` })}
  ${ui.StatCard({ label: 'Expenses', value: whole(period.expenses), sub: 'Contractors, costs, AI, services' })}
  ${ui.StatCard({ label: 'Profit', value: whole(period.profit), sub: period.margin === null ? 'No revenue in the period' : `${pct(period.margin)} margin` })}
  ${ui.StatCard({ label: 'Booked', value: whole(period.booked), sub: 'Value of quotes accepted' })}
</div>
${ui.Section({ title: 'Where the money went', body: ui.List([
    { title: 'Contractor fees', meta: 'Signed-off work, paid outside the system', trailing: money(period.contractorCosts) },
    { title: 'Other recorded costs', trailing: money(period.otherCosts) },
    { title: 'AI models', trailing: money(period.aiCents) },
    { title: 'External services', meta: 'INDEX V3 / FORM', trailing: money(period.externalCents) },
  ], { cls: 'ui-list--card' }) })}
${ui.Section({ title: 'Last 12 weeks', body: html`<figure class="ui-card ui-chart"><svg class="ui-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money in and out per week for the last 12 weeks; the figures are in the monthly table below">${raw(bars)}<line class="ui-bars__axis" x1="0" x2="${W}" y1="${H - 14}" y2="${H - 14}"/><text class="ui-bars__tick" x="0" y="${H - 2}">${weeks[0].week.slice(5)}</text><text class="ui-bars__tick" x="${W}" y="${H - 2}" text-anchor="end">now</text></svg>
<figcaption class="ui-legend"><span class="ui-legend__in">Money in</span><span class="ui-legend__out">Money out</span></figcaption></figure>` })}
${ui.Section({ title: 'By month', body: html`<div class="ui-card ui-table-card"><table class="ui-table"><thead><tr><th scope="col">Month</th><th scope="col" class="r">In</th><th scope="col" class="r">Out</th><th scope="col" class="r">Profit</th><th scope="col" class="r">Margin</th></tr></thead>
<tbody>${months.map((m) => html`<tr><th scope="row">${m.month}${m.partial ? '*' : ''}</th><td class="r">${whole(m.revenue)}</td><td class="r">${whole(m.expenses)}</td><td class="r">${whole(m.profit)}</td><td class="r">${pct(m.margin)}</td></tr>`)}</tbody></table>
<p class="ui-note">* month to date</p></div>` })}
<div class="ui-two">
${ui.Section({ title: 'Turnaround', body: ui.List([
    { title: 'Inquiry → quote sent', trailing: days(eff.turnaround.inquiryToQuote) },
    { title: 'Deposit → production', trailing: days(eff.turnaround.depositToProduction) },
    { title: 'Inquiry → completed', trailing: days(eff.turnaround.inquiryToCompletion) },
  ], { cls: 'ui-list--card' }) })}
${ui.Section({ title: 'Production efficiency', body: ui.List([
    { title: 'QA pass on first version', trailing: rate(eff.qaFirstPass, eff.qaSample) },
    { title: 'Submissions needing changes', trailing: rate(eff.revisionRate, eff.revisionSample) },
    { title: 'Contractor work on time', trailing: rate(eff.onTime, eff.onTimeSample) },
    { title: 'Offer response time', trailing: eff.offerSample ? `${eff.offerResponseHours.toFixed(1)} h` : none(0) },
    { title: 'Automation rate', meta: eff.automationRate === null ? '' : `${eff.automationBasis.agentSteps} agent / ${eff.automationBasis.routineHumanSteps} routine human steps`, trailing: eff.automationRate === null ? none() : pct(eff.automationRate) },
  ], { cls: 'ui-list--card' }) })}
</div>`,
  });
}

// ── Settings ──────────────────────────────────────────────────────────
const MODE_HELP = { auto: 'Model when available', rules: 'Rules only, never a model', paused: 'Paused — tasks wait' };
function settings(ctx, { values, providers, devices, integrationsConnected, vapidKey, kinds, team = [] }) {
  const select = (name, options, value) => html`<select class="ui-input ui-select" id="${name}" name="${name}">${options.map(([v, l]) => html`<option value="${v}" ${String(value) === String(v) ? raw('selected') : ''}>${l}</option>`)}</select>`;
  const check = (name, label, checked, disabled = false) => html`<label class="ui-check"><input type="checkbox" name="${name}" value="true" ${checked ? raw('checked') : ''} ${disabled ? raw('disabled') : ''}><span>${label}</span></label>`;
  const toolSummary = (agentId) => {
    const names = new Set();
    for (const a of Object.values(REGISTRY[agentId].actions)) for (const t of a.tools) if (t !== 'submit_result') names.add(t);
    const by = { read: 0, internal: 0, draft: 0, external: 0 };
    for (const n of names) by[TOOLS[n].effect] += 1;
    return `Reads ${by.read} · records ${by.internal} · drafts ${by.draft}${by.external ? ` · external ${by.external} (only with autonomous production)` : ''}`;
  };
  return shell(ctx, {
    title: 'Settings', tab: 'settings', back: '/command',
    body: html`${ui.PageHeader({ title: 'Settings' })}
${ui.Section({ title: 'Notifications', id: 'notifications', body: html`<div class="ui-card">
  <div class="ui-push" data-push data-key="${vapidKey}">
    <p class="ui-push__status" data-push-status>Push notifications: ${devices} device${devices === 1 ? '' : 's'} registered.</p>
    <div class="ui-row-actions"><button class="ui-btn ui-btn--primary ui-btn--small" type="button" data-push-enable hidden>Enable on this device</button><button class="ui-btn ui-btn--secondary ui-btn--small" type="button" data-push-disable hidden>Turn off on this device</button></div>
    <p class="ui-field__help">On iPhone, add Command to your Home Screen first (Share → Add to Home Screen). Pushes carry no business data; your phone fetches the details over your signed-in session.</p>
  </div>
  <form method="post" action="/command/settings/preferences" class="ui-form">${csrf(ctx)}
    <fieldset class="ui-fieldset"><legend class="ui-field__label">Send a push for</legend>${kinds.map(([k, label]) => check(`push_${k}`, label, values[`push_${k}`]))}</fieldset>
    ${field('brief_hour', 'Morning Brief time', select('brief_hour', Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`]), values.brief_hour))}
    ${field('timezone', 'Time zone', html`<div class="ui-row-actions"><input class="ui-input" id="timezone" name="timezone" value="${values.timezone}" autocapitalize="none" spellcheck="false"><button class="ui-btn ui-btn--secondary ui-btn--small" type="button" data-tz-fill>Use this device’s</button></div>`)}
    ${ui.Button({ label: 'Save preferences', variant: 'primary' })}
  </form>
</div>` })}
${ui.Section({ title: 'Agent permissions', id: 'permissions', body: html`<div class="ui-card">
  <p class="ui-field__help">Each agent’s tools are fixed in code: none can send, approve, pay, release files or change settings. Here you choose how each one runs. Changes are previewed and confirmed.</p>
  <form method="post" action="/command/settings/changes" class="ui-form">${csrf(ctx)}<input type="hidden" name="section" value="permissions">
  ${ctx.app.settings.AGENT_IDS.map((id) => field(`agent_mode_${id}`, REGISTRY[id].name, select(`agent_mode_${id}`, ctx.app.settings.AGENT_MODES.map((m) => [m, `${m} — ${MODE_HELP[m]}`]), values[`agent_mode_${id}`]), toolSummary(id)))}
  ${check('orchestrator_paused', 'Pause all automation', values.orchestrator_paused)}
  ${check('autonomous_production', integrationsConnected ? 'Autonomous production (INDEX V3 / FORM)' : 'Autonomous production (INDEX V3 / FORM) — connect a service first', values.autonomous_production, !(integrationsConnected || values.autonomous_production))}
  ${ui.Button({ label: 'Review changes', variant: 'primary' })}</form>
</div>` })}
${ui.Section({ title: 'Model provider', id: 'providers', body: html`<div class="ui-card">
  <form method="post" action="/command/settings/changes" class="ui-form">${csrf(ctx)}<input type="hidden" name="section" value="provider">
  <fieldset class="ui-fieldset"><legend class="c-sr">Provider</legend>
  ${[['auto', 'Automatic', 'Anthropic if configured, else OpenAI, else rules'], ...providers.map((pr) => [pr.id, pr.label, pr.configured ? `${pr.model} · configured${pr.simulated ? ' (SIMULATED test double)' : ''}` : `Not configured — ${pr.missing}`]), ['rules', 'Rules only', 'No model calls at all']].map(([v, l, d]) => html`<label class="ui-radio"><input type="radio" name="ai_provider" value="${v}" ${values.ai_provider === v ? raw('checked') : ''} ${v !== 'auto' && v !== 'rules' && !providers.find((pr) => pr.id === v).configured ? raw('disabled') : ''}><span><strong>${l}</strong><span class="ui-field__help">${d}</span></span></label>`)}
  </fieldset>
  ${ui.Button({ label: 'Review change', variant: 'primary' })}</form>
  <p class="ui-field__help">API keys are set on the server (environment), never in this app.</p>
</div>` })}
${ui.Section({ title: 'Operational budgets', id: 'budgets', body: html`<div class="ui-card"><form method="post" action="/command/settings/changes" class="ui-form">${csrf(ctx)}<input type="hidden" name="section" value="budgets">
  ${['ai_monthly_budget_usd', 'ai_project_budget_usd', 'external_project_budget_usd', 'external_job_estimate_usd', 'unusual_expense_usd'].map((k) => field(k, ctx.app.settings.DEFINITIONS[k].label, html`<input class="ui-input" id="${k}" name="${k}" value="${values[k]}" inputmode="decimal">`))}
  ${ui.Button({ label: 'Review changes', variant: 'primary' })}</form></div>` })}
${ui.Section({ title: 'Team and roles', id: 'team', body: html`<div class="ui-card">
  <p class="ui-field__help">A studio manager can send quotes, invoices and messages and close projects. A technical reviewer can sign off flats, tech packs and 3D. Anyone signed in can prepare drafts. Payments made outside checkout, payment overrides, final file release, roles and agent limits stay with you. Each change is previewed and confirmed.</p>
  <ul class="ui-list">${team.map((u) => html`<li class="ui-row"><span class="ui-row__text"><span class="ui-row__title">${u.name}${u.founder ? ' · Founder' : ''}</span><span class="ui-row__meta">${u.email}</span></span>
    ${u.founder ? html`<span class="ui-row__meta">All permissions</span>` : html`<form method="post" action="/command/settings/team" class="ui-form ui-form--inline">${csrf(ctx)}<input type="hidden" name="user_id" value="${u.id}">
      ${check('studio_manager', 'Studio manager', u.studio_manager)}${check('technical_reviewer', 'Technical reviewer', u.technical_reviewer)}
      ${ui.Button({ label: 'Review', variant: 'secondary', small: true })}</form>`}</li>`)}</ul>
</div>` })}
${ui.Section({ title: 'Session', body: html`<div class="ui-card">
  <p class="ui-field__help">Signed in as ${ctx.user.email}. Founder access is granted on the server only (FOUNDER_EMAIL or the founder script).</p>
  <div class="ui-row-actions"><form method="post" action="/command/logout">${csrf(ctx)}${ui.Button({ label: 'Sign out', variant: 'secondary', small: true })}</form>
  <form method="post" action="/command/logout-all">${csrf(ctx)}${ui.Button({ label: 'Sign out all devices', variant: 'ghost', small: true })}</form></div>
</div>` })}`,
  });
}

const SEVERITY_DOT = { info: 'neutral', attention: 'attention', urgent: 'danger' };
function notifications(ctx, { rows, labels }) {
  const unread = rows.some((r) => !r.read_at);
  return shell(ctx, {
    title: 'Notifications', tab: 'notifications', back: '/command',
    body: html`${ui.PageHeader({ title: 'Notifications', actions: unread ? html`<form method="post" action="/command/notifications/read">${csrf(ctx)}${ui.Button({ label: 'Mark all read', variant: 'secondary', small: true })}</form>` : '' })}
${rows.length ? html`<ul class="ui-list ui-list--card ui-notices">${rows.map((n) => html`<li class="${n.read_at ? '' : 'is-unread'}">${ui.ListRow({ dot: SEVERITY_DOT[n.severity] || 'neutral', title: n.title, meta: `${labels[n.kind]} · ${ago(n.created_at, Date.now())}${n.body ? ` · ${n.body}` : ''}`, href: `/command/notifications/${n.id}` })}</li>`)}</ul>` : ui.EmptyState({ title: 'No notifications yet', body: 'Paid projects, approvals, failures, delays, risks and unusual expenses will appear here.' })}`,
  });
}

function more(ctx) {
  return shell(ctx, {
    title: 'More', tab: 'more', back: '/command',
    body: html`${ui.PageHeader({ title: 'More' })}${ui.List([
      { icon: 'brief', title: 'Morning Brief', meta: 'Verified events and recommended actions', href: '/command/brief' },
      { icon: 'performance', title: 'Performance', meta: 'Revenue, profit, turnaround, efficiency', href: '/command/performance' },
      { icon: 'bell', title: 'Notifications', href: '/command/notifications' },
      { icon: 'settings', title: 'Settings', meta: 'Notifications, agent permissions, providers, budgets', href: '/command/settings' },
      { icon: 'overview', title: 'Studio dashboard', meta: 'Separate sign-in', href: '/admin' },
    ], { cls: 'ui-list--card' })}`,
  });
}

module.exports = { shell, login, offline, errorPage, overview, brief, projects, project, approvals, action, agents, agentTask, chat, chatMessage, performance, settings, notifications, more, richText };
