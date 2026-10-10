(function (QA) {
  'use strict';
  const { esc } = QA.util;

  function card(m, i) {
    const st = QA.store.get();
    const rec = st.missions[m.id];
    const draft = QA.engine.getDraft(m);
    const base = QA.engine.basePath(m);
    const status = rec ? `<span class="badge ${QA.util.scoreTone(rec.best)}">Best ${rec.best}%</span><span class="badge">${rec.attempts} attempt${rec.attempts > 1 ? 's' : ''}</span>`
      : draft ? '<span class="badge info">In progress</span>' : '<span class="badge">Not started</span>';
    return `<article class="card">
      <div class="card-meta"><span class="eyebrow" style="margin:0">${m.kind === 'regression' ? 'Scenario' : 'Mission'} ${i + 1}</span>${status}</div>
      <h3>${esc(m.title)}</h3>
      <p>${esc(m.tagline)}</p>
      <div class="card-meta small muted">${esc(m.game)} · ${m.steps.length} steps · ~${m.minutes} min</div>
      <div class="card-meta">${m.skills.map((s) => `<span class="badge">${esc(QA.SKILLS[s])}</span>`).join('')}</div>
      <div class="row end">${rec ? `<a class="btn ghost sm" href="${base}/result">Last result</a>` : ''}<a class="btn ${rec ? '' : 'primary'} sm" href="${draft ? base + '/run' : base}">${draft ? 'Resume' : rec ? 'Retry' : 'Open'}</a></div>
    </article>`;
  }

  QA.views.missions = function (root) {
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Practice</div><h1>Mission Center</h1>
        <p>Each mission is a full investigation: read the assignment, decide what to test, run attempts on a simulated test bench, judge what you saw against the spec, and write it up. The bench behaves consistently, so the frequency you state can be checked against your own log.</p></div>
      <div class="grid grid-3">${QA.MISSIONS.map(card).join('')}</div>`;
  };

  QA.views.regression = function (root) {
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Practice</div><h1>Regression Testing Lab</h1>
        <p>A developer says a bug is fixed. Your job is to verify that claim with evidence: repeat the original steps, check what the fix might have broken, record results honestly as pass, fail or blocked, and decide what happens to the ticket.</p></div>
      <div class="callout"><p><strong>Key idea:</strong> a fix passing one test does not prove the feature works. Fixes often change shared code, so nearby behavior can break (a <em>regression</em>).</p></div>
      <div class="grid grid-2">${QA.REGRESSIONS.map(card).join('')}</div>`;
  };
})(window.QA);
