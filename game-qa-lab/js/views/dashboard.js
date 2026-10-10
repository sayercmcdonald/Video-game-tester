(function (QA) {
  'use strict';
  const { esc } = QA.util;

  QA.views = QA.views || {};

  QA.views.dashboard = function (root) {
    const P = QA.progress;
    const st = QA.store.get();
    const mods = P.modules();
    const overall = P.overall();
    const next = P.nextActivity();
    const skills = P.skillSummary();
    const practiced = skills.filter((s) => s.count);
    const weak = practiced.filter((s) => s.pct < 70).sort((a, b) => a.pct - b.pct);
    const best = P.bestMission();
    const missionsDone = QA.MISSIONS.filter((m) => st.missions[m.id]).length;
    const ivCount = P.interviewLatest().length;
    const fresh = !P.hasActivity();

    root.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Game QA Lab</div>
        <h1>${fresh ? 'Learn game testing by doing it' : 'Your training dashboard'}</h1>
        <p>${fresh
          ? 'Hands-on practice for an entry-level game QA tester role: reproduce fictional defects, write bug reports, design test cases, verify fixes, and rehearse interview answers. Progress is saved in this browser only.'
          : 'Everything below is calculated from what you have actually completed in this browser.'}</p>
      </div>

      <section class="panel" style="border-color:rgba(181,232,90,.35)">
        <div class="row between">
          <div><div class="eyebrow">${fresh ? 'Start here' : 'Recommended next'}</div><h2 style="margin:0 0 4px">${esc(next.title)}</h2><p class="text-2" style="margin:0">${esc(next.why)}</p></div>
          <a class="btn primary" href="${next.href}">${fresh ? 'Start training' : 'Continue'} →</a>
        </div>
      </section>

      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="panel"><div class="stat"><span class="stat-label">Training progress</span><span class="stat-value">${overall}%</span>
          <div class="progress" aria-hidden="true"><span style="width:${overall}%"></span></div><span class="stat-sub">Average completion of 6 modules</span></div></div>
        <div class="panel"><div class="stat"><span class="stat-label">Missions</span><span class="stat-value">${missionsDone} / ${QA.MISSIONS.length}</span><span class="stat-sub">${missionsDone ? 'completed at least once' : 'none completed yet'}</span></div></div>
        <div class="panel"><div class="stat"><span class="stat-label">Best mission score</span><span class="stat-value">${best == null ? '—' : best + '%'}</span><span class="stat-sub">${best == null ? 'complete a mission to see this' : 'highest single attempt'}</span></div></div>
        <div class="panel"><div class="stat"><span class="stat-label">Interview questions</span><span class="stat-value">${ivCount} / ${QA.INTERVIEW.length}</span><span class="stat-sub">${ivCount ? 'attempted at least once' : 'none attempted yet'}</span></div></div>
      </div>

      <div class="grid grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Modules</h2></div>
          ${mods.map((m) => `
            <div class="meter-row"><a href="${m.href}" style="color:var(--text);text-decoration:none">${esc(m.label)}</a>
              <div class="progress" role="progressbar" aria-label="${esc(m.label)}" aria-valuemin="0" aria-valuemax="${m.total}" aria-valuenow="${m.done}"><span style="width:${(m.done / m.total) * 100}%"></span></div>
              <span class="num">${m.raw != null ? m.raw : m.done}/${m.total}</span></div>`).join('')}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Skills</h2><span class="small muted">Average of your latest result in each activity</span></div>
          ${practiced.length ? skills.map((s) => `
            <div class="meter-row"><span>${esc(s.label)}</span>
              ${s.count ? `<div class="progress" aria-hidden="true"><span style="width:${s.pct}%;${s.pct < 70 ? 'background:var(--warn)' : ''}"></span></div><span class="num">${s.pct}%</span>` : '<span class="small muted">Not practiced yet</span><span></span>'}
            </div>`).join('') : '<div class="empty">No skills practiced yet. Your skill levels will appear here after your first activity.</div>'}
        </section>
      </div>

      ${practiced.length ? `<section class="panel"><h2>Needs work</h2>${weak.length
        ? `<ul>${weak.map((s) => `<li><strong>${esc(s.label)}</strong> (${s.pct}%): practice in <a href="${s.practice.href}">${esc(s.practice.label)}</a></li>`).join('')}</ul>`
        : '<p class="text-2" style="margin:0">Every skill you’ve practiced is at 70% or higher. Try the ones marked “Not practiced yet”.</p>'}</section>` : ''}

      <section class="panel soft">
        <h3>How this works</h3>
        <ul class="text-2" style="margin:0">
          <li>Each mission gives you a fictional assignment, a spec, and a test bench that behaves like a real (intermittent) bug.</li>
          <li>Feedback and model answers appear only after you submit, so your first attempt is a real test.</li>
          <li>All scoring is done by transparent local rules that are explained next to every score. No AI service is used. Treat scores as a training aid, not a hiring assessment.</li>
        </ul>
      </section>`;
  };
})(window.QA);
