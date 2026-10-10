(function (QA) {
  'use strict';
  const { esc, $, $$, scoreRing } = QA.util;

  const HOTSPOTS = {
    key: { title: 'Issue key', body: 'A unique ID (project prefix + number). Use it to reference the ticket in comments, commits and conversations: “see PIP-2214”.' },
    summary: { title: 'Summary', body: 'The one-line title people scan in lists. It should say what happens, where, and under what condition, so someone can recognize the bug without opening it.' },
    status: { title: 'Status', body: 'Where the ticket is in its workflow: Open → In Progress → Resolved → Closed (or Reopened). Only change it according to your team’s process.' },
    env: { title: 'Environment / build', body: 'The build number, hardware and settings you tested on. Developers need this to reproduce the bug, and testers need it to verify the fix on the right build.' },
    steps: { title: 'Steps to reproduce', body: 'Numbered actions from a known starting state. The test: could a teammate who has never seen the bug follow them alone?' },
    expact: { title: 'Expected vs. actual', body: 'Expected is what should happen, from a spec or established behavior. Actual is what you observed. Keeping them separate makes the defect obvious and avoids opinion.' },
    freq: { title: 'Reproducibility', body: 'How often it happens, as a count: “4/5 attempts”. Developers use this to judge how hard it will be to reproduce and verify.' },
    severity: { title: 'Severity', body: 'Impact on the player or product. Proposed by QA from evidence: crash, data loss, blocked progress, or cosmetic.' },
    priority: { title: 'Priority', body: 'How soon it should be fixed. Usually set or adjusted by a lead or producer, based on schedule and how many players are affected.' },
    assignee: { title: 'Assignee', body: 'Who currently owns the next action. Usually a developer while it’s being fixed, then QA again for verification.' },
    attach: { title: 'Attachments / evidence', body: 'Video clips, screenshots, logs and crash dumps. A 20-second clip often answers questions the text can’t.' },
    comments: { title: 'Comments', body: 'The conversation history: questions, extra findings, verification results. Keep it factual and specific, and reference builds and attempt counts.' },
  };

  const STATES = [
    { id: 'open', label: 'Open', who: 'QA files it', body: 'A tester reports a new defect with steps, evidence and severity. A lead may triage it: confirm, set priority, assign.' },
    { id: 'progress', label: 'In Progress', who: 'Developer', body: 'A developer is investigating or fixing it. QA may be asked for more detail. Answer quickly and precisely.' },
    { id: 'resolved', label: 'Resolved', who: 'Developer', body: 'The developer believes it’s fixed (and names the fix build), or marks it as “won’t fix”, “duplicate” or “works as designed”, with a reason.' },
    { id: 'verify', label: 'Verification', who: 'QA', body: 'QA retests on the fix build: original steps, enough attempts, and nearby areas. Results go in a comment with evidence.' },
    { id: 'closed', label: 'Closed', who: 'QA / lead', body: 'Verified fixed (or the resolution was accepted). The record stays for future reference and regression testing.' },
    { id: 'reopened', label: 'Reopened', who: 'QA', body: 'The original problem still happens on the fix build. Reopen it with build, steps, attempt counts and evidence. New, different problems usually get their own ticket.' },
  ];

  QA.views.tracker = function (root) {
    const st = QA.store.get();
    const prevQuiz = st.lessons.tracker && st.lessons.tracker.quiz;
    let quizResult = null;
    let active = 'summary';
    let activeState = 'open';

    function hs(id, label) { return `<button class="hotspot" data-hs="${id}" aria-pressed="${active === id}">${label}</button>`; }

    function draw() {
      const H = HOTSPOTS[active];
      const S = STATES.find((s) => s.id === activeState);
      root.innerHTML = `
        <div class="page-head"><div class="eyebrow">Learn</div><h1>Bug Tracker Basics</h1>
          <p>Studios track defects in issue trackers such as Jira. Every bug becomes a <strong>ticket</strong> (also called an issue) that moves through a workflow until it’s fixed and verified. Below is a <em>fictional, simplified</em> ticket to explore. Real trackers look different and every team configures fields and statuses its own way.</p></div>

        <section class="panel">
          <div class="panel-head"><h2>Anatomy of a ticket</h2><span class="small muted">Select any underlined field</span></div>
          <div class="grid grid-2" style="align-items:start">
            <article class="ticket">
              <div class="ticket-head"><div><div class="ticket-key">${hs('key', 'PIP-2214')} · Bug</div><div class="ticket-title">${hs('summary', 'Character falls through descending gear platform after full jump (3-2)')}</div></div><span class="badge info">${hs('status', 'Open')}</span></div>
              <div class="ticket-main" style="border-right:0">
                <div class="ticket-section"><h4>${hs('env', 'Environment')}</h4><p>Build 0.9.412 · Dev kit, TV mode</p></div>
                <div class="ticket-section"><h4>${hs('steps', 'Steps to reproduce')}</h4><ol><li>Load 3-2 from checkpoint B.</li><li>Wait until the gear platform moves down.</li><li>Full jump onto it.</li></ol></div>
                <div class="ticket-section"><h4>${hs('expact', 'Expected / Actual')}</h4><p>Expected: character stays on platform.\nActual: drops through ~0.2 s after landing; loses 1 life.</p></div>
                <div class="ticket-section"><h4>${hs('freq', 'Reproducibility')}</h4><p>4/5 attempts</p></div>
                <div class="row small"><span>${hs('severity', 'Severity: S2')}</span><span>${hs('priority', 'Priority: P2')}</span><span>${hs('assignee', 'Assignee: Unassigned')}</span></div>
                <div class="row small" style="margin-top:8px"><span>${hs('attach', '📎 platform_fall.mp4')}</span><span>${hs('comments', '💬 2 comments')}</span></div>
              </div>
            </article>
            <div class="callout" aria-live="polite" style="margin:0"><h3 style="margin-bottom:6px">${esc(H.title)}</h3><p>${esc(H.body)}</p></div>
          </div>
        </section>

        <section class="panel">
          <h2>Ticket lifecycle</h2>
          <div class="flow" role="group" aria-label="Ticket statuses">${STATES.map((s, i) => `${i && s.id !== 'reopened' ? '<span class="arrow" aria-hidden="true">→</span>' : ''}${s.id === 'reopened' ? '<span class="arrow" aria-hidden="true">or</span>' : ''}<button class="btn sm ${s.id === activeState ? 'primary' : ''}" data-state="${s.id}" aria-pressed="${s.id === activeState}">${s.label}</button>`).join('')}</div>
          <div class="callout" style="margin-top:14px" aria-live="polite"><p><strong>${esc(S.label)}</strong> · <span class="muted">${esc(S.who)}</span></p><p>${esc(S.body)}</p></div>
        </section>

        <div class="grid grid-2">
          <section class="panel"><h2>Severity vs. priority</h2>
            <div class="table-wrap"><table><thead><tr><th>Example</th><th>Severity</th><th>Priority</th></tr></thead><tbody>
              <tr><td>Crash when starting a new game</td><td>High</td><td>High</td></tr>
              <tr><td>Typo in the game’s name on the title screen</td><td>Low</td><td>High</td></tr>
              <tr><td>Crash in a debug menu players can’t reach</td><td>High</td><td>Low</td></tr>
              <tr><td>Slightly misaligned icon in a rarely used menu</td><td>Low</td><td>Low</td></tr>
            </tbody></table></div></section>
          <section class="panel"><h2>Comments: objective vs. not</h2>
            <div class="fb"><div class="fb-head"><strong>Helpful</strong><span class="badge good">Objective</span></div><p class="small" style="margin:0">“Retested on 0.9.430: original steps pass 10/10 (video attached). Sideways platform in 2-4 now jitters 3/5; filed PIP-2241 and linked it.”</p></div>
            <div class="fb"><div class="fb-head"><strong>Not helpful</strong><span class="badge bad">Vague / emotional</span></div><p class="small" style="margin:0">“Still broken?? Did anyone even test this?”</p></div>
            <p class="small muted" style="margin:0">Name the build, give numbers, attach evidence, say what’s next. Never make it personal.</p></section>
        </div>

        <section class="panel" id="quiz">
          <div class="panel-head"><h2>Check your understanding</h2>${prevQuiz ? `<span class="badge ${QA.util.scoreTone(prevQuiz.pct)}">Last score ${prevQuiz.pct}%</span>` : ''}</div>
          <form data-quiz novalidate>
            ${QA.TRACKER_QUIZ.map((q, i) => {
              const r = quizResult && quizResult.items[q.id];
              return `<fieldset class="fb" style="margin-bottom:12px"><legend style="font-weight:600;padding:0 4px">${i + 1}. ${esc(q.q)}</legend>
                <div class="choices">${q.options.map((o) => `<label class="choice"><input type="radio" name="${q.id}" value="${o.id}" ${r && r.picked === o.id ? 'checked' : ''}><span class="choice-text">${esc(o.text)}</span></label>`).join('')}</div>
                ${r ? `<p class="small" style="margin:8px 0 0"><span class="badge ${r.ok ? 'good' : 'bad'}">${r.ok ? 'Correct' : 'Not quite'}</span> ${esc(q.why)}</p>` : ''}</fieldset>`;
            }).join('')}
            <div class="form-error" role="alert" hidden></div>
            ${quizResult ? `<div class="score-hero" style="margin-bottom:12px">${scoreRing(quizResult.pct, 'Quiz score')}<p class="text-2" style="margin:0">${quizResult.correct} of ${QA.TRACKER_QUIZ.length} correct.</p></div>` : ''}
            <div class="row"><button class="btn primary" type="submit">${quizResult ? 'Resubmit answers' : 'Submit quiz'}</button>${quizResult ? '<button type="button" class="btn ghost" data-act="reset-quiz">Clear answers</button>' : ''}</div>
          </form>
        </section>

        <p class="small muted">This lesson uses a fictional tracker so the ideas stay tool-independent. Using this simulator is practice with bug-tracking concepts, not experience with Jira itself. In an interview, describe it that way.</p>`;
    }

    root.onclick = (e) => {
      const h = e.target.closest('[data-hs]');
      if (h) { e.preventDefault(); active = h.dataset.hs; draw(); const b = $(`[data-hs="${active}"]`, root); if (b) b.focus(); return; }
      const s = e.target.closest('[data-state]');
      if (s) { activeState = s.dataset.state; draw(); const b = $(`[data-state="${activeState}"]`, root); if (b) b.focus(); return; }
      if (e.target.closest('[data-act="reset-quiz"]')) { quizResult = null; draw(); $('#quiz', root).scrollIntoView({ block: 'start' }); }
    };
    root.onsubmit = (e) => {
      e.preventDefault();
      const form = $('[data-quiz]', root);
      const answers = {};
      QA.TRACKER_QUIZ.forEach((q) => { const c = $(`input[name="${q.id}"]:checked`, form); if (c) answers[q.id] = c.value; });
      const missing = QA.TRACKER_QUIZ.length - Object.keys(answers).length;
      const err = $('.form-error', form);
      if (missing) { err.hidden = false; err.textContent = `Answer all questions (${missing} left).`; return; }
      const items = {}; let correct = 0;
      QA.TRACKER_QUIZ.forEach((q) => { const ok = q.options.find((o) => o.correct).id === answers[q.id]; if (ok) correct++; items[q.id] = { picked: answers[q.id], ok }; });
      const pctVal = Math.round((correct / QA.TRACKER_QUIZ.length) * 100);
      quizResult = { items, correct, pct: pctVal };
      QA.store.update((s) => { s.lessons.tracker = { quiz: { pct: pctVal, answers, ts: Date.now() } }; });
      draw();
      $('#quiz', root).scrollIntoView({ block: 'start' });
    };
    draw();
  };

  QA.views.glossary = function (root) {
    function draw(filter) {
      const f = (filter || '').toLowerCase();
      const list = QA.GLOSSARY.filter((g) => !f || g.term.toLowerCase().includes(f) || g.def.toLowerCase().includes(f));
      $('[data-list]', root).innerHTML = list.length
        ? `<dl style="margin:0">${list.map((g) => `<div class="term"><dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd></div>`).join('')}</dl>`
        : '<div class="empty">No terms match that search.</div>';
    }
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Learn</div><h1>QA Glossary</h1><p>Plain-English definitions of the vocabulary you’ll hear in a QA team and in interviews.</p></div>
      <div class="field" style="max-width:420px"><label for="gl-search">Search terms</label><input id="gl-search" type="text" placeholder="e.g. regression"></div>
      <section class="panel" data-list></section>`;
    root.oninput = (e) => { if (e.target.id === 'gl-search') draw(e.target.value); };
    draw('');
  };
})(window.QA);
