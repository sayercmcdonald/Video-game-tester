'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { HttpError } = require('../lib/util');
const { parseRequestBody, readBody } = require('./body');
const { parseCookies } = require('./session');

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

class Router {
  constructor() { this.routes = []; }
  /**
   * opts: { auth: 'admin'|'portal', raw: true (unparsed body, no origin/CSRF check),
   *         maxBody: bytes }
   */
  add(method, pattern, opts, handler) {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    const source = pattern.replace(/:[a-z]+/gi, (k) => { keys.push(k.slice(1)); return '([^/]+)'; });
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, opts, handler });
  }
  get(...args) { this.add('GET', ...args); }
  post(...args) { this.add('POST', ...args); }
  match(method, pathname) {
    if (method === 'HEAD') method = 'GET';
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.create(null);
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

/** Per-request context handed to route handlers. */
class Context {
  constructor(app, req, res, url) {
    this.app = app;
    this.req = req;
    this.res = res;
    this.url = url;
    this.query = url.searchParams;
    this.params = Object.create(null);
    this.cookies = parseCookies(req.headers.cookie);
    this.body = Object.create(null);
    this.files = [];
    this.session = null;
    this.user = null;
    this.client = null;
    this.contractor = null;
    this.flash = '';
    this.setCookies = [];
  }
  get ip() {
    const fwd = this.app.config.trustProxy && this.req.headers['x-forwarded-for'];
    return (fwd ? String(fwd).split(',')[0].trim() : this.req.socket.remoteAddress) || 'unknown';
  }
  get actor() {
    if (this.user) return `staff:${this.user.email}`;
    if (this.client) return `client:${this.client.id}`;
    if (this.contractor) return `contractor:${this.contractor.id}`;
    return 'public';
  }
  send(status, body, headers = {}) {
    if (this.setCookies.length) this.res.setHeader('Set-Cookie', this.setCookies);
    this.res.writeHead(status, headers);
    this.res.end(this.req.method === 'HEAD' ? undefined : body);
  }
  html(body, status = 200) {
    this.send(status, String(body), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  json(data, status = 200) {
    this.send(status, JSON.stringify(data), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  }
  redirect(location, flash) {
    if (flash) this.setCookies.push(this.app.sessions.flashCookie(flash));
    this.send(303, '', { Location: location, 'Cache-Control': 'no-store' });
  }
}

function securityHeaders(res, config) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "img-src 'self' data:", "style-src 'self'", "script-src 'self'", "font-src 'self'",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function serveStatic(ctx, publicDir) {
  const rel = path.normalize(decodeURIComponent(ctx.url.pathname.replace(/^\/assets\//, '')));
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) throw new HttpError(404, 'Not found');
  let stat;
  try { stat = fs.statSync(file); } catch { throw new HttpError(404, 'Not found'); }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': ctx.app.config.isProd ? 'public, max-age=3600' : 'no-cache',
    ETag: etag,
  };
  if (ctx.req.headers['if-none-match'] === etag) return ctx.send(304, '', headers);
  headers['Content-Length'] = stat.size;
  ctx.res.writeHead(200, headers);
  if (ctx.req.method === 'HEAD') return ctx.res.end();
  fs.createReadStream(file).pipe(ctx.res);
}

/** Reject cross-site form posts even where no session-bound CSRF token exists. */
function sameOrigin(ctx) {
  const origin = ctx.req.headers.origin;
  if (!origin || origin === 'null') return origin !== 'null';
  try {
    const host = new URL(origin).host;
    return host === ctx.req.headers.host || host === new URL(ctx.app.config.baseUrl).host;
  } catch { return false; }
}

function createServer(app, router, views) {
  const publicDir = path.join(app.config.root, 'public');

  async function handle(req, res) {
    const url = new URL(req.url, 'http://internal');
    const ctx = new Context(app, req, res, url);
    securityHeaders(res, app.config);
    try {
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
      if (url.pathname.startsWith('/assets/')) {
        if (req.method === 'POST') throw new HttpError(405, 'Method not allowed');
        return serveStatic(ctx, publicDir);
      }
      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'Not found');
      if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      const { route, params } = match;
      ctx.params = params;

      // Sessions: both kinds are loaded so shared chrome can reflect sign-in state.
      const admin = app.sessions.load('admin', ctx.cookies);
      const portal = app.sessions.load('portal', ctx.cookies);
      if (admin) ctx.user = app.db.get('SELECT id, email, name, technical_reviewer FROM users WHERE id = ?', admin.user_id) || null;
      if (portal) ctx.client = app.db.get('SELECT * FROM clients WHERE id = ?', portal.client_id) || null;
      const contractor = app.sessions.load('contractor', ctx.cookies);
      if (contractor) ctx.contractor = app.db.get("SELECT * FROM contractors WHERE id = ? AND status = 'approved'", contractor.contractor_id) || null;
      ctx.session = { admin, portal, contractor }[route.opts.auth] || null;
      if (route.opts.auth === 'admin' && !ctx.user) return ctx.redirect('/admin/login');
      if (route.opts.auth === 'portal' && !ctx.client) return ctx.redirect('/portal');
      if (route.opts.auth === 'contractor' && !ctx.contractor) return ctx.redirect('/contractor');

      if (ctx.cookies.sd_flash) {
        ctx.flash = ctx.cookies.sd_flash;
        if (req.method === 'GET') ctx.setCookies.push(app.sessions.flashCookie(''));
      }

      if (req.method === 'POST') {
        if (route.opts.raw) {
          ctx.rawBody = await readBody(req, route.opts.maxBody || 1024 * 1024);
        } else {
          if (!sameOrigin(ctx)) throw new HttpError(403, 'Cross-site request refused.');
          const parsed = await parseRequestBody(req, route.opts.maxBody || 256 * 1024);
          ctx.body = parsed.fields;
          ctx.files = parsed.files;
          if (route.opts.auth && !app.sessions.checkCsrf(ctx.session, ctx.body._csrf)) {
            throw new HttpError(403, 'Your session expired. Go back, refresh the page and try again.');
          }
        }
      }
      await route.handler(ctx);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(`[error] ${req.method} ${url.pathname}`, err);
      const message = status === 500 ? 'Something went wrong on our side.' : err.message;
      if (url.pathname.startsWith('/webhooks/')) return ctx.json({ error: message }, status);
      try {
        ctx.html(views.errorPage(ctx, status, message), status);
      } catch (renderError) {
        console.error('[error] rendering error page', renderError);
        ctx.send(status, message, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.requestTimeout = 120e3;
  server.headersTimeout = 30e3;
  return server;
}

module.exports = { Router, createServer };
