'use strict';
const { html, raw } = require('../lib/util');

const NAV = [
  ['/services', 'Services'], ['/portfolio', 'Portfolio'], ['/about', 'About'], ['/contact', 'Contact'],
];

/** Public site shell. */
function page(ctx, { title, description, body, path = '', dark = false }) {
  const full = title ? `${title} — Sunday Division` : 'Sunday Division — Fashion design & development studio';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${full}</title>
<meta name="description" content="${description || 'Sunday Division is a fashion design and development studio: design, technical flats and tech packs, 3D garment visualisation, product imagery and campaigns.'}">
<meta property="og:title" content="${full}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#0c0c0c">
<link rel="preload" href="/assets/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/hanken-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
<link rel="icon" href="/assets/img/mark.svg" type="image/svg+xml">
<script src="/assets/js/site.js" defer></script>
</head>
<body class="${dark ? 'has-dark-hero' : ''}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header" data-header>
  <a class="wordmark" href="/" aria-label="Sunday Division — home">Sunday Division</a>
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle><span>Menu</span></button>
  <nav class="site-nav" id="site-nav" aria-label="Primary">
    ${NAV.map(([href, label]) => html`<a href="${href}" ${path === href ? raw('aria-current="page"') : ''}>${label}</a>`)}
    <a href="/portal" class="site-nav__portal" ${path === '/portal' ? raw('aria-current="page"') : ''}>Client Portal</a>
    <a href="/start" class="btn btn--small ${dark ? 'btn--light' : ''}">Start a Project</a>
  </nav>
</header>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="site-footer__top">
    <p class="site-footer__mark">Sunday Division</p>
    <p class="site-footer__line">Fashion design and development, from first sketch to factory-ready files.</p>
  </div>
  <div class="site-footer__cols">
    <div><p class="label">Studio</p><a href="/services">Services</a><a href="/portfolio">Portfolio</a><a href="/about">About</a></div>
    <div><p class="label">Work with us</p><a href="/start">Start a Project</a><a href="/contact">Contact</a><a href="/portal">Client Portal</a></div>
    <div><p class="label">Scope</p><p>Design and development services. Manufacturing and physical production are not currently offered.</p></div>
  </div>
  <div class="site-footer__base">
    <span>© ${new Date().getFullYear()} Sunday Division</span>
    <a href="/privacy">Privacy</a>
  </div>
</footer>
</body>
</html>`;
}

/** Where "go back" should lead from an error inside the dashboard or portal. */
function backLink(ctx) {
  const path = ctx.url.pathname;
  if (path.startsWith('/portal') && ctx.client) return ['/portal/home', 'Back to your portal'];
  if (path.startsWith('/admin') && ctx.user) {
    let target = '/admin';
    try {
      const ref = new URL(ctx.req.headers.referer);
      if (ref.host === ctx.req.headers.host && ref.pathname.startsWith('/admin')) target = ref.pathname;
    } catch { /* no usable referer */ }
    return [target, 'Go back'];
  }
  return ['/', 'Return to the homepage'];
}

function errorPage(ctx, status, message) {
  const titles = { 400: 'That did not go through', 404: 'Page not found', 403: 'Not allowed', 409: 'Not possible right now', 413: 'Upload too large', 429: 'Too many attempts' };
  const [href, label] = backLink(ctx);
  if (ctx.user && ctx.url.pathname.startsWith('/admin')) {
    return require('./admin').shell(ctx, {
      title: titles[status] || 'Error', path: ctx.url.pathname,
      body: html`<header class="a-head"><div><p class="label">Error ${status}</p><h1 class="display display--m">${titles[status] || 'Something went wrong'}</h1></div></header>
        <section class="card"><p>${message}</p><p><a class="btn-a" href="${href}">${label}</a></p></section>`,
    });
  }
  return page(ctx, {
    title: titles[status] || 'Something went wrong',
    body: html`<section class="section section--narrow">
      <p class="label">Error ${status}</p>
      <h1 class="display display--m">${titles[status] || 'Something went wrong'}</h1>
      <p class="lede">${message}</p>
      <p><a class="link" href="${href}">${label}</a></p>
    </section>`,
  });
}

module.exports = { page, errorPage };
