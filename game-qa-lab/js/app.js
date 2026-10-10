/* Hash router and app shell behaviour. */
(function (QA) {
  'use strict';
  const { $, $$ } = QA.util;
  const main = document.getElementById('main');

  const routes = [
    [/^$/, 'dashboard', () => QA.views.dashboard(main)],
    [/^missions$/, 'missions', () => QA.views.missions(main)],
    [/^mission\/(\w+)$/, 'missions', (id) => mission(id, 'renderIntro')],
    [/^mission\/(\w+)\/run$/, 'missions', (id) => mission(id, 'renderRun')],
    [/^mission\/(\w+)\/result$/, 'missions', (id) => mission(id, 'renderResult')],
    [/^regression$/, 'regression', () => QA.views.regression(main)],
    [/^regression\/(\w+)$/, 'regression', (id) => mission(id, 'renderIntro')],
    [/^regression\/(\w+)\/run$/, 'regression', (id) => mission(id, 'renderRun')],
    [/^regression\/(\w+)\/result$/, 'regression', (id) => mission(id, 'renderResult')],
    [/^reports$/, 'reports', () => QA.views.reports(main)],
    [/^reports\/([\w-]+)$/, 'reports', (id) => QA.views.reportEditor(main, id)],
    [/^testcases$/, 'testcases', () => QA.views.testcases(main)],
    [/^testcases\/([\w-]+)$/, 'testcases', (id) => QA.views.testcaseEditor(main, id)],
    [/^tracker$/, 'tracker', () => QA.views.tracker(main)],
    [/^glossary$/, 'glossary', () => QA.views.glossary(main)],
    [/^interview$/, 'interview', () => QA.views.interview(main)],
    [/^interview\/([\w-]+)$/, 'interview', (id) => QA.views.interviewQuestion(main, id)],
    [/^review$/, 'review', () => QA.views.review(main)],
    [/^settings$/, 'settings', () => QA.views.settings(main)],
  ];

  function mission(id, fn) {
    const m = QA.engine.byId(id);
    if (!m) return notFound();
    QA.engine[fn](main, m);
  }

  function notFound() {
    main.innerHTML = '<div class="empty"><p>That page doesn’t exist.</p><a class="btn primary" href="#/">Go to dashboard</a></div>';
  }

  const TITLES = { dashboard: 'Dashboard', missions: 'Mission Center', regression: 'Regression Lab', reports: 'Bug Report Lab', testcases: 'Test Case Workshop', tracker: 'Bug Tracker Basics', glossary: 'QA Glossary', interview: 'Mock Interview', review: 'Readiness Review', settings: 'Progress & settings' };

  function route() {
    const path = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
    // Each view assigns its own handlers; clear the previous view's first.
    main.onclick = main.onchange = main.oninput = main.onsubmit = null;
    let nav = null;
    try {
      const hit = routes.find(([re]) => re.test(path));
      if (hit) { nav = hit[1]; hit[2](...path.match(hit[0]).slice(1)); }
      else notFound();
    } catch (err) {
      console.error(err);
      main.innerHTML = `<div class="form-error"><strong>Something went wrong showing this page.</strong> Your saved progress is unaffected. <a href="#/">Return to the dashboard</a>.</div>`;
    }
    $$('.sidebar a[data-nav]').forEach((a) => {
      const on = a.dataset.nav === nav;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = (TITLES[nav] ? TITLES[nav] + ' · ' : '') + 'Game QA Lab';
    closeMenu();
    window.scrollTo(0, 0);
  }

  // Mobile navigation
  const sidebar = $('#sidebar');
  const toggle = $('#menuToggle');
  const scrim = $('#scrim');
  function closeMenu() { sidebar.classList.remove('open'); scrim.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', () => {
    const open = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open); scrim.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    if (open) { const first = $('a[data-nav]', sidebar); if (first) first.focus(); }
  });
  scrim.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) { closeMenu(); toggle.focus(); } });

  // Keep other open tabs in sync if progress changes elsewhere.
  window.addEventListener('storage', (e) => { if (e.key === QA.store.KEY) { QA.store.load(); } });

  window.addEventListener('hashchange', route);
  route();
})(window.QA);
