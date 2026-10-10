(function (QA) {
  'use strict';
  const { esc, $, toast, uid, lines, scoreRing, scoreTone, fbItems } = QA.util;

  const STATUSES = [
    { id: 'notrun', label: 'Not run', tone: '' },
    { id: 'pass', label: 'Pass', tone: 'good' },
    { id: 'fail', label: 'Fail', tone: 'bad' },
    { id: 'blocked', label: 'Blocked', tone: 'warn' },
  ];
  const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];

  QA.views.testcases = function (root) {
    const st = QA.store.get();
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Practice</div><h1>Test Case Workshop</h1>
        <p>Turn a feature description into test cases another tester could run and get the same answer. Each exercise focuses on a different kind of risk. Write your own cases, then check your coverage.</p></div>
      <div class="grid grid-2" style="margin-bottom:16px">
        <section class="panel"><h3>What makes a test case repeatable</h3>
          <ul class="text-2 small" style="margin:0"><li><strong>Preconditions</strong>: the exact starting state (save, settings, build).</li><li><strong>Steps</strong>: specific actions in order, one per line.</li><li><strong>Expected result</strong>: something observable, based on the spec. “It works” isn’t a result.</li><li><strong>One behavior per case</strong>, so a failure points somewhere specific.</li></ul></section>
        <section class="panel"><h3>Pass, fail, blocked</h3>
          <ul class="text-2 small" style="margin:0"><li><span class="badge good">Pass</span> actual matched expected.</li><li><span class="badge bad">Fail</span> actual didn’t match; file or link a bug.</li><li><span class="badge warn">Blocked</span> couldn’t be run (crash earlier, missing hardware). Not a pass.</li><li><span class="badge">Not run</span> written but not executed yet.</li></ul></section>
      </div>
      <div class="grid grid-3">${QA.WORKSHOP.map((ex) => {
        const n = st.testCases.filter((c) => c.exercise === ex.id).length;
        const rec = st.workshop[ex.id];
        return `<article class="card"><div class="card-meta"><span class="eyebrow" style="margin:0">${esc(ex.topic)}</span>${rec ? `<span class="badge ${scoreTone(rec.best)}">Best ${rec.best}%</span>` : ''}</div>
          <h3>${esc(ex.title)}</h3><p>${esc(ex.feature)}</p>
          <div class="row between"><span class="small muted">${n} test case${n === 1 ? '' : 's'} written</span><a class="btn sm ${n ? '' : 'primary'}" href="#/testcases/${ex.id}">${n ? 'Continue' : 'Start'}</a></div></article>`;
      }).join('')}</div>`;
  };

  QA.views.testcaseEditor = function (root, exId) {
    const ex = QA.workshopById(exId);
    if (!ex) { root.innerHTML = '<div class="empty">Exercise not found. <a href="#/testcases">Back to the workshop</a></div>'; return; }
    let editing = null; // id of case being edited
    let showEval = !!QA.store.get().workshop[exId];

    const blank = { title: '', pre: '', steps: '', expected: '', actual: '', status: 'notrun' };

    function cases() { return QA.store.get().testCases.filter((c) => c.exercise === exId); }

    function caseCard(c, i) {
      const q = QA.eval.caseQuality(c);
      const s = statusOf(c.status);
      return `<article class="fb" aria-label="Test case ${i + 1}">
        <div class="fb-head"><strong>TC-${i + 1}: ${esc(c.title)}</strong><span class="badge ${s.tone}">${s.label}</span></div>
        ${c.pre ? `<p class="small"><span class="muted">Preconditions:</span> ${esc(c.pre)}</p>` : ''}
        <ol class="small" style="margin-bottom:6px">${lines(c.steps).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        <p class="small"><span class="muted">Expected:</span> ${esc(c.expected)}</p>
        ${c.actual ? `<p class="small"><span class="muted">Actual / notes:</span> ${esc(c.actual)}</p>` : ''}
        <details style="margin:6px 0"><summary class="small">Repeatability check: ${q.score}/4</summary>${fbItems(q.checks.map((k) => ({ kind: k.ok ? 'ok' : 'no', text: k.text })))}</details>
        <div class="row end"><button class="btn sm" data-act="edit" data-id="${c.id}">Edit</button><button class="btn sm danger" data-act="del" data-id="${c.id}">Delete</button></div>
      </article>`;
    }

    function formHTML(c) {
      return `<form data-form novalidate>
        <div class="field"><label for="tc-title">Test case title <span class="req">*</span></label><input id="tc-title" type="text" data-k="title" value="${esc(c.title)}" placeholder="e.g. Pick up item when stack is at 99"><span class="field-error" hidden></span></div>
        <div class="field"><label for="tc-pre">Preconditions</label><textarea id="tc-pre" rows="2" data-k="pre" placeholder="Starting state: save, settings, inventory…">${esc(c.pre)}</textarea></div>
        <div class="field"><label for="tc-steps">Steps <span class="req">*</span></label><textarea id="tc-steps" rows="4" data-k="steps" placeholder="One action per line">${esc(c.steps)}</textarea><span class="field-error" hidden></span></div>
        <div class="field"><label for="tc-exp">Expected result <span class="req">*</span></label><textarea id="tc-exp" rows="2" data-k="expected" placeholder="Observable outcome based on the feature description">${esc(c.expected)}</textarea><span class="field-error" hidden></span></div>
        <div class="grid grid-2">
          <div class="field"><label for="tc-act">Actual result / execution notes</label><textarea id="tc-act" rows="2" data-k="actual" placeholder="Optional. Only fill this in if you actually ran it.">${esc(c.actual)}</textarea></div>
          <div class="field"><label for="tc-status">Status</label><select id="tc-status" data-k="status">${STATUSES.map((s) => `<option value="${s.id}" ${c.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select><span class="hint">This is a written exercise: leave “Not run” unless you recorded a result.</span></div>
        </div>
        <div class="form-error" role="alert" hidden></div>
        <div class="row"><button class="btn primary" type="submit">${editing ? 'Save changes' : 'Add test case'}</button>${editing ? '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>' : ''}</div>
      </form>`;
    }

    function draw() {
      const st = QA.store.get();
      const list = cases();
      const current = editing ? list.find((c) => c.id === editing) || blank : (st.drafts['tc:' + exId] || blank);
      const rec = st.workshop[exId];
      root.innerHTML = `
        <div class="crumbs"><a href="#/testcases">Test Case Workshop</a> / ${esc(ex.title)}</div>
        <div class="page-head"><div class="eyebrow">${esc(ex.topic)} · ${esc(ex.game)} (fictional)</div><h1>${esc(ex.title)}</h1></div>
        <section class="panel"><h2>Feature under test</h2><p class="spec">${esc(ex.feature)}</p><p class="text-2 small" style="margin:12px 0 0"><strong>Why this matters:</strong> ${esc(ex.why)}</p></section>
        <div class="grid grid-2" style="align-items:start">
          <section class="panel" id="tc-form-panel"><h2>${editing ? 'Edit test case' : 'New test case'}</h2>${formHTML(current)}</section>
          <section class="panel"><div class="panel-head"><h2>Your test cases (${list.length})</h2></div>
            ${list.length ? list.map(caseCard).join('') : '<div class="empty">No test cases yet. Write at least 3 that cover different risks, then check your coverage.</div>'}
            <div class="row" style="margin-top:10px"><button class="btn primary" data-act="check" ${list.length < 2 ? 'disabled' : ''}>Check my coverage</button><span class="small muted">${list.length < 2 ? 'Needs at least 2 test cases' : ''}</span></div>
          </section>
        </div>
        ${showEval && rec ? evalHTML(rec.last.result) : ''}`;
    }

    function evalHTML(r) {
      return `<section class="panel" id="tc-eval" tabindex="-1">
        <div class="score-hero">${scoreRing(r.pct, 'Workshop score')}<div><h2 style="margin:0 0 4px">Coverage &amp; quality: ${r.pct}%</h2>
          <p class="text-2 small" style="margin:0">60% coverage (${r.covHit} of ${r.cov.length} risk areas) + 40% average repeatability (${Math.round(r.avgQ * 100)}%). Detected by keywords in your cases, so phrase things concretely.</p></div></div>
        <h3 style="margin-top:16px">Risk areas</h3>${fbItems(r.cov.map((c) => ({ kind: c.hit ? 'ok' : 'no', text: (c.hit ? 'Covered: ' : 'Not covered: ') + c.label })))}
        <h3 style="margin-top:16px">Example test cases</h3><p class="small muted">Compare structure and specificity with yours.</p>
        ${ex.models.map((m) => `<div class="fb"><div class="fb-head"><strong>${esc(m.title)}</strong></div><p class="small"><span class="muted">Preconditions:</span> ${esc(m.pre)}</p><ol class="small">${lines(m.steps).map((l) => `<li>${esc(l)}</li>`).join('')}</ol><p class="small" style="margin:0"><span class="muted">Expected:</span> ${esc(m.expected)}</p></div>`).join('')}
      </section>`;
    }

    function readForm() {
      const o = {};
      root.querySelectorAll('[data-form] [data-k]').forEach((el) => { o[el.dataset.k] = el.value; });
      return o;
    }

    root.oninput = (e) => {
      if (!editing && e.target.closest('[data-form]')) { const f = readForm(); QA.store.update((s) => { s.drafts['tc:' + exId] = f; }); }
    };
    root.onsubmit = (e) => {
      e.preventDefault();
      const form = $('[data-form]', root);
      const f = readForm();
      let bad = 0;
      ['title', 'steps', 'expected'].forEach((k) => {
        const el = $(`[data-k="${k}"]`, form); const wrap = el.closest('.field'); const err = $('.field-error', wrap);
        const empty = !f[k].trim();
        wrap.classList.toggle('invalid', empty); el.setAttribute('aria-invalid', empty); err.hidden = !empty; err.textContent = empty ? 'Required.' : '';
        if (empty) bad++;
      });
      const fe = $('.form-error', form);
      if (bad) { fe.hidden = false; fe.textContent = 'Title, steps and expected result are required.'; $('.field.invalid [data-k]', form).focus(); return; }
      QA.store.update((s) => {
        if (editing) { const c = s.testCases.find((x) => x.id === editing); Object.assign(c, f); }
        else { s.testCases.push(Object.assign({ id: uid('tc'), exercise: exId, created: Date.now() }, f)); delete s.drafts['tc:' + exId]; }
      });
      toast(editing ? 'Test case updated' : 'Test case added');
      editing = null;
      draw();
    };
    root.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'edit') { editing = b.dataset.id; draw(); $('#tc-form-panel', root).scrollIntoView({ block: 'start' }); $('#tc-title', root).focus(); }
      if (act === 'cancel') { editing = null; draw(); }
      if (act === 'del') {
        const c = cases().find((x) => x.id === b.dataset.id);
        if (c && confirm(`Delete “${c.title}”?`)) { QA.store.update((s) => { s.testCases = s.testCases.filter((x) => x.id !== c.id); }); if (editing === c.id) editing = null; draw(); toast('Test case deleted'); }
      }
      if (act === 'check') {
        const result = QA.eval.evaluateTestCases(cases(), ex);
        QA.store.update((s) => {
          const prev = s.workshop[exId] || { attempts: 0, best: 0 };
          s.workshop[exId] = { attempts: prev.attempts + 1, best: Math.max(prev.best, result.pct), last: { pct: result.pct, result, ts: Date.now() } };
        });
        showEval = true; draw();
        const ev = $('#tc-eval', root); if (ev) { ev.focus(); ev.scrollIntoView({ block: 'start' }); }
      }
    };
    draw();
  };
})(window.QA);
