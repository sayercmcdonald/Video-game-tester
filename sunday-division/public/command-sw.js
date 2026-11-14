/* Sunday Division Command — service worker (scope /command).
 *
 * Scope /command (the overview itself and everything under it).
 * Caches only static assets (styles, script, fonts, icons) and an offline page. Pages and
 * API responses — which carry financial and client data — are never cached on the device.
 * Pushes arrive without a payload; the worker fetches what to show over the signed-in
 * session, so no business data passes through the push service.
 */
'use strict';
// The server prepends `self.SD_ASSETS = { version, shell }` with content-hashed URLs (see
// src/lib/assets.js), so every deploy that changes a file installs a fresh cache. The list
// below is only a fallback for serving this file directly.
const ASSETS = self.SD_ASSETS || {};
const VERSION = ASSETS.version || 'command-dev';
const SHELL = ['/command/offline', ...(ASSETS.shell || [
  '/assets/css/tokens.css',
  '/assets/css/ui.css',
  '/assets/css/command.css',
  '/assets/js/command.js',
  '/assets/fonts/cormorant-garamond-lining-latin-400-normal.woff2',
  '/assets/fonts/cormorant-garamond-lining-latin-500-normal.woff2',
  '/assets/fonts/instrument-sans-latin-wght-normal.woff2',
  '/assets/command/hero-drape.jpg',
  '/assets/command/icon-192.png',
])];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/assets/')) {
    // Static files: serve from cache, refresh in the background.
    event.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }
  if (req.mode === 'navigate' && url.pathname.startsWith('/command')) {
    // Pages always come from the network; offline shows a page with no data in it.
    event.respondWith(fetch(req).catch(() => caches.match('/command/offline')));
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let n = { title: 'Sunday Division', body: 'Open Command to see what is new.', url: '/command/notifications', tag: 'sd-update' };
    try {
      const res = await fetch('/command/api/notifications/latest', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) n = await res.json();
    } catch { /* offline or signed out: show the generic notice */ }
    await self.registration.showNotification(n.title, {
      body: n.body, tag: n.tag, data: { url: n.url },
      icon: '/assets/command/icon-192.png', badge: '/assets/command/badge-72.png',
    });
    if (self.navigator.setAppBadge && typeof n.unread === 'number') {
      try { if (n.unread) await self.navigator.setAppBadge(n.unread); else await self.navigator.clearAppBadge(); } catch { /* unsupported */ }
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/command', self.location.origin);
  if (!target.pathname.startsWith('/command')) target.pathname = '/command';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith('/command')) { await w.focus(); return w.navigate(target.href); }
    }
    return self.clients.openWindow(target.href);
  })());
});
