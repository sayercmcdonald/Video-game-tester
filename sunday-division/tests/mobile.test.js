'use strict';
/**
 * Mobile usability of Sunday Division Command, in a real browser. Runs where Playwright and
 * Chromium are installed (development machines, CI with browsers); skipped elsewhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN, driveWorkflow } = require('./helpers');

let playwright = null;
try { playwright = require('playwright'); } catch { /* not installed */ }

const SCREENS = ['/command', '/command/brief', '/command/projects', '/command/projects/1', '/command/approvals', '/command/agents', '/command/chat', '/command/performance', '/command/settings', '/command/notifications', '/command/more'];

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
    if (!visible(el) || el.closest('p, li > span, .ui-cite')) continue; // inline links in text are exempt (WCAG 2.5.8)
    // A checkbox or radio inside its label is operated through the whole label.
    const target = /^(checkbox|radio)$/.test(el.type) && el.closest('label') ? el.closest('label') : el;
    const r = target.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) problems.push(`small target (${Math.round(r.width)}×${Math.round(r.height)}): ${el.tagName} ${(el.textContent || el.name || '').trim().slice(0, 30)}`);
  }
  for (const el of document.querySelectorAll('.ui-nav__item, .ui-appbar__bell, .ui-appbar__back, .ui-row, .ui-btn:not(.ui-btn--small), .ui-iconbtn, .ui-tabs__item, .c-btn:not(.c-btn--small), .c-list__row')) {
    if (!visible(el)) continue;
    if (el.getBoundingClientRect().height < 44) problems.push(`primary control under 44px: ${(el.textContent || '').trim().slice(0, 30)}`);
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

test('Command is usable on a phone and on a desktop', { skip: playwright ? false : 'Playwright is not installed' }, async (t) => {
  const { app, base, close } = await startApp({ FOUNDER_EMAIL: ADMIN.email });
  const founder = app.db.get('SELECT * FROM users WHERE email = ?', ADMIN.email);
  app.contractors.create({ name: 'Sam Okafor', email: 'sam@contractor.test', discipline: 'Technical design', capacity: '3', skills: ['technical_flats', 'tech_pack'], categories: ['Outerwear'], status: 'approved' }, 6000, founder);
  await driveWorkflow(app, base, 'production');
  const second = await driveWorkflow(app, base, 'quote_approval', { ...require('./helpers').INQUIRY, brand_name: 'Second Brand', email: 'second@brand.test' });
  const third = await driveWorkflow(app, base, 'quote_approval', { ...require('./helpers').INQUIRY, brand_name: 'Third Brand', email: 'third@brand.test' });
  app.command.brief.request({ manual: true, by: 'test' });
  await app.orchestrator.drain();
  const browser = await playwright.chromium.launch();
  t.after(async () => { await browser.close(); await close(); });

  for (const [label, options] of [['iPhone 13', playwright.devices['iPhone 13']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    await t.test(label, async () => {
      const ctx = await browser.newContext({ ...options, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}/command/login`);
      assert.deepEqual(await page.evaluate(audit), [], 'sign-in page');
      await page.fill('#email', ADMIN.email);
      await page.fill('#password', ADMIN.password);
      await Promise.all([page.waitForURL(`${base}/command`), page.click('button[type=submit]')]);
      for (const path of SCREENS) {
        await page.goto(base + path);
        assert.deepEqual(await page.evaluate(audit), [], `${label} ${path}`);
      }
      // Body and secondary text against the background meet WCAG AA.
      const colors = await page.evaluate(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const muted = document.querySelector('.c-muted');
        return { bg, text: getComputedStyle(document.body).color, muted: muted ? getComputedStyle(muted).color : null };
      });
      assert.ok(contrast(colors.text, colors.bg) >= 7, 'body text contrast');
      if (colors.muted) assert.ok(contrast(colors.muted, colors.bg) >= 4.5, 'secondary text contrast');
      // The chat works with JavaScript: ask, get an answer, no page reload.
      await page.goto(`${base}/command/chat`);
      await page.fill('#q', 'What did we earn this week?');
      await page.click('button[aria-label="Send"]');
      await page.waitForSelector('.ui-msg--assistant:not(.ui-msg--typing)');
      assert.match(page.url(), /\/command\/chat\/\d+$/);
      if (label === 'iPhone 13') {
        // The tab bar sits above the home indicator and every tab is reachable.
        const tabs = await page.$$eval('.ui-nav__item', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.querySelector('.ui-nav__label').textContent.trim()));
        assert.deepEqual(tabs, ['Overview', 'Projects', 'Agents', 'Approvals', 'Command']);
        // The tab bar never covers the composer or the last row of content.
        const overlap = await page.evaluate(() => {
          const bar = document.querySelector('.ui-nav').getBoundingClientRect();
          const composer = document.querySelector('.ui-composer').getBoundingClientRect();
          return composer.bottom > bar.top + 1;
        });
        assert.equal(overlap, false);
      }
      if (label === 'iPhone 13') {
        // High-impact confirmation: one tap only arms it; a second tap confirms.
        const quote = app.quotes.forProject(second.projectId).find((q) => q.status === 'draft');
        const tapId = app.command.actions.propose('send_quote', { quote_id: quote.id }, { source: 'approvals', by: `staff:${ADMIN.email}` }).id;
        await page.goto(`${base}/command/actions/${tapId}`);
        await page.tap('[data-hold]');
        await page.waitForTimeout(300);
        assert.equal(app.command.actions.get(tapId).status, 'proposed', 'a single tap changes nothing');
        assert.match(await page.textContent('[data-hold-label]'), /Press again to confirm/);
        await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/command/actions/')), page.tap('[data-hold]')]);
        assert.equal(app.command.actions.get(tapId).status, 'executed');
      } else {
        // Press and hold confirms in one gesture; letting go early does not.
        const rec = app.db.get("SELECT id FROM assignments WHERE status = 'recommended' ORDER BY id LIMIT 1");
        const holdId = app.command.actions.propose('approve_assignment', { assignment_id: rec.id }, { source: 'approvals', by: `staff:${ADMIN.email}` }).id;
        const centre = async () => {
          await page.locator('[data-hold]').scrollIntoViewIfNeeded();
          const b = await page.locator('[data-hold]').boundingBox();
          return [b.x + b.width / 2, b.y + b.height / 2, b];
        };
        await page.goto(`${base}/command/actions/${holdId}`);
        let [cx, cy, box] = await centre();
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.waitForTimeout(100);
        assert.match(await page.getAttribute('[data-hold]', 'class'), /is-holding/, 'the hold is under way');
        await page.waitForTimeout(300);
        await page.mouse.move(box.x - 40, box.y - 40); // slid off: cancelled
        await page.mouse.up();
        await page.waitForTimeout(1200);
        assert.equal(app.command.actions.get(holdId).status, 'proposed', 'an interrupted hold changes nothing');
        await page.goto(`${base}/command/actions/${holdId}`);
        [cx, cy, box] = await centre();
        await page.mouse.move(cx, cy);
        await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/command/actions/')), (async () => { await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up(); })()]);
        assert.equal(app.command.actions.get(holdId).status, 'executed');
        // Keyboard only: Enter arms the confirmation; a second Enter confirms.
        const quote = app.quotes.forProject(third.projectId).find((q) => q.status === 'draft');
        const keyId = app.command.actions.propose('send_quote', { quote_id: quote.id }, { source: 'approvals', by: `staff:${ADMIN.email}` }).id;
        await page.goto(`${base}/command/actions/${keyId}`);
        await page.focus('[data-hold]');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        assert.equal(app.command.actions.get(keyId).status, 'proposed', 'one key press only arms it');
        assert.match(await page.textContent('[data-hold-label]'), /Press again to confirm/);
        await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/command/actions/')), page.keyboard.press('Enter')]);
        assert.equal(app.command.actions.get(keyId).status, 'executed');
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
});
