(function (QA) {
  'use strict';
  const { esc, scoreTone } = QA.util;

  const CHECKLIST = [
    'I can explain the difference between severity and priority with an example.',
    'I can walk through the parts of a bug report in order, without notes.',
    'I can describe how I’d handle an issue I can’t reproduce.',
    'I can explain how to verify a fix and what regression testing is.',
    'I can define pass, fail and blocked.',
    'I have 2–3 true STAR stories (attention to detail, a mistake, learning something new).',
    'I can explain why I want to do QA work specifically, not just “I like games”.',
    'I can describe compatibility testing (system software versions, display modes, controllers, saves).',
    'I’ve read the job posting again and noted which duties I can speak to.',
    'I’m ready to say honestly what I have and haven’t done professionally.',
  ];

  QA.views.review = function (root) {
    const st = QA.store.get();
    const P = QA.progress;
    if (!P.hasActivity()) {
      root.innerHTML = `
        <div class="page-head"><div class="eyebrow">Interview</div><h1>Interview Readiness Review</h1></div>
        <div class="empty"><p>There’s nothing to review yet. This page only reports on activities you’ve actually completed.</p><a class="btn primary" href="${P.nextActivity().href}">Start with ${esc(P.nextActivity().title)}</a></div>
        ${checklistHTML(st)}`;
      bind(root);
      return;
    }

    const skills = P.skillSummary();
    const practiced = skills.filter((s) => s.count).sort((a, b) => b.pct - a.pct);
    const strong = practiced.filter((s) => s.pct >= 70).slice(0, 3);
    const weak = practiced.filter((s) => s.pct < 70).sort((a, b) => a.pct - b.pct).slice(0, 3);
    const untouched = skills.filter((s) => !s.count);

    const missions = QA.MISSIONS.concat(QA.REGRESSIONS).filter((m) => st.missions[m.id]);
    const reports = Object.entries(st.reports).map(([id, r]) => ({ d: QA.defectById(id), r })).filter((x) => x.d);
    const repAvg = reports.length ? Math.round(reports.reduce((s, x) => s + x.r.last.pct, 0) / reports.length) : null;
    const mReportScores = Object.values(st.missions).map((rec) => (rec.last.results.find((r) => r.type === 'report') || {}).reportPct).filter((x) => x != null);
    const ivs = P.interviewLatest();
    const ivAvg = ivs.length ? Math.round(ivs.reduce((s, x) => s + x.pct, 0) / ivs.length) : null;
    const revised = ivs.filter((x) => x.count > 1);
    const improved = revised.filter((x) => x.pct > x.first);
    const topicsCovered = new Set(ivs.map((x) => QA.interviewById(x.id).topic));
    const topicsMissing = Object.keys(QA.INTERVIEW_TOPICS).filter((t) => !topicsCovered.has(t));
    const cases = st.testCases.length;

    // Recommendations come only from gaps in recorded activity.
    const recs = [];
    weak.forEach((s) => recs.push({ href: s.practice.href, text: `${s.practice.label}, to strengthen ${s.label} (currently ${s.pct}%).` }));
    QA.MISSIONS.filter((m) => !st.missions[m.id]).forEach((m) => recs.push({ href: '#/mission/' + m.id, text: `Complete Mission: ${m.title}.` }));
    if (reports.length < 3) recs.push({ href: '#/reports', text: `Write ${3 - reports.length} more report${3 - reports.length > 1 ? 's' : ''} in the Bug Report Lab.` });
    if (topicsMissing.length) recs.push({ href: '#/interview', text: `Practice interview topics you haven’t tried: ${topicsMissing.map((t) => QA.INTERVIEW_TOPICS[t]).join(', ')}.` });
    if (revised.length < ivs.length && ivs.length) recs.push({ href: '#/interview', text: `Revise and resubmit ${ivs.length - revised.length} interview answer${ivs.length - revised.length > 1 ? 's' : ''} you’ve only answered once.` });
    QA.REGRESSIONS.filter((m) => !st.missions[m.id]).forEach((m) => recs.push({ href: '#/regression/' + m.id, text: `Regression Lab: ${m.title}.` }));
    if (!st.lessons.tracker) recs.push({ href: '#/tracker', text: 'Take the Bug Tracker Basics quiz.' });

    // Honest talking points: each is generated only from recorded activity.
    const talk = [];
    if (missions.length) talk.push(`I practiced ${missions.length} simulated QA investigation${missions.length > 1 ? 's' : ''}: reproducing intermittent issues, measuring frequency, and checking results against a spec.`);
    if (reports.length + mReportScores.length) talk.push(`I wrote ${reports.length + mReportScores.length} structured practice bug reports (summary, build, steps, expected vs. actual, frequency, severity) and revised them based on feedback.`);
    if (cases) talk.push(`I wrote ${cases} practice test cases covering things like boundaries, save/load and multiplayer states.`);
    if (st.missions.r1 || st.missions.r2) talk.push('I practiced fix verification: repeating original steps, regression-testing related areas, and marking pass/fail/blocked.');

    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Interview</div><h1>Interview Readiness Review</h1>
        <p>A summary of what you’ve actually done in this simulator. It doesn’t predict hiring outcomes. Simulator scores come from simplified local rules, and real interviews weigh many things this can’t measure.</p></div>

      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="panel"><div class="stat"><span class="stat-label">Missions</span><span class="stat-value">${QA.MISSIONS.filter((m) => st.missions[m.id]).length}/${QA.MISSIONS.length}</span><span class="stat-sub">+ ${QA.REGRESSIONS.filter((m) => st.missions[m.id]).length}/${QA.REGRESSIONS.length} regression</span></div></div>
        <div class="panel"><div class="stat"><span class="stat-label">Bug report quality</span><span class="stat-value">${repAvg == null ? '—' : repAvg + '%'}</span><span class="stat-sub">${reports.length ? `latest score avg., ${reports.length} lab defect${reports.length > 1 ? 's' : ''}` : 'no lab reports yet'}</span></div></div>
        <div class="panel"><div class="stat"><span class="stat-label">Interview questions</span><span class="stat-value">${ivs.length}/${QA.INTERVIEW.length}</span><span class="stat-sub">${ivAvg == null ? 'none practiced' : `latest avg. ${ivAvg}%`}</span></div></div>
        <div class="panel"><div class="stat"><span class="stat-label">Answers improved</span><span class="stat-value">${improved.length}/${revised.length}</span><span class="stat-sub">of answers you revised</span></div></div>
      </div>

      <div class="grid grid-2">
        <section class="panel"><h2>Strongest areas</h2>${strong.length ? `<ul>${strong.map((s) => `<li><strong>${esc(s.label)}</strong>: ${s.pct}% across ${s.count} activit${s.count > 1 ? 'ies' : 'y'}</li>`).join('')}</ul>` : '<p class="text-2">No area is at 70% or above yet.</p>'}</section>
        <section class="panel"><h2>Weakest areas</h2>${weak.length ? `<ul>${weak.map((s) => `<li><strong>${esc(s.label)}</strong>: ${s.pct}%. Practice: <a href="${s.practice.href}">${esc(s.practice.label)}</a></li>`).join('')}</ul>` : '<p class="text-2">Nothing you’ve practiced is below 70%.</p>'}
          ${untouched.length ? `<p class="small muted" style="margin:0">Not practiced yet: ${untouched.map((s) => esc(s.label)).join(', ')}.</p>` : ''}</section>
      </div>

      <section class="panel"><h2>Activity detail</h2>
        <div class="table-wrap"><table><thead><tr><th>Activity</th><th>Attempts</th><th>Best</th><th>Latest</th></tr></thead><tbody>
          ${missions.map((m) => { const r = st.missions[m.id]; return `<tr><td><a href="${QA.engine.basePath(m)}/result">${esc(m.title)}</a></td><td>${r.attempts}</td><td>${r.best}%</td><td>${r.last.pct}%</td></tr>`; }).join('')}
          ${reports.map((x) => `<tr><td><a href="#/reports/${x.d.id}">Report: ${esc(x.d.name)}</a></td><td>${x.r.attempts}</td><td>${x.r.best}%</td><td>${x.r.last.pct}%</td></tr>`).join('')}
          ${Object.entries(st.workshop).map(([id, r]) => `<tr><td><a href="#/testcases/${id}">Test cases: ${esc(QA.workshopById(id).title)}</a></td><td>${r.attempts}</td><td>${r.best}%</td><td>${r.last.pct}%</td></tr>`).join('')}
          ${ivs.map((x) => `<tr><td><a href="#/interview/${x.id}">Interview: ${esc(QA.interviewById(x.id).q)}</a></td><td>${x.count}</td><td>${x.best}%</td><td>${x.pct}%</td></tr>`).join('')}
        </tbody></table></div></section>

      <section class="panel"><h2>Recommended next exercises</h2>${recs.length ? `<ol>${recs.slice(0, 6).map((r) => `<li><a href="${r.href}">${esc(r.text)}</a></li>`).join('')}</ol>` : '<p class="text-2" style="margin:0">You’ve covered every module. Repeat your weakest activities, or re-answer interview questions out loud without looking.</p>'}</section>

      ${talk.length ? `<section class="panel"><h2>What you can honestly say</h2><p class="small muted">Based only on your recorded activity. Present it as self-directed practice, not professional experience.</p><ul>${talk.map((t) => `<li>“${esc(t)}”</li>`).join('')}</ul></section>` : ''}

      ${checklistHTML(st)}`;
    bind(root);
  };

  function checklistHTML(st) {
    const done = CHECKLIST.filter((_, i) => st.checklist['c' + i]).length;
    return `<section class="panel"><div class="panel-head"><h2>Before the interview</h2><span class="badge ${done === CHECKLIST.length ? 'good' : ''}">${done}/${CHECKLIST.length}</span></div>
      <div class="checklist">${CHECKLIST.map((c, i) => `<label><input type="checkbox" data-check="c${i}" ${st.checklist['c' + i] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div></section>`;
  }

  function bind(root) {
    root.onchange = (e) => {
      const c = e.target.closest('[data-check]');
      if (!c) return;
      QA.store.update((s) => { s.checklist[c.dataset.check] = c.checked; });
      const badge = c.closest('.panel').querySelector('.badge');
      const n = CHECKLIST.filter((_, i) => QA.store.get().checklist['c' + i]).length;
      badge.textContent = `${n}/${CHECKLIST.length}`;
      badge.className = 'badge ' + (n === CHECKLIST.length ? 'good' : '');
    };
  }

  QA.views.settings = function (root) {
    const st = QA.store.get();
    const ok = QA.store.storageOk();
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Settings</div><h1>Progress &amp; settings</h1>
        <p>Your progress is stored only in this browser (localStorage). Nothing is sent to a server, and no account or personal information is collected.</p></div>
      ${ok ? '' : '<div class="callout warn"><p>This browser is blocking local storage (private mode or blocked site data), so progress will be lost when you close the tab.</p></div>'}
      <section class="panel"><h2>Saved data</h2><ul class="text-2">
        <li>${Object.keys(st.missions).length} mission/scenario records</li>
        <li>${Object.keys(st.reports).length} bug report records</li>
        <li>${st.testCases.length} test cases</li>
        <li>${Object.keys(st.interview).length} interview questions answered</li>
        <li>${Object.keys(st.drafts).length} saved drafts</li></ul>
        <p class="small muted" style="margin:0">Progress stays on this device and browser. Clearing site data or using a private window starts fresh.</p></section>
      <section class="panel" style="border-color:rgba(240,122,106,.35)"><h2>Reset progress</h2>
        <p class="text-2">Permanently deletes all missions, reports, test cases, interview answers, drafts and checklist ticks from this browser. This can’t be undone.</p>
        <button class="btn danger" data-act="reset">Reset all progress…</button></section>
      <section class="panel soft"><h3>About</h3><p class="small text-2" style="margin:0">Game QA Lab is an independent training tool for people preparing for entry-level game QA roles. It is not affiliated with, sponsored by, or endorsed by Nintendo or any other game company. All games, builds, tickets and defects are fictional. The bug tracker shown is a simplified fictional interface, not a real product.</p></section>`;
    root.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'reset') {
        QA.util.ask({ title: 'Reset all progress?', message: 'This permanently deletes everything saved in this browser: missions, reports, test cases, interview answers, drafts and checklist ticks.', confirmLabel: 'Reset everything', danger: true }, () => {
          QA.store.reset();
          QA.util.toast('Progress reset');
          location.hash = '#/';
        });
      }
    };
  };
})(window.QA);
