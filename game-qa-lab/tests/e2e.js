/* End-to-end check of Game QA Lab in a real browser.
   Usage: start the app (npm start), then: npm test
   Env: BASE_URL (default http://localhost:5173/), CHROMIUM_PATH (optional). */
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node-tools/node_modules/playwright'); }

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail != null ? '  — ' + detail : ''}`);
}

const BENCH_PLANS = {
  m1: [[{ motion: 'descending', jump: 'full', landing: 'center' }, 5], [{ motion: 'descending', jump: 'hop', landing: 'center' }, 3], [{ motion: 'horizontal', jump: 'full', landing: 'center' }, 2], [{ motion: 'rising', jump: 'full', landing: 'center' }, 2]],
  m2: [[{ timing: 'results', method: 'close' }, 4], [{ timing: 'icon', method: 'close' }, 2], [{ timing: 'after', method: 'close' }, 2], [{ timing: 'results', method: 'title' }, 2], [{ timing: 'icon', method: 'power' }, 2]],
  m3: [[{ who: 'guest', when: 'transition', reconnect: 'none' }, 4], [{ who: 'guest', when: 'transition', reconnect: 'quick' }, 2], [{ who: 'guest', when: 'mid', reconnect: 'none' }, 2], [{ who: 'host', when: 'transition', reconnect: 'none' }, 1], [{ who: 'guest', when: 'lobby', reconnect: 'none' }, 1]],
};
const FREQ = { m1: ['descending|full|center', 4, 5], m2: ['results|close', 3, 4], m3: ['guest|transition|none', 4, 4] };
const TEXT = {
  'm1.impact': 'The gear platform is on the only path through 3-2, so every player must cross it. A full jump onto the descending platform fails in 4/5 attempts and costs a life with a respawn at checkpoint B. A workaround exists: a short hop avoids it, so players can still progress.',
  'm3.steps': '1. On Kit A (Host), create an online 2-player session in the lobby.\n2. On Kit B (Guest), join the session from the lobby.\n3. Play round 1 to completion on both kits.\n4. When the round 2 loading transition appears, unplug Kit B network cable.\n5. Observe the host screen on Kit A for 3 minutes and try opening the pause menu.',
  'r1.comment': 'Verified on build 0.9.430. Original steps passed 10/10 attempts with video attached. Sideways platform in 2-4 now jitters, a new regression, filed as a new linked bug. Rising platforms in 5-1 are blocked by a crash on load. Will retest 5-1 once the crash is fixed.',
  'r2.comment': 'Verified on 2.0.040 on both kits. Original steps passed 6/6, host returned to lobby after 15 s. Normal transition without a disconnect now has a 15 s delay, a regression, filed and linked. 4-player check is blocked because only two kits are available. Will retest when more kits arrive.',
};

async function completeMission(p, id, good) {
  await p.goto(BASE + '#/' + (id.startsWith('r') ? 'regression/' : 'mission/') + id);
  await p.click('[data-act="start"], [data-act="restart"]');
  await p.waitForSelector('#step-title');
  const m = await p.evaluate((mid) => {
    const x = QA.engine.byId(mid);
    return { steps: x.steps.map((s) => ({ id: s.id, type: s.type, fields: s.fields, defectRef: s.defectRef, options: s.options && s.options.map((o) => ({ id: o.id, correct: o.correct, points: o.points })), items: s.items && s.items.map((i) => ({ id: i.id, answer: i.answer })), categories: s.categories })) };
  }, id);
  for (const s of m.steps) {
    if (s.type === 'multi') {
      for (const o of s.options) if (good ? o.correct : !o.correct) await p.check(`input[name="${s.id}"][value="${o.id}"]`);
    } else if (s.type === 'single') {
      const pick = good ? s.options.reduce((a, b) => (b.points > a.points ? b : a)) : s.options.reduce((a, b) => (b.points < a.points ? b : a));
      await p.check(`input[name="${s.id}"][value="${pick.id}"]`);
    } else if (s.type === 'classify') {
      for (const it of s.items) {
        const ans = good ? it.answer : s.categories.find((c) => c !== it.answer);
        await p.selectOption(`#c-${s.id}-${it.id}`, ans);
      }
    } else if (s.type === 'bench') {
      const plan = good ? BENCH_PLANS[id] : [[BENCH_PLANS[id][2][0], 3], [BENCH_PLANS[id][2][0], 3]];
      for (const [cfg, n] of plan) {
        for (const [k, v] of Object.entries(cfg)) await p.check(`input[data-var="${k}"][value="${v}"]`);
        for (let i = 0; i < n; i++) await p.click('[data-act="run1"]');
      }
    } else if (s.type === 'frequency') {
      const [key, x, y] = FREQ[id];
      const keys = await p.$$eval('[data-f="key"] option', (os) => os.map((o) => o.value).filter(Boolean));
      await p.selectOption('[data-f="key"]', good ? key : keys[0]);
      await p.fill('[data-f="x"]', String(good ? x : 6));
      await p.fill('[data-f="y"]', String(good ? y : 6));
    } else if (s.type === 'text') {
      await p.fill('[data-text]', good ? TEXT[id + '.' + s.id] : 'It is bad and probably the code is broken somehow etc.');
    } else if (s.type === 'report') {
      const model = await p.evaluate((ref) => QA.defectById(ref).model, s.defectRef);
      for (const f of s.fields) {
        if (f === 'severity' || f === 'priority') { await p.selectOption(`[data-field="${f}"]`, good ? model[f] : 'S4'); continue; }
        let v = f === 'steps' ? model.steps.join('\n') : model[f];
        if (f === 'frequency') v = `${FREQ[id][1]}/${FREQ[id][2]} attempts`;
        if (!good) v = { title: 'Platform broken', steps: 'Play the game and do stuff', frequency: 'always' }[f] || 'It probably fails because the code is bad';
        await p.fill(`[data-field="${f}"]`, v);
      }
    }
    const last = s === m.steps[m.steps.length - 1];
    await p.click(last ? '[data-act="submit"]' : '[data-act="next"]');
    if (!last) {
      const err = await p.$eval('.form-error', (e) => (e.hidden ? '' : e.textContent)).catch(() => '');
      if (err) throw new Error(`${id} step ${s.id} blocked: ${err}`);
    }
  }
  await p.waitForSelector('.score-hero');
  return p.evaluate((mid) => QA.store.get().missions[mid], id);
}

(async () => {
  const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('dialog', (d) => d.accept());

  // ---------- Fresh state ----------
  await p.goto(BASE + '#/');
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  const fresh = await p.textContent('#main');
  check('Dashboard fresh state shows no earned stats', fresh.includes('0%') && fresh.includes('0 / 3') && fresh.includes('none completed yet'));

  // ---------- Navigation ----------
  for (const r of ['missions', 'reports', 'testcases', 'regression', 'tracker', 'glossary', 'interview', 'review', 'settings']) {
    await p.click(`.sidebar a[data-nav="${r}"]`);
    const h1 = await p.textContent('#main h1');
    check(`Nav: ${r}`, h1 && h1.length > 3, h1);
  }

  // ---------- Missions ----------
  const m1 = await completeMission(p, 'm1', true);
  check('Mission 1 good attempt scores high', m1.last.pct >= 90, m1.last.pct + '%');
  const resultText = await p.textContent('#main');
  check('Result page shows score breakdown, model investigation and example report', resultText.includes('How your score was calculated') && resultText.includes('Model investigation') && resultText.includes('Example defect report'));
  const m1poor = await completeMission(p, 'm1', false);
  check('Mission 1 weak retry scores much lower', m1poor.last.pct < 35, m1poor.last.pct + '%');
  check('Mission 1 best score kept after weaker retry', m1poor.best === m1.last.pct && m1poor.attempts === 2);
  const m2 = await completeMission(p, 'm2', true);
  check('Mission 2 good attempt', m2.last.pct >= 90, m2.last.pct + '%');
  const m3 = await completeMission(p, 'm3', true);
  check('Mission 3 good attempt', m3.last.pct >= 90, m3.last.pct + '%');
  const r1 = await completeMission(p, 'r1', true);
  check('Regression scenario 1', r1.last.pct >= 90, r1.last.pct + '%');
  const r2 = await completeMission(p, 'r2', true);
  check('Regression scenario 2', r2.last.pct >= 90, r2.last.pct + '%');

  // Validation inside a mission: can't skip the bench without runs
  await p.goto(BASE + '#/mission/m1'); await p.click('[data-act="start"]');
  await p.check('input[name="gather"][value="build"]'); await p.click('[data-act="next"]');
  await p.click('[data-act="next"]');
  const benchErr = await p.textContent('.form-error');
  check('Mission bench step blocks Next until enough attempts', /Run at least 5 attempts/.test(benchErr), benchErr);

  // ---------- Bug Report Lab ----------
  await p.goto(BASE + '#/reports/shop-cap');
  await p.fill('[data-field="title"]', ''); await p.click('button[type="submit"]');
  const invalid = await p.$$eval('.field.invalid', (els) => els.length);
  const formErr = await p.textContent('[data-form] .form-error');
  check('Empty bug report is blocked with field errors', invalid >= 8 && /required fields/.test(formErr), `${invalid} invalid fields`);
  check('No score saved for invalid report', await p.evaluate(() => !QA.store.get().reports['shop-cap']));
  const weak = { title: 'Shop broken', env: 'latest', pre: 'n/a', steps: 'Buy seeds somehow', expected: 'Should work', actual: 'It should not charge, probably the code is bad', frequency: 'always', observations: '' };
  for (const [k, v] of Object.entries(weak)) await p.fill(`[data-field="${k}"]`, v);
  await p.selectOption('[data-field="severity"]', 'S1'); await p.selectOption('[data-field="priority"]', 'P4');
  await p.click('button[type="submit"]'); await p.waitForSelector('#feedback');
  const weakRes = await p.evaluate(() => QA.store.get().reports['shop-cap'].last.result);
  const weakPct = weakRes.pct;
  const cat = (id) => weakRes.cats.find((c) => c.id === id);
  const model = await p.evaluate(() => QA.defectById('shop-cap').model);
  for (const k of ['title', 'env', 'pre', 'expected', 'actual', 'frequency', 'observations']) await p.fill(`[data-field="${k}"]`, model[k]);
  await p.fill('[data-field="steps"]', model.steps.join('\n'));
  await p.selectOption('[data-field="severity"]', model.severity); await p.selectOption('[data-field="priority"]', model.priority);
  await p.click('button[type="submit"]'); await p.waitForSelector('#feedback');
  const goodRec = await p.evaluate(() => QA.store.get().reports['shop-cap']);
  check('Weak bug report scores low', weakPct < 35, weakPct + '%');
  check('Good bug report scores high', goodRec.last.pct >= 90, goodRec.last.pct + '%');
  const fbText = await p.textContent('#main');
  check('Weak report feedback flags speculation, uncounted frequency, missing build', cat('obj').earned < 8 && cat('freq').earned < 12 && cat('freq').items.some((i) => /give the count/.test(i.text)) && cat('env').earned === 0 && cat('obj').items.some((i) => /Speculation/.test(i.text)));
  check('Example report shown after submit', fbText.includes('Example report'));

  // ---------- Test Case Workshop ----------
  await p.goto(BASE + '#/testcases/boundary');
  await p.click('button[type="submit"]');
  check('Empty test case blocked', (await p.$$eval('.field.invalid', (e) => e.length)) === 3);
  const tcs = [
    ['Pick up item at 98', 'Bag has 98 Turnip Seeds.', '1. Pick up 1 seed.\n2. Open bag.', 'Stack shows 99 and the seed is removed from the ground.'],
    ['Pick up item at 99 limit', 'Bag has 99 Turnip Seeds.', '1. Walk over a seed.\n2. Open bag.', 'Message “Your bag can’t hold any more.” shown; stack stays 99.'],
    ['Sell the last item', 'Bag has 1 seed.', '1. Sell 1 seed.\n2. Open bag.', 'Slot is removed and coins increase.'],
  ];
  for (const [t, pre, st, ex] of tcs) {
    await p.fill('[data-k="title"]', t); await p.fill('[data-k="pre"]', pre); await p.fill('[data-k="steps"]', st); await p.fill('[data-k="expected"]', ex);
    await p.click('button[type="submit"]');
  }
  check('Three test cases added', (await p.evaluate(() => QA.store.get().testCases.length)) === 3);
  await p.click('[data-act="edit"] >> nth=0');
  await p.fill('[data-k="title"]', 'Pick up item when stack is at 98'); await p.selectOption('[data-k="status"]', 'pass');
  await p.click('button[type="submit"]');
  check('Test case edited', await p.evaluate(() => QA.store.get().testCases[0].title === 'Pick up item when stack is at 98' && QA.store.get().testCases[0].status === 'pass'));
  await p.click('[data-act="del"] >> nth=2');
  check('Test case deleted', (await p.evaluate(() => QA.store.get().testCases.length)) === 2);
  await p.click('[data-act="check"]'); await p.waitForSelector('#tc-eval');
  const ws = await p.evaluate(() => QA.store.get().workshop.boundary.last.pct);
  check('Workshop coverage evaluated', ws > 0, ws + '%');

  // ---------- Tracker quiz ----------
  await p.goto(BASE + '#/tracker');
  await p.click('[data-hs="priority"]');
  check('Ticket hotspot explains field', (await p.textContent('.callout h3')) === 'Priority');
  await p.click('form[data-quiz] button[type="submit"]');
  check('Incomplete quiz blocked', /Answer all/.test(await p.textContent('[data-quiz] .form-error')));
  const quiz = await p.evaluate(() => QA.TRACKER_QUIZ.map((q) => [q.id, q.options.find((o) => o.correct).id]));
  for (const [q, o] of quiz) await p.check(`input[name="${q}"][value="${o}"]`);
  await p.click('form[data-quiz] button[type="submit"]');
  check('Quiz scored 100% with correct answers', (await p.evaluate(() => QA.store.get().lessons.tracker.quiz.pct)) === 100);

  // ---------- Interview ----------
  await p.goto(BASE + '#/interview/cant-repro');
  await p.click('button[type="submit"]');
  check('Empty interview answer blocked', /at least a couple/.test(await p.textContent('.form-error')));
  await p.fill('#iv-answer', 'I would just try again and if it does not happen then it is not a real bug and I would close it, I never miss anything.');
  await p.click('button[type="submit"]'); await p.waitForSelector('#iv-fb');
  const ex = await p.evaluate(() => QA.interviewById('cant-repro').example);
  check('Example answer shown after first submission', (await p.textContent('#main')).includes(ex.slice(0, 40)));
  await p.fill('#iv-answer', ex);
  await p.click('button[type="submit"]'); await p.waitForSelector('#iv-fb');
  const iv = await p.evaluate(() => QA.store.get().interview['cant-repro'].attempts.map((a) => a.pct));
  check('Interview revision recorded and improved', iv.length === 2 && iv[1] > iv[0] + 30, iv.join(' → '));
  check('Score delta displayed', /\+\d+ points vs\. previous attempt/.test(await p.textContent('#iv-fb')));
  // A behavioral question with STAR
  await p.goto(BASE + '#/interview/detail-time');
  await p.fill('#iv-answer', await p.evaluate(() => QA.interviewById('detail-time').example));
  await p.click('button[type="submit"]'); await p.waitForSelector('#iv-fb');
  const star = await p.evaluate(() => QA.store.get().interview['detail-time'].attempts[0].result.star);
  check('STAR detection on behavioral example', star && star.S && star.T && star.A && star.R, JSON.stringify(star));

  // ---------- Dashboard reflects real state ----------
  await p.goto(BASE + '#/');
  const dash = await p.textContent('#main');
  check('Dashboard: missions 3 / 3', dash.includes('3 / 3'));
  check('Dashboard: best mission score', dash.includes(Math.max(m1.best, m2.best, m3.best) + '%'));
  check('Dashboard: interview 2 / ' + (await p.evaluate(() => QA.INTERVIEW.length)), dash.includes('2 / ' + (await p.evaluate(() => QA.INTERVIEW.length))));
  const overall = await p.evaluate(() => QA.progress.overall());
  check('Dashboard overall progress computed', overall > 40 && overall < 100, overall + '%');

  // ---------- Review ----------
  await p.goto(BASE + '#/review');
  const rv = await p.textContent('#main');
  check('Review lists strongest/weakest and recommendations', rv.includes('Strongest areas') && rv.includes('Recommended next exercises') && rv.includes('What you can honestly say'));
  await p.check('[data-check="c0"]');

  // ---------- Persistence ----------
  const before = await p.evaluate(() => localStorage.getItem(QA.store.KEY).length);
  await p.reload();
  await p.goto(BASE + '#/');
  const after = await p.textContent('#main');
  check('Progress persists after reload', after.includes('3 / 3') && (await p.evaluate(() => QA.store.get().checklist.c0 === true)), `${before} bytes saved`);
  // In-progress mission draft survives reload
  await p.goto(BASE + '#/mission/m2'); await p.click('[data-act="start"]');
  await p.check('input[name="plan"][value="baseline"]'); await p.click('[data-act="next"]');
  await p.click('[data-act="run5"]');
  await p.reload(); await p.goto(BASE + '#/mission/m2');
  check('In-progress mission can be resumed after reload', /Resume \(step 2/.test(await p.textContent('#main')));

  // ---------- Mobile ----------
  const mob = await browser.newPage({ viewport: { width: 375, height: 740 } });
  mob.on('pageerror', (e) => errors.push('mobile: ' + e.message));
  for (const r of ['', 'missions', 'mission/m1/result', 'reports/map-crash', 'testcases/boundary', 'tracker', 'interview/cant-repro', 'review', 'regression/r1/result']) {
    await mob.goto(BASE + '#/' + r); await mob.waitForTimeout(100);
    const over = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`Mobile no horizontal overflow: /${r}`, over <= 0, `overflow ${over}px`);
  }
  await mob.goto(BASE + '#/');
  await mob.click('#menuToggle');
  const open = await mob.evaluate(() => document.getElementById('sidebar').classList.contains('open'));
  await mob.click('.sidebar a[data-nav="glossary"]');
  check('Mobile menu opens and navigates', open && (await mob.textContent('#main h1')) === 'QA Glossary');
  await mob.close();

  // ---------- Reset ----------
  await p.goto(BASE + '#/settings');
  await p.click('[data-act="reset"]');
  await p.waitForTimeout(200);
  const resetDash = await p.textContent('#main');
  check('Reset clears progress', resetDash.includes('none completed yet') && (await p.evaluate(() => Object.keys(QA.store.get().missions).length === 0 && QA.store.get().testCases.length === 0)));

  check('No console or page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
