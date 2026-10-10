(function (QA) {
  'use strict';
  const { esc, $, scoreRing, scoreTone, fbItems, words, fmtDate } = QA.util;

  const RUBRIC = [
    ['Relevance', 'How many of the key points for this question your answer touches.'],
    ['Clarity', 'Length suited to a spoken answer (about 40–260 words), several sentences, manageable sentence length.'],
    ['Specific evidence', 'Concrete examples, numbers, and named QA artifacts or your own actions.'],
    ['Logical process', 'Process questions: clear order of steps and reasons. Behavioral questions: Situation, Task, Action, Result present.'],
    ['Honesty & professionalism', 'Starts at 4. Points come off for overclaiming (“perfect”, “never make mistakes”) and blaming language.'],
  ];

  QA.views.interview = function (root) {
    const st = QA.store.get();
    const topics = QA.INTERVIEW_TOPICS;
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Interview</div><h1>Mock Interview</h1>
        <p>Type your answer as you would say it, get rubric feedback, compare with an example, then revise and resubmit. Practice out loud too: reading your typed answer aloud is good rehearsal.</p></div>
      <div class="callout warn"><p><strong>About the feedback:</strong> answers are scored by fixed local rules (keyword coverage, structure and wording checks). No AI reviews your text. It can’t judge truthfulness or tone the way a person can, so use it as a training aid, not a prediction of any hiring decision.</p></div>
      <div class="grid grid-2" style="margin-bottom:16px">
        <section class="panel"><h3>Scoring rubric (each 0–4, total 20)</h3>
          <div class="table-wrap"><table class="rubric-table"><tbody>${RUBRIC.map(([a, b]) => `<tr><td>${a}</td><td class="small text-2">${b}</td></tr>`).join('')}</tbody></table></div></section>
        <section class="panel"><h3>STAR for behavioral questions</h3>
          <ul class="text-2 small"><li><strong>Situation</strong>: where and when, in one sentence.</li><li><strong>Task</strong>: what you needed to do.</li><li><strong>Action</strong>: what <em>you</em> did, step by step. Spend most of your time here.</li><li><strong>Result</strong>: what happened, ideally measurable, and what you learned.</li></ul>
          <p class="small text-2" style="margin:0">Use genuine experiences from work, school, personal projects or gaming. You don’t need professional QA experience, and you shouldn’t invent it. Interviewers value honest, specific examples.</p></section>
      </div>
      ${Object.keys(topics).map((t) => {
        const qs = QA.INTERVIEW.filter((q) => q.topic === t);
        return `<section class="panel tight"><h3 style="margin:4px 0 8px">${esc(topics[t])}</h3><div class="q-list">${qs.map((q) => {
          const a = (st.interview[q.id] || {}).attempts || [];
          const best = a.length ? Math.max(...a.map((x) => x.pct)) : null;
          return `<a class="q-item" href="#/interview/${q.id}"><span class="q-text">${esc(q.q)}</span><span class="row" style="flex:none">${q.type === 'behavioral' ? '<span class="badge info">STAR</span>' : ''}${best != null ? `<span class="badge ${scoreTone(best)}">${best}%</span>` : '<span class="badge">New</span>'}</span></a>`;
        }).join('')}</div></section>`;
      }).join('')}`;
  };

  QA.views.interviewQuestion = function (root, id) {
    const q = QA.interviewById(id);
    if (!q) { root.innerHTML = '<div class="empty">Question not found. <a href="#/interview">Back to questions</a></div>'; return; }
    const idx = QA.INTERVIEW.indexOf(q);
    const prev = QA.INTERVIEW[idx - 1];
    const next = QA.INTERVIEW[idx + 1];
    const dkey = 'iv:' + id;

    function draw(justSubmitted) {
      const st = QA.store.get();
      const attempts = (st.interview[id] || {}).attempts || [];
      const last = attempts[attempts.length - 1];
      const text = st.drafts[dkey] != null ? st.drafts[dkey] : (last ? last.text : '');
      const r = last ? last.result : null;
      root.innerHTML = `
        <div class="crumbs"><a href="#/interview">Mock Interview</a> / ${esc(QA.INTERVIEW_TOPICS[q.topic])}</div>
        <div class="page-head"><div class="eyebrow">Question ${idx + 1} of ${QA.INTERVIEW.length} · ${q.type === 'behavioral' ? 'Behavioral (use STAR)' : q.type === 'motivation' ? 'Motivation' : 'Process / situational'}</div>
          <h1>“${esc(q.q)}”</h1></div>
        <section class="panel">
          <form data-form novalidate>
            <div class="field"><label for="iv-answer">Your answer</label>
              <textarea id="iv-answer" rows="9" placeholder="${q.type === 'behavioral' ? 'Situation… Task… Action… Result…' : 'Explain your approach step by step…'}">${esc(text)}</textarea>
              <span class="hint"><span data-wc>${words(text).length}</span> words · a spoken answer of 1–2 minutes is roughly 120–250 words</span></div>
            ${q.tip ? `<details><summary>Hint</summary><p class="small text-2" style="margin:0">${esc(q.tip)}</p></details>` : ''}
            <div class="form-error" role="alert" hidden></div>
            <div class="row"><button class="btn primary" type="submit">${attempts.length ? 'Resubmit revised answer' : 'Submit answer'}</button>
              ${attempts.length ? '<span class="small muted">Edit your answer above, then resubmit to compare.</span>' : ''}</div>
          </form>
        </section>
        ${r ? feedbackHTML(r, attempts, justSubmitted) : ''}
        <div class="row between">
          ${prev ? `<a class="btn ghost" href="#/interview/${prev.id}">← Previous question</a>` : '<span></span>'}
          ${next ? `<a class="btn" href="#/interview/${next.id}">Next question →</a>` : '<a class="btn" href="#/review">Go to Readiness Review →</a>'}
        </div>`;
    }

    function feedbackHTML(r, attempts) {
      const prevA = attempts.length > 1 ? attempts[attempts.length - 2] : null;
      const delta = prevA ? attempts[attempts.length - 1].pct - prevA.pct : null;
      return `
        <section class="panel" id="iv-fb" tabindex="-1">
          <div class="score-hero">${scoreRing(r.pct, 'Answer score')}<div>
            <h2 style="margin:0 0 4px">${r.earned} / 20 on the rubric</h2>
            <p class="text-2" style="margin:0">${delta != null ? `<span class="badge ${delta > 0 ? 'good' : delta < 0 ? 'bad' : ''}">${delta > 0 ? '+' : ''}${delta} points vs. previous attempt</span> ` : ''}Attempt ${attempts.length}. Automated rule-based feedback; a training aid only.</p></div></div>
          <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Criterion</th><th>Score</th><th>Why</th></tr></thead><tbody>
            ${r.crit.map((c) => `<tr><td>${esc(c.label)}</td><td class="mono">${c.score} / 4</td><td class="small text-2">${esc(c.why)}</td></tr>`).join('')}
          </tbody></table></div>
        </section>
        <div class="grid grid-2">
          <section class="panel"><h3>What was strong</h3>${r.matched.length || r.crit.some((c) => c.score >= 3)
            ? fbItems(r.crit.filter((c) => c.score >= 3).map((c) => ({ kind: 'ok', text: `${c.label}: ${c.why}` })).concat(r.matched.map((m) => ({ kind: 'ok', text: 'Covered: ' + m.label }))))
            : '<p class="text-2 small">Nothing scored highly yet. Start with the missing points on the right.</p>'}</section>
          <section class="panel"><h3>What was missing</h3>${r.missing.length ? fbItems(r.missing.map((m) => ({ kind: 'no', text: m.label }))) : '<p class="text-2 small">You touched every key point.</p>'}
            ${r.star ? `<p class="small" style="margin-top:10px">STAR check: ${['S', 'T', 'A', 'R'].map((k) => `<span class="badge ${r.star[k] ? 'good' : 'bad'}">${k}</span>`).join(' ')}</p>` : ''}
            ${r.crit.filter((c) => c.score <= 2).map((c) => `<p class="small text-2" style="margin:6px 0 0">→ ${esc(c.label)}: ${esc(c.why)}</p>`).join('')}</section>
        </div>
        <section class="panel"><h3>Suggested structure</h3><p class="text-2">${esc(q.structure)}</p>
          <h3>Example answer</h3><p class="small muted">Shows the reasoning a strong answer uses. Don’t memorize it word for word, and replace any personal details with your own true experiences.</p>
          <blockquote class="spec" style="margin:0">${esc(q.example)}</blockquote></section>
        <section class="panel"><h3>Your attempts</h3><div class="table-wrap history"><table><thead><tr><th>#</th><th>When</th><th>Score</th><th>Words</th></tr></thead><tbody>
          ${attempts.map((a, i) => `<tr><td>${i + 1}</td><td>${fmtDate(a.ts)}</td><td>${a.pct}%</td><td>${a.result.wc}</td></tr>`).reverse().join('')}</tbody></table></div>
          ${attempts.length > 1 ? `<details style="margin-top:10px"><summary>Previous answer text</summary><p class="small pre text-2" style="margin:0">${esc(attempts[attempts.length - 2].text)}</p></details>` : ''}</section>`;
    }

    root.oninput = (e) => {
      if (e.target.id !== 'iv-answer') return;
      $('[data-wc]', root).textContent = words(e.target.value).length;
      QA.store.update((s) => { s.drafts[dkey] = e.target.value; });
    };
    root.onsubmit = (e) => {
      e.preventDefault();
      const ta = $('#iv-answer', root);
      const text = ta.value.trim();
      const err = $('.form-error', root);
      if (words(text).length < 8) { err.hidden = false; err.textContent = 'Write at least a couple of sentences before submitting. Empty or one-line answers can’t be evaluated.'; ta.focus(); return; }
      const result = QA.eval.evaluateAnswer(text, q);
      QA.store.update((s) => {
        const rec = s.interview[id] || { attempts: [] };
        rec.attempts.push({ text, pct: result.pct, result, ts: Date.now() });
        s.interview[id] = rec;
        delete s.drafts[dkey];
      });
      draw(true);
      const fb = $('#iv-fb', root); if (fb) { fb.focus(); fb.scrollIntoView({ block: 'start' }); }
    };
    draw();
  };
})(window.QA);
