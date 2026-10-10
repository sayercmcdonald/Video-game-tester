(function (QA) {
  'use strict';
  const { esc, $, toast, scoreRing, scoreTone } = QA.util;
  const C = () => QA.components;

  const FIELDS = ['title', 'env', 'pre', 'steps', 'expected', 'actual', 'frequency', 'severity', 'priority', 'observations'];
  const REQUIRED = new Set(['title', 'env', 'pre', 'steps', 'expected', 'actual', 'frequency', 'severity', 'priority']);

  QA.views.reports = function (root) {
    const st = QA.store.get();
    const lab = QA.DEFECTS.filter((d) => d.lab);
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Practice</div><h1>Bug Report Lab</h1>
        <p>Pick a defect, read the tester’s raw notes, and turn them into a professional report. The notes are realistic: they mix facts with guesses and irrelevant comments. Your report should keep the facts and leave out the rest.</p></div>
      <div class="grid grid-2" style="margin-bottom:16px">
        <section class="panel"><h3>Severity vs. priority</h3>
          <p class="text-2"><strong>Severity</strong> = how bad the defect is for the player (crash, lost data, blocked progress, cosmetic). QA usually proposes it from evidence.</p>
          <p class="text-2" style="margin:0"><strong>Priority</strong> = how soon the team should fix it, given release plans. Often set or adjusted by a lead or producer. A title-screen typo can be low severity but high priority.</p></section>
        <section class="panel"><h3>What the feedback checks</h3>
          <ul class="text-2 small" style="margin:0"><li>Could another tester follow your steps?</li><li>Are expected and actual results clearly separated?</li><li>Is there enough context (build, setup)?</li><li>Is the frequency stated accurately?</li><li>Is severity supported by the evidence?</li><li>Are assumptions kept out of the facts?</li></ul></section>
      </div>
      <div class="grid grid-3">${lab.map((d) => {
        const rec = st.reports[d.id];
        return `<article class="card">
          <div class="card-meta"><span class="badge">${esc(d.difficulty)}</span>${rec ? `<span class="badge ${scoreTone(rec.best)}">Best ${rec.best}%</span>` : st.drafts['report:' + d.id] ? '<span class="badge info">Draft saved</span>' : ''}</div>
          <h3>${esc(d.name)}</h3><p>${esc(d.game)} · ${esc(d.area)}</p>
          <div class="row end"><a class="btn sm ${rec ? '' : 'primary'}" href="#/reports/${d.id}">${rec ? 'Practice again' : 'Write report'}</a></div></article>`;
      }).join('')}</div>`;
  };

  QA.views.reportEditor = function (root, id) {
    const d = QA.defectById(id);
    if (!d || !d.lab) { root.innerHTML = '<div class="empty">That defect doesn’t exist. <a href="#/reports">Back to the lab</a></div>'; return; }
    const dkey = 'report:' + id;
    let showFeedback = false;
    let showModel = false;

    function draw() {
      const st = QA.store.get();
      const rec = st.reports[id];
      const values = st.drafts[dkey] || (rec && rec.last.fields) || {};
      const res = showFeedback && rec ? rec.last.result : null;
      root.innerHTML = `
        <div class="crumbs"><a href="#/reports">Bug Report Lab</a> / ${esc(d.name)}</div>
        <div class="page-head"><div class="eyebrow">${esc(d.game)} (fictional) · ${esc(d.area)}</div><h1>${esc(d.name)}</h1></div>
        <div class="grid grid-2" style="align-items:start">
          <section class="panel sticky-panel">
            <h2>Tester’s raw notes</h2>
            <p class="small muted">Written quickly during a session. Not everything here belongs in a report.</p>
            <div class="spec pre mono" style="font-size:.84rem">${esc(d.notes)}</div>
            <h3 style="margin-top:16px">Requirement</h3>
            <div class="spec">${esc(d.spec)}</div>
            ${rec ? `<p class="small muted" style="margin-top:12px">Attempts: ${rec.attempts} · Best: ${rec.best}% · Last: ${rec.last.pct}%</p>` : ''}
          </section>
          <section class="panel">
            <h2>Your report</h2>
            <p class="small muted">Local practice only. Nothing is sent to a real tracker. Fields marked <span class="req">*</span> are required.</p>
            <form data-form novalidate>
              ${C().reportForm(FIELDS, values, 'rep', REQUIRED)}
              <div class="form-error" role="alert" hidden></div>
              <div class="row">
                <button class="btn primary" type="submit">Submit for feedback</button>
                <button class="btn" type="button" data-act="model">${showModel ? 'Hide example' : 'Show example report'}</button>
                <button class="btn ghost" type="button" data-act="clear">Clear form</button>
              </div>
            </form>
          </section>
        </div>
        <div data-out>
          ${res ? `
            <section class="panel" id="feedback" tabindex="-1">
              <div class="score-hero">${scoreRing(res.pct, 'Report quality')}<div><h2 style="margin:0 0 4px">Report quality: ${res.pct}%</h2>
              <p class="text-2" style="margin:0">${res.earned} of ${res.possible} rubric points. ${res.pct >= 80 ? 'Strong report. Compare with the example for polish.' : res.pct >= 55 ? 'Solid start. The items marked below will make it easier to act on.' : 'Several key parts are missing or unclear. Work through the items below and resubmit.'}</p></div></div>
            </section>
            <section class="panel"><h2>Specific improvements</h2>${C().reportCats(res.cats)}
              <p class="small muted">Scored by fixed local rules: keyword coverage against the facts in the notes, structure checks, an exact frequency match, and a scan for speculative wording. Treat it as guidance; a human reviewer might phrase things differently.</p></section>` : ''}
          ${showModel ? `<section class="panel" id="model"><h2>Example report</h2><p class="small muted">One good way to write it. Wording can differ; facts, structure and objectivity are what matter.</p>${C().ticket(d.model, { key: 'LAB-' + id.toUpperCase(), reporter: 'Example', labels: d.area })}</section>` : ''}
        </div>`;
    }

    function saveDraft() {
      const f = C().readFields($('[data-form]', root));
      QA.store.update((s) => { s.drafts[dkey] = f; });
    }

    root.oninput = (e) => { if (e.target.closest('[data-form]')) saveDraft(); };
    root.onchange = (e) => { if (e.target.closest('[data-form]')) saveDraft(); };
    root.onsubmit = (e) => {
      e.preventDefault();
      const form = $('[data-form]', root);
      const err = $('.form-error', form);
      const bad = C().validateFields(form, REQUIRED);
      if (bad) { err.hidden = false; err.textContent = `Complete the required fields before submitting (${bad} missing). Feedback is only useful on a full report.`; return; }
      err.hidden = true;
      const fields = C().readFields(form);
      const result = QA.eval.evaluateReport(fields, d);
      QA.store.update((s) => {
        const prev = s.reports[id] || { attempts: 0, best: 0 };
        s.reports[id] = { attempts: prev.attempts + 1, best: Math.max(prev.best, result.pct), last: { pct: result.pct, fields, result, ts: Date.now() } };
        s.drafts[dkey] = fields;
      });
      showFeedback = true;
      showModel = true;
      draw();
      const fb = $('#feedback', root);
      if (fb) { fb.focus(); fb.scrollIntoView({ block: 'start' }); }
    };
    root.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'model') {
        const rec = QA.store.get().reports[id];
        if (!showModel && !rec && !confirm('You haven’t submitted a report for this defect yet. Seeing the example first makes the exercise less useful. Show it anyway?')) return;
        saveDraft();
        showModel = !showModel; draw();
        if (showModel) { const m = $('#model', root); if (m) m.scrollIntoView({ block: 'start' }); }
      }
      if (b.dataset.act === 'clear') {
        if (!confirm('Clear every field in this report?')) return;
        QA.store.update((s) => { s.drafts[dkey] = {}; });
        showFeedback = false; draw(); toast('Form cleared');
      }
    };
    draw();
  };
})(window.QA);
