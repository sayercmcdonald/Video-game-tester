'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assetUrl } = require('../lib/assets');
const views = require('../views/command');
const { verifyPassword, hashPassword } = require('../lib/crypto');
const { HttpError, int, str } = require('../lib/util');

const DUMMY_HASH = hashPassword(require('node:crypto').randomBytes(16).toString('hex'));
const PARAM_FOR = {
  send_quote: 'quote_id', approve_assignment: 'assignment_id', reject_assignment: 'assignment_id', send_message: 'message_id', discard_message: 'message_id',
  issue_invoice: 'invoice_id', sign_off_deliverable: 'deliverable_id', release_deliverable: 'deliverable_id', resolve_exception: 'task_id', draft_quote: 'project_id', retry_task: 'job_id',
};

/**
 * Sunday Division Command routes. Every page and API below /command (except sign-in, the
 * manifest and the service worker) uses auth 'founder', which the HTTP layer enforces on
 * the server for every request: a founder session AND users.founder = 1.
 */
function register(router, app) {
  const F = { auth: 'founder' };
  const FJ = { auth: 'founder', json: true };
  const { db } = app;
  const swFile = fs.readFileSync(path.join(app.config.root, 'public', 'command-sw.js'), 'utf8');
  // The worker's cache list uses the same content-hashed URLs as the pages, and its cache name
  // changes whenever any of them does, so a deploy never serves an old file from the device.
  // Fonts are requested by the stylesheets under their plain names, so they are cached that way;
  // their hashes still feed the cache name.
  const SW_SHELL = ['css/tokens.css', 'css/ui.css', 'css/command.css', 'js/command.js', 'command/hero-drape.jpg', 'command/icon-192.png'];
  const SW_FONTS = ['fonts/newsreader-display-latin-300-500.woff2', 'fonts/inter-latin-wght-normal.woff2'];
  const swSource = () => {
    const shell = [...SW_SHELL.map((f) => assetUrl(f)), ...SW_FONTS.map((f) => `/assets/${f}`)];
    const version = `command-${crypto.createHash('sha256').update([...shell, ...SW_FONTS.map((f) => assetUrl(f))].join('|')).digest('hex').slice(0, 12)}`;
    return `self.SD_ASSETS = ${JSON.stringify({ version, shell })};\n${swFile}`;
  };

  // ── Public pieces of the PWA (no data) ─────────────────────────────
  router.get('/command/manifest.webmanifest', (ctx) => ctx.send(200, JSON.stringify({
    name: 'Sunday Division Command', short_name: 'Command', id: '/command', start_url: '/command', scope: '/command', display: 'standalone',
    orientation: 'portrait', background_color: '#111111', theme_color: '#111111', description: 'Private founder app for Sunday Division.',
    icons: [
      { src: '/assets/command/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/command/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/command/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }));
  router.get('/command/sw.js', (ctx) => ctx.send(200, swSource(), { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/command' }));

  router.get('/command/offline', (ctx) => ctx.html(views.offline(ctx)));

  // ── Sign-in (founder accounts only) ─────────────────────────────────
  router.get('/command/login', (ctx) => {
    const s = app.sessions.load('founder', ctx.cookies);
    if (s && db.get('SELECT 1 FROM users WHERE id = ? AND founder = 1', s.user_id)) return ctx.redirect('/command');
    ctx.html(views.login(ctx, {}));
  });
  router.post('/command/login', (ctx) => {
    const email = str(ctx.body.email, 254).toLowerCase();
    const fail = (message, status) => ctx.html(views.login(ctx, { error: message, email }), status);
    if (!app.rateLimit.take(`command-login:${ctx.ip}`, 10, 15 * 60e3) || !app.rateLimit.take(`command-login:${email}`, 10, 15 * 60e3)) {
      return fail('Too many attempts. Wait fifteen minutes and try again.', 429);
    }
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    const ok = verifyPassword(str(ctx.body.password, 500), user ? user.password_hash : DUMMY_HASH) && Boolean(user) && user.founder === 1;
    if (!ok) {
      // The same message whether the password was wrong or the account is not a founder.
      app.audit.log('public', 'command.login_failed', { detail: email });
      return fail('Those details do not open Command.', 401);
    }
    app.rateLimit.reset(`command-login:${email}`);
    ctx.setCookies.push(app.sessions.start('founder', user.id));
    app.audit.log(`staff:${user.email}`, 'command.signed_in');
    ctx.redirect('/command');
  });
  router.post('/command/logout', F, (ctx) => { ctx.setCookies.push(app.sessions.end('founder', ctx.cookies)); app.audit.log(`staff:${ctx.user.email}`, 'command.signed_out'); ctx.redirect('/command/login'); });
  router.post('/command/logout-all', F, (ctx) => {
    app.sessions.endAllFor('founder', ctx.user.id);
    db.run('DELETE FROM push_subscriptions WHERE user_id = ?', ctx.user.id);
    ctx.setCookies.push(app.sessions.end('founder', ctx.cookies));
    app.audit.log(`staff:${ctx.user.email}`, 'command.signed_out_everywhere');
    ctx.redirect('/command/login');
  });

  // ── Screens ─────────────────────────────────────────────────────────
  const m = () => app.command.metrics;
  router.get('/command', F, (ctx) => ctx.html(views.overview(ctx, {
    health: m().health(), trailing: m().trailing(30), counts: m().projectCounts(), focus: m().focus(),
    brief: app.command.brief.latest(), pendingBrief: app.command.brief.pending(), paused: app.settings.get('orchestrator_paused'),
  })));
  router.get('/command/more', F, (ctx) => ctx.html(views.more(ctx)));

  router.get('/command/brief', F, (ctx) => ctx.html(views.brief(ctx, { brief: app.command.brief.latest(), pending: app.command.brief.pending(), history: app.command.brief.list() })));
  router.get('/command/brief/:id', F, (ctx) => {
    const b = app.command.brief.get(int(ctx.params.id));
    if (!b || b.status !== 'ready') throw new HttpError(404, 'That brief is not available.');
    ctx.html(views.brief(ctx, { brief: b, pending: null, history: app.command.brief.list() }));
  });

  router.get('/command/projects', F, (ctx) => {
    const asked = ctx.query.get('tab') || ctx.query.get('filter');
    const tab = ['active', 'production', 'review', 'attention', 'done'].includes(asked) ? asked : 'active';
    const { rows, counts } = m().projectCards(tab);
    ctx.html(views.projects(ctx, { rows, counts, tab }));
  });
  // The client's reference image for a project card: founder-only, never cached on the device.
  router.get('/command/projects/:id/thumb', F, (ctx) => {
    const f = m().thumbFile(int(ctx.params.id));
    if (!f || !/^image\/(jpeg|png|webp)$/.test(f.mime)) throw new HttpError(404, 'No image.');
    ctx.send(200, fs.readFileSync(app.files.pathOf(f)), { 'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
  });
  router.get('/command/projects/:id', F, (ctx) => {
    const p = m().project(int(ctx.params.id));
    if (!p) throw new HttpError(404, 'Project not found.');
    const card = m().projectCards('all').rows.find((r) => r.id === p.id) || null;
    ctx.html(views.project(ctx, { p, card }));
  });
  // A project's own reference images for its gallery: founder-only, never cached on the device.
  router.get('/command/projects/:id/images/:file', F, (ctx) => {
    const f = m().projectImage(int(ctx.params.id), int(ctx.params.file));
    if (!f || !/^image\/(jpeg|png|webp)$/.test(f.mime)) throw new HttpError(404, 'No image.');
    ctx.send(200, fs.readFileSync(app.files.pathOf(f)), { 'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
  });

  router.get('/command/approvals', F, (ctx) => ctx.html(views.approvals(ctx, { items: app.command.approvals() })));

  // ── Actions: propose → preview → confirm ────────────────────────────
  router.post('/command/actions', F, (ctx) => {
    const type = str(ctx.body.type, 40);
    if (!app.command.actions.ACTIONS[type] || type === 'update_settings') throw new HttpError(400, 'Unknown action.');
    const params = {};
    if (PARAM_FOR[type]) params[PARAM_FOR[type]] = int(ctx.body.target);
    if (type === 'reject_assignment' && ctx.body.note) params.note = str(ctx.body.note, 500);
    if (type === 'resolve_exception') params.note = str(ctx.body.note, 500);
    const source = ctx.body.source === 'brief' ? 'brief' : 'approvals';
    const a = app.command.actions.propose(type, params, { source, by: `staff:${ctx.user.email}` });
    ctx.redirect(`/command/actions/${a.id}`);
  });
  router.get('/command/actions/:id', F, (ctx) => {
    const a = app.command.actions.get(int(ctx.params.id));
    if (!a) throw new HttpError(404, 'Action not found.');
    ctx.html(views.action(ctx, { a, needsPassword: a.risk === 'high' && !app.command.actions.recentlyVerified(ctx.session) }));
  });
  router.post('/command/actions/:id/confirm', F, async (ctx) => {
    const id = int(ctx.params.id);
    try {
      const done = await app.command.actions.confirm(id, { user: ctx.user, session: ctx.session, digest: str(ctx.body.digest, 80), password: ctx.body.password });
      ctx.redirect(done.result.link || '/command/approvals', done.result.message);
    } catch (err) {
      if (err.needsPassword) {
        const a = app.command.actions.get(id);
        ctx.flash = err.message;
        return ctx.html(views.action(ctx, { a, needsPassword: true }), 401);
      }
      throw err;
    }
  });
  router.post('/command/actions/:id/cancel', F, (ctx) => {
    const a = app.command.actions.get(int(ctx.params.id));
    if (!a) throw new HttpError(404, 'Action not found.');
    app.command.actions.cancel(a.id, ctx.user);
    ctx.redirect(a.source === 'chat' && a.conversation_id ? `/command/chat/${a.conversation_id}` : '/command/approvals', 'Cancelled. Nothing was changed.');
  });

  // ── Agent Studio ────────────────────────────────────────────────────
  router.get('/command/agents', F, (ctx) => ctx.html(views.agents(ctx, {
    agents: m().agents(),
    failed: db.all("SELECT j.*, p.code AS project_code FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE j.status = 'failed' ORDER BY j.id DESC LIMIT 20"),
    recent: db.all(`SELECT j.*, s.brain, s.provider, s.cost_micros, p.code AS project_code, (SELECT 1 FROM agent_runs r WHERE r.job_id = j.id AND r.provider = 'simulated' LIMIT 1) AS simulated
      FROM jobs j LEFT JOIN agent_sessions s ON s.job_id = j.id LEFT JOIN projects p ON p.id = j.project_id ORDER BY j.id DESC LIMIT 25`),
    provider: app.providers.describe(), spent: app.budget.aiSpentThisMonth(), budget: app.settings.get('ai_monthly_budget_usd'), paused: app.settings.get('orchestrator_paused'),
  })));
  router.get('/command/agents/tasks/:id', F, (ctx) => {
    const job = app.orchestrator.queue.get(int(ctx.params.id));
    if (!job) throw new HttpError(404, 'Task not found.');
    const session = app.agentRuntime.session(job.id);
    const stored = session ? JSON.parse(session.transcript) : [];
    const adapter = session && session.brain === 'model' ? app.providers.get(session.provider || 'anthropic') : null;
    ctx.html(views.agentTask(ctx, { job, session, transcript: adapter ? adapter.display(stored) : stored, runs: db.all('SELECT * FROM agent_runs WHERE job_id = ? ORDER BY id', job.id) }));
  });

  // ── Command Chat ────────────────────────────────────────────────────
  const chatMode = () => {
    const a = app.providers.selected();
    return a ? { model: true, label: `Answers from ${a.simulated ? 'a SIMULATED test model' : `${a.label} (${a.model()})`}` } : { model: false, label: 'Rules — no AI provider configured; common questions are answered from the records' };
  };
  const renderChat = (ctx, conversation) => ctx.html(views.chat(ctx, {
    conversation, messages: conversation ? app.command.chat.messages(conversation.id) : [], conversations: app.command.chat.conversations(ctx.user.id),
    projectId: int(ctx.query.get('project')) || null, mode: chatMode(),
  }));
  router.get('/command/chat', F, (ctx) => renderChat(ctx, null));
  router.get('/command/chat/:id', F, (ctx) => {
    const c = app.command.chat.conversation(int(ctx.params.id), ctx.user.id);
    if (!c) throw new HttpError(404, 'Conversation not found.');
    renderChat(ctx, c);
  });
  // Form fallback (no JavaScript).
  router.post('/command/chat', F, async (ctx) => {
    const r = await app.command.chat.send({ user: ctx.user, conversationId: int(ctx.body.conversation_id) || null, text: ctx.body.text, projectId: int(ctx.body.project_id) || null });
    ctx.redirect(`/command/chat/${r.conversationId}`);
  });
  router.post('/command/api/chat', FJ, async (ctx) => {
    const r = await app.command.chat.send({ user: ctx.user, conversationId: int(ctx.body.conversationId) || null, text: ctx.body.text, projectId: int(ctx.body.projectId) || null });
    const last = app.command.chat.messages(r.conversationId).slice(-1)[0];
    ctx.json({ conversationId: r.conversationId, html: String(views.chatMessage(ctx, last)), actions: r.actions, brain: r.brain });
  });

  // ── Performance ─────────────────────────────────────────────────────
  router.get('/command/performance', F, (ctx) => {
    const periodName = ['this_week', 'this_month', 'last_month', 'year_to_date'].includes(ctx.query.get('period')) ? ctx.query.get('period') : 'this_month';
    ctx.html(views.performance(ctx, { period: m().forPeriod(periodName), periodName, weeks: m().weeklyRevenue(12), months: m().monthly(6), eff: m().efficiency() }));
  });

  // ── Settings ────────────────────────────────────────────────────────
  const KINDS = Object.entries(app.command.notifications.KIND_LABEL);
  router.get('/command/settings', F, (ctx) => ctx.html(views.settings(ctx, {
    values: app.settings.all(), providers: app.providers.list(), devices: db.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', ctx.user.id).n,
    integrationsConnected: app.integrations.status().some((i) => i.connected), vapidKey: app.command.push.publicKey(), kinds: KINDS,
  })));
  // Personal preferences (what to be notified about, when the brief arrives) apply directly.
  router.post('/command/settings/preferences', F, (ctx) => {
    for (const [k] of KINDS) app.settings.set(`push_${k}`, ctx.body[`push_${k}`] === 'true', ctx.user);
    app.settings.set('brief_hour', ctx.body.brief_hour, ctx.user);
    app.settings.set('timezone', str(ctx.body.timezone, 60), ctx.user);
    ctx.redirect('/command/settings#notifications', 'Preferences saved.');
  });
  // Permissions, providers and budgets become a previewed, confirmed action.
  const SECTIONS = {
    permissions: [...app.settings.AGENT_IDS.map((id) => `agent_mode_${id}`), 'orchestrator_paused', 'autonomous_production'],
    provider: ['ai_provider'],
    budgets: ['ai_monthly_budget_usd', 'ai_project_budget_usd', 'external_project_budget_usd', 'external_job_estimate_usd', 'unusual_expense_usd'],
  };
  router.post('/command/settings/changes', F, (ctx) => {
    const keys = SECTIONS[ctx.body.section];
    if (!keys) throw new HttpError(400, 'Unknown settings section.');
    const changes = {};
    for (const k of keys) {
      const def = app.settings.DEFINITIONS[k];
      const v = def.type === 'bool' ? ctx.body[k] === 'true' : ctx.body[k];
      if (v === undefined) continue;
      if (String(app.settings.normalise(k, v)) !== String(app.settings.get(k))) changes[k] = v;
    }
    if (!Object.keys(changes).length) return ctx.redirect('/command/settings', 'Nothing changed.');
    const a = app.command.actions.propose('update_settings', { changes }, { source: 'settings', by: `staff:${ctx.user.email}` });
    ctx.redirect(`/command/actions/${a.id}`);
  });

  // ── Notifications & push ────────────────────────────────────────────
  router.get('/command/notifications', F, (ctx) => ctx.html(views.notifications(ctx, { rows: app.command.notifications.list(), labels: app.command.notifications.KIND_LABEL })));
  router.get('/command/notifications/:id', F, (ctx) => {
    const n = db.get('SELECT * FROM notifications WHERE id = ?', int(ctx.params.id));
    if (!n) throw new HttpError(404, 'Notification not found.');
    app.command.notifications.markRead(n.id);
    ctx.redirect(n.link && n.link.startsWith('/command') ? n.link : '/command/notifications');
  });
  router.post('/command/notifications/read', F, (ctx) => { app.command.notifications.markRead(null); ctx.redirect('/command/notifications'); });
  // The service worker asks what to show after a (payload-free) push.
  router.get('/command/api/notifications/latest', F, (ctx) => {
    const n = app.command.notifications.latestUnread();
    ctx.json(n ? { title: n.title, body: n.body, url: `/command/notifications/${n.id}`, tag: `sd-${n.id}`, unread: app.command.notifications.unreadCount() } : { title: 'Sunday Division', body: 'Nothing new.', url: '/command', tag: 'sd-none', unread: 0 });
  });
  router.post('/command/api/push/subscribe', FJ, (ctx) => {
    const sub = ctx.body.subscription || {};
    if (!app.command.push.subscribe(ctx.user.id, { endpoint: str(sub.endpoint, 1000), keys: sub.keys || {}, label: str(ctx.body.label, 80) })) {
      throw new HttpError(400, 'That push service is not accepted.');
    }
    app.audit.log(`staff:${ctx.user.email}`, 'command.push_subscribed', { detail: str(ctx.body.label, 80) });
    ctx.json({ ok: true });
  });
  router.post('/command/api/push/unsubscribe', FJ, (ctx) => ctx.json({ ok: app.command.push.unsubscribe(ctx.user.id, str((ctx.body.subscription || {}).endpoint, 1000)) }));
}

module.exports = { register };
