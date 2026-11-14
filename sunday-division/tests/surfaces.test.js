'use strict';
/**
 * The studio dashboard, client portal and public website on the shared design system, in a
 * real browser: layout at phone and desktop sizes, basic accessibility, keyboard access, and
 * the confirmations that guard sensitive dashboard actions. Runs where Playwright and
 * Chromium are installed; skipped elsewhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN, INQUIRY, driveWorkflow, fieldBorderAudit } = require('./helpers');

let playwright = null;
try { playwright = require('playwright'); } catch { /* not installed */ }

const SITE = ['/', '/services', '/portfolio', '/about', '/start', '/contact', '/portal', '/privacy'];
const STUDIO = ['/admin/inbox', '/admin/inbox?f=waiting', '/admin', '/admin/leads', '/admin/projects', '/admin/approvals', '/admin/messages', '/admin/ops', '/admin/ops/tasks', '/admin/ops/agents', '/admin/ops/settings', '/admin/invoices', '/admin/contractors'];

/** Runs in the page: returns a list of problems. */
function audit() {
  const problems = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  if (document.documentElement.lang !== 'en') problems.push('missing lang');
  const h1s = [...document.querySelectorAll('h1')].filter(visible);
  if (h1s.length !== 1) problems.push(`${h1s.length} visible h1 elements`);
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!visible(el)) continue;
    const named = (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('aria-label');
    if (!named) problems.push(`unlabelled ${el.tagName.toLowerCase()} ${el.name}`);
  }
  for (const el of document.querySelectorAll('a, button, summary, select, input:not([type=hidden]), textarea')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]') || el.closest('p, li > span, label > span, td, dd, figcaption')) continue; // inline links in text are exempt (WCAG 2.5.8); the spam honeypot is hidden from everyone
    const target = /^(checkbox|radio)$/.test(el.type) && el.closest('label') ? el.closest('label') : el;
    const r = target.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) problems.push(`small target (${Math.round(r.width)}×${Math.round(r.height)}): ${el.tagName} ${(el.textContent || el.name || '').trim().slice(0, 30)}`);
  }
  for (const el of document.querySelectorAll('a, button')) {
    if (!visible(el)) continue;
    if (!(el.textContent.trim() || el.getAttribute('aria-label'))) problems.push(`control without a name: ${el.outerHTML.slice(0, 60)}`);
  }
  return problems;
}

function contrast(fg, bg) {
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const colours = () => {
  const body = getComputedStyle(document.body);
  const second = document.querySelector('.label, .muted, .field__hint');
  return { bg: body.backgroundColor, text: body.color, second: second ? getComputedStyle(second).color : null, secondBg: second ? getComputedStyle(second.closest('.card, .p-block, .section--bone, .hero, .section--ink, .site-footer, body')).backgroundColor : null };
};

test('dashboard, portal and website on the design system', { skip: playwright ? false : 'Playwright is not installed' }, async (t) => {
  const { app, base, close } = await startApp({ FOUNDER_EMAIL: ADMIN.email });
  const founder = app.db.get('SELECT * FROM users WHERE email = ?', ADMIN.email);
  app.contractors.create({ name: 'Sam Okafor', email: 'sam@contractor.test', discipline: 'Technical design', capacity: '3', skills: ['technical_flats', 'tech_pack'], categories: ['Outerwear'], status: 'approved' }, 6000, founder);
  const live = await driveWorkflow(app, base, 'production');
  const due = await driveWorkflow(app, base, 'deposit', { ...INQUIRY, brand_name: 'Deposit Brand', email: 'deposit@brand.test' });
  const dueClient = app.projects.get(due.projectId).client_id;
  const portalKey = app.projects.issuePortalKey(dueClient, 'test');
  const browser = await playwright.chromium.launch();
  t.after(async () => { await browser.close(); await close(); });

  for (const [label, options] of [['iPhone 13', playwright.devices['iPhone 13']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    await t.test(label, async () => {
      const ctx = await browser.newContext({ ...options, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      // ── Public website: light theme on the shared tokens ──
      for (const path of SITE) {
        await page.goto(base + path);
        assert.deepEqual(await page.evaluate(audit), [], `${label} ${path}`);
        assert.deepEqual(await page.evaluate(fieldBorderAudit), [], `${label} ${path} field outlines`);
      }
      await page.goto(base + '/');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-light')), true);
      let c = await page.evaluate(colours);
      assert.equal(c.bg, 'rgb(238, 234, 227)', 'limestone page (Atelier)');
      assert.ok(contrast(c.text, c.bg) >= 7, 'site body text contrast');
      // Keyboard: the first Tab reaches the skip link, which moves past the navigation.
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
      await page.keyboard.press('Enter');
      assert.match(page.url(), /#main$/);
      if (label === 'iPhone 13') {
        await page.click('[data-nav-toggle]');
        assert.equal(await page.getAttribute('[data-nav-toggle]', 'aria-expanded'), 'true');
        assert.ok(await page.isVisible('#site-nav a[href="/start"]'), 'menu opens on phones');
      }

      // ── Client portal: simple, with the next step first ──
      await page.goto(base + '/portal');
      await page.fill('input[name=key]', portalKey);
      await Promise.all([page.waitForURL(/\/portal\/home$/), page.click('form[action="/portal/access"] button[type=submit]')]);
      assert.deepEqual(await page.evaluate(audit), [], `${label} portal home`);
      assert.deepEqual(await page.evaluate(fieldBorderAudit), [], `${label} portal field outlines`);
      assert.match(await page.textContent('.p-next'), /Deposit due/);
      await page.click('.p-next a');
      assert.match(page.url(), new RegExp(`#invoices-${due.projectId}$`));
      assert.ok(await page.isVisible('form[action$="/pay"] button'), 'the deposit can be paid from the portal');
      c = await page.evaluate(colours);
      if (c.second) assert.ok(contrast(c.second, c.secondBg) >= 4.5, 'portal secondary text contrast');
      // The portal only shows this client's project.
      assert.doesNotMatch(await page.content(), new RegExp(app.projects.get(live.projectId).code));

      // ── Studio dashboard: dark theme, same components ──
      await page.goto(base + '/admin/login');
      assert.deepEqual(await page.evaluate(audit), [], `${label} studio sign-in`);
      await page.fill('input[name=email]', ADMIN.email);
      await page.fill('input[name=password]', ADMIN.password);
      await Promise.all([page.waitForURL(/\/admin$/), page.click('button[type=submit]')]);
      for (const path of [...STUDIO, `/admin/projects/${live.projectId}`, `/admin/leads/${live.inquiryId}`, `/admin/ops/workflows/${live.wfId}`]) {
        await page.goto(base + path);
        assert.deepEqual(await page.evaluate(audit), [], `${label} ${path}`);
        assert.deepEqual(await page.evaluate(fieldBorderAudit), [], `${label} ${path} field outlines`);
      }
      c = await page.evaluate(colours);
      assert.equal(c.bg, 'rgb(17, 17, 17)', 'obsidian dashboard');
      assert.ok(contrast(c.text, c.bg) >= 7, 'dashboard body text contrast');
      await page.goto(base + '/admin');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
      assert.ok(await page.isVisible('form[action="/admin/logout"] button'), 'sign out is reachable');

      if (label === 'desktop') {
        // Sensitive dashboard actions still ask first: dismissing the confirmation changes nothing.
        const pausedNow = () => Boolean(app.db.get('SELECT paused FROM workflows WHERE id = ?', due.wfId).paused);
        await page.goto(`${base}/admin/ops/workflows/${due.wfId}`);
        page.once('dialog', (d) => d.dismiss());
        await page.click('form[action$="/pause"] button');
        await page.waitForTimeout(300);
        assert.equal(pausedNow(), false, 'a dismissed confirmation changes nothing');
        page.once('dialog', (d) => { assert.match(d.message(), /Pause this workflow/); d.accept(); });
        await Promise.all([page.waitForURL(`${base}/admin/ops/workflows/${due.wfId}`), page.click('form[action$="/pause"] button')]);
        assert.equal(pausedNow(), true);

        // ── Inbox: the same queues as Approvals and Operations, in one list ──
        const inboxData = require('../src/services/inbox').view(app);
        await page.goto(`${base}/admin/inbox`);
        assert.equal(await page.locator('.ib-row').count(), inboxData.list.length, 'every waiting item is listed');
        assert.ok(inboxData.list.length > 0, 'the driven workflows leave work waiting');
        assert.equal(await page.textContent('#ib-title'), inboxData.list[0].title, 'the first item opens by default');
        // J moves focus down the list; Enter opens it.
        await page.locator('.ib-row').first().focus();
        if (inboxData.list.length > 1) {
          await page.keyboard.press('j');
          assert.equal(await page.evaluate(() => document.activeElement.querySelector('.ib-row__title').textContent), inboxData.list[1].title);
          await Promise.all([page.waitForURL(/item=/), page.keyboard.press('Enter')]);
          assert.equal(await page.textContent('#ib-title'), inboxData.list[1].title);
        }
        // Waiting on the client: the deposit project is there and asks nothing of the studio.
        await page.goto(`${base}/admin/inbox?f=waiting`);
        assert.match(await page.textContent('.ib-rows'), /Deposit from/);
        // An action taken in the inbox posts to the existing route and comes back to the inbox.
        const fresh = app.intake.createProjectInquiry({ ...INQUIRY, website: '', brand_name: 'Inbox Brand', email: 'inbox@brand.test' }, []);
        const freshId = typeof fresh === 'object' ? fresh.id : fresh;
        await page.goto(`${base}/admin/inbox?f=inquiry&item=inquiry-${freshId}`);
        assert.match(await page.textContent('#ib-title'), /Inbox Brand/);
        await Promise.all([page.waitForURL(`${base}/admin/inbox`), page.click('form[action$="/status"] button')]);
        assert.equal(app.db.get('SELECT status FROM inquiries WHERE id = ?', freshId).status, 'reviewing');
      }
      if (label === 'iPhone 13') {
        // Phones show the list, then one item with a way back.
        await page.goto(`${base}/admin/inbox`);
        assert.ok(await page.isVisible('.ib-rows'));
        assert.equal(await page.isVisible('.ib-pane'), false);
        const first = page.locator('.ib-row').first();
        await Promise.all([page.waitForURL(/item=/), first.click()]);
        assert.ok(await page.isVisible('#ib-title'));
        assert.equal(await page.isVisible('.ib-rows'), false);
        assert.ok(await page.isVisible('.ib-back'));
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
});
