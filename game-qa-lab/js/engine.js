/* Mission / regression step engine, plus shared UI components
   (report form, ticket preview, scale table, feedback blocks). */
(function (QA) {
  'use strict';
  const { esc, $, $$, pct, toast, fbItems, scoreRing, scoreTone, lines } = QA.util;

  /* ======================================================================================
     Shared components
     ====================================================================================== */
  const FIELD_META = {
    title: { label: 'Summary / title', hint: 'One line: what happens, where, and under what condition.', type: 'text' },
    env: { label: 'Build & environment', hint: 'Build number, hardware, display mode, relevant settings.', type: 'text' },
    pre: { label: 'Preconditions', hint: 'The state the game must be in before step 1.', type: 'textarea', rows: 2 },
    steps: { label: 'Steps to reproduce', hint: 'One action per line. Numbering is optional; each line is treated as one step.', type: 'textarea', rows: 6 },
    expected: { label: 'Expected result', hint: 'What should happen, based on the spec or established behavior.', type: 'textarea', rows: 2 },
    actual: { label: 'Actual result', hint: 'What did happen. Observations only, no guesses about the cause.', type: 'textarea', rows: 3 },
    frequency: { label: 'Reproduction frequency', hint: 'Failures out of attempts, e.g. “4/5 attempts”.', type: 'text' },
    severity: { label: 'Severity', hint: 'How bad is it for the player? Based on evidence.', type: 'select', scale: 'severity' },
    priority: { label: 'Priority', hint: 'How soon should it be fixed? Leads often adjust this.', type: 'select', scale: 'priority' },
    observations: { label: 'Additional observations', hint: 'Workarounds, what you did NOT test, evidence. Label any hypothesis as unverified.', type: 'textarea', rows: 3 },
  };

  function fieldHTML(key, value, prefix, required) {
    const m = FIELD_META[key];
    const id = `${prefix}-${key}`;
    const req = required ? '<span class="req" aria-hidden="true">*</span>' : '';
    let input;
    if (m.type === 'select') {
      input = `<select id="${id}" data-field="${key}" ${required ? 'aria-required="true"' : ''}><option value="">Choose…</option>${QA.SCALES[m.scale].map((o) => `<option value="${o.id}" ${value === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (m.type === 'textarea') {
      input = `<textarea id="${id}" data-field="${key}" rows="${m.rows || 3}" aria-describedby="${id}-hint" ${required ? 'aria-required="true"' : ''}>${esc(value || '')}</textarea>`;
    } else {
      input = `<input type="text" id="${id}" data-field="${key}" value="${esc(value || '')}" aria-describedby="${id}-hint" ${required ? 'aria-required="true"' : ''}>`;
    }
    return `<div class="field" data-wrap="${key}"><label for="${id}">${esc(m.label)}${req}</label>${input}<span class="hint" id="${id}-hint">${esc(m.hint)}</span><span class="field-error" hidden></span></div>`;
  }

  function reportForm(fields, values, prefix, requiredSet) {
    values = values || {};
    const req = requiredSet || new Set(fields);
    const pair = (a, b) => `<div class="grid grid-2">${fieldHTML(a, values[a], prefix, req.has(a))}${fieldHTML(b, values[b], prefix, req.has(b))}</div>`;
    let html = '';
    const f = fields.slice();
    while (f.length) {
      const k = f.shift();
      if ((k === 'severity' && f[0] === 'priority')) { html += pair(k, f.shift()); continue; }
      html += fieldHTML(k, values[k], prefix, req.has(k));
    }
    return html;
  }

  function readFields(root) {
    const out = {};
    $$('[data-field]', root).forEach((el) => { out[el.dataset.field] = el.value; });
    return out;
  }

  /* Marks empty required fields. Returns number of problems. */
  function validateFields(root, required) {
    let bad = 0;
    $$('[data-wrap]', root).forEach((w) => {
      const k = w.dataset.wrap;
      const el = $('[data-field]', w);
      const err = $('.field-error', w);
      const empty = required.has(k) && !String(el.value || '').trim();
      w.classList.toggle('invalid', empty);
      el.setAttribute('aria-invalid', empty ? 'true' : 'false');
      err.hidden = !empty;
      err.textContent = empty ? 'Required.' : '';
      if (empty) bad += 1;
    });
    const first = $('.field.invalid [data-field]', root);
    if (first) first.focus();
    return bad;
  }

  function scaleTable(which) {
    return `<div class="table-wrap" style="margin-bottom:14px"><table><thead><tr><th>${which === 'severity' ? 'Severity' : 'Priority'}</th><th>Meaning in this simulator</th></tr></thead><tbody>${QA.SCALES[which].map((s) => `<tr><td><strong>${esc(s.label)}</strong></td><td>${esc(s.desc)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function ticket(model, meta) {
    meta = meta || {};
    const sev = QA.SCALES.severity.find((s) => s.id === model.severity);
    const pri = QA.SCALES.priority.find((s) => s.id === model.priority);
    const steps = Array.isArray(model.steps) ? model.steps : lines(model.steps);
    const sec = (label, body, cls) => body ? `<div class="ticket-section"><h4>${label}</h4>${cls === 'ol' ? body : `<p>${esc(body)}</p>`}</div>` : '';
    return `<article class="ticket" aria-label="Example defect ticket">
      <div class="ticket-head"><div><div class="ticket-key">${esc(meta.key || 'EXAMPLE-1')} · Bug</div><div class="ticket-title">${esc(model.title)}</div></div>
      <span class="badge ${meta.statusTone || 'info'}">${esc(meta.status || 'Open')}</span></div>
      <div class="ticket-body">
        <div class="ticket-main">
          ${sec('Environment', model.env)}
          ${sec('Preconditions', model.pre)}
          ${steps.length ? sec('Steps to reproduce', `<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`, 'ol') : ''}
          ${sec('Expected result', model.expected)}
          ${sec('Actual result', model.actual)}
          ${sec('Reproduction frequency', model.frequency)}
          ${sec('Additional observations', model.observations)}
        </div>
        <aside class="ticket-side"><dl>
          <dt>Severity</dt><dd>${esc(sev ? sev.label : '—')}</dd>
          <dt>Priority</dt><dd>${esc(pri ? pri.label : '—')}</dd>
          <dt>Status</dt><dd>${esc(meta.status || 'Open')}</dd>
          <dt>Assignee</dt><dd>${esc(meta.assignee || 'Unassigned')}</dd>
          <dt>Reporter</dt><dd>${esc(meta.reporter || 'QA tester')}</dd>
          <dt>Labels</dt><dd>${esc(meta.labels || 'example')}</dd>
        </dl></aside>
      </div>
    </article>`;
  }

  function fmtPts(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

  function fbBlock(title, earned, possible, inner, extraClass) {
    return `<div class="fb ${extraClass || ''}"><div class="fb-head"><strong>${esc(title)}</strong><span class="fb-pts">${fmtPts(earned)} / ${fmtPts(possible)}</span></div>${inner}</div>`;
  }

  function reportCats(cats) {
    return cats.map((c) => fbBlock(c.label, c.earned, c.possible, fbItems(c.items))).join('');
  }

  QA.components = { FIELD_META, reportForm, readFields, validateFields, scaleTable, ticket, fbBlock, reportCats, fmtPts };

  /* ======================================================================================
     Engine
     ====================================================================================== */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffled(arr, seed) {
    const a = arr.slice(); let s = hash(seed) || 1;
    for (let i = a.length - 1; i > 0; i--) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const bench = {
    key: (step, c) => step.variables.map((v) => c[v.id]).join('|'),
    label: (step, c) => step.variables.map((v) => (v.options.find((o) => o.id === c[v.id]) || {}).label).join(' · '),
    groups(log) {
      const m = {};
      log.forEach((r) => { const g = m[r.key] || (m[r.key] = { key: r.key, config: r.config, runs: 0, fails: 0 }); g.runs++; if (r.fail) g.fails++; });
      return Object.values(m);
    },
  };

  function helpers(step) {
    return {
      distinct: (log) => bench.groups(log).length,
      maxFailingRuns: (log) => Math.max(0, ...bench.groups(log).filter((g) => g.fails > 0).map((g) => g.runs)),
      valuesTried: (log, id) => new Set(log.map((r) => r.config[id])).size,
      isolated(log) {
        const gs = bench.groups(log);
        const F = gs.filter((g) => g.fails > 0);
        const P = gs.filter((g) => g.fails === 0 && g.runs >= 2);
        return F.some((f) => P.some((p) => step.variables.filter((v) => f.config[v.id] !== p.config[v.id]).length === 1));
      },
    };
  }

  function allMissions() { return QA.MISSIONS.concat(QA.REGRESSIONS); }
  function byId(id) { return allMissions().find((m) => m.id === id); }
  function basePath(m) { return m.kind === 'regression' ? '#/regression/' + m.id : '#/mission/' + m.id; }

  function draftKey(m) { return 'run:' + m.id; }
  function getDraft(m) {
    const st = QA.store.get();
    return st.drafts[draftKey(m)] || null;
  }
  function newDraft(m) {
    const d = { step: 0, answers: {}, logs: {}, benchCfg: {}, started: Date.now() };
    QA.store.update((s) => { s.drafts[draftKey(m)] = d; });
    return d;
  }
  function saveDraft(m, d) { QA.store.update((s) => { s.drafts[draftKey(m)] = d; }); }
  function clearDraft(m) { QA.store.update((s) => { delete s.drafts[draftKey(m)]; }); }

  /* ------------------------------ step rendering ------------------------------ */
  function stepBody(m, step, d) {
    const ans = d.answers[step.id];
    switch (step.type) {
      case 'multi': {
        const opts = shuffled(step.options, m.id + step.id);
        const sel = new Set(ans || []);
        return `<fieldset style="border:0;padding:0;margin:0"><legend class="sr-only">${esc(step.prompt)}</legend><div class="choices">${opts.map((o) => `
          <label class="choice"><input type="checkbox" name="${step.id}" value="${o.id}" ${sel.has(o.id) ? 'checked' : ''}><span class="choice-text">${esc(o.text)}</span></label>`).join('')}</div></fieldset>`;
      }
      case 'single': {
        const opts = step.showScale ? step.options : shuffled(step.options, m.id + step.id);
        return `<fieldset style="border:0;padding:0;margin:0"><legend class="sr-only">${esc(step.prompt)}</legend><div class="choices">${opts.map((o) => `
          <label class="choice"><input type="radio" name="${step.id}" value="${o.id}" ${ans === o.id ? 'checked' : ''}><span class="choice-text">${esc(o.text)}</span></label>`).join('')}</div></fieldset>`;
      }
      case 'classify': {
        const a = ans || {};
        return `<div>${step.items.map((it) => `
          <div class="classify-row"><label for="c-${step.id}-${it.id}">${esc(it.text)}</label>
            <select id="c-${step.id}-${it.id}" data-item="${it.id}"><option value="">Choose…</option>${step.categories.map((c) => `<option ${a[it.id] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`).join('')}</div>`;
      }
      case 'text': {
        return `<div class="field"><label for="t-${step.id}" class="sr-only">${esc(step.title)}</label>
          <textarea id="t-${step.id}" data-text rows="${step.minLines ? 7 : 5}" placeholder="${esc(step.placeholder || '')}">${esc(ans || '')}</textarea>
          <span class="hint"><span data-wc>${QA.util.words(ans).length}</span> words · aim for at least ${step.minWords}</span></div>`;
      }
      case 'report': {
        return `<div data-report>${reportForm(step.fields, ans || {}, 'r-' + m.id)}</div>`;
      }
      case 'frequency': return frequencyBody(m, step, d);
      case 'bench': return benchBody(m, step, d);
      default: return '<p>Unknown step.</p>';
    }
  }

  function frequencyBody(m, step, d) {
    const bstep = m.steps.find((s) => s.id === step.bench);
    const groups = bench.groups(d.logs[bstep.id] || []);
    const a = d.answers[step.id] || {};
    if (!groups.length) return '<div class="empty">Your test log is empty. Go back and run some attempts first.</div>';
    return `<div class="grid grid-2">
      <div class="field"><label for="f-key">Setup that reproduces the defect</label>
        <select id="f-key" data-f="key"><option value="">Choose a setup from your log…</option>${groups.map((g) => `<option value="${esc(g.key)}" ${a.key === g.key ? 'selected' : ''}>${esc(bench.label(bstep, g.config))}</option>`).join('')}</select>
        <span class="hint">Only setups you actually ran are listed.</span></div>
      <div class="field"><span class="label" id="f-lbl">Result</span>
        <div class="row" role="group" aria-labelledby="f-lbl"><input class="inline-num" type="number" min="0" inputmode="numeric" data-f="x" value="${esc(a.x ?? '')}" aria-label="Failures"><span>failed out of</span><input class="inline-num" type="number" min="1" inputmode="numeric" data-f="y" value="${esc(a.y ?? '')}" aria-label="Attempts"><span>attempts</span></div>
        <span class="hint">Count from your log. Don’t round or estimate.</span></div>
    </div>
    <details><summary>Open my test log</summary>${logSummary(bstep, d.logs[bstep.id] || [], false)}</details>`;
  }

  function logSummary(step, log, showFailRate) {
    const gs = bench.groups(log);
    if (!gs.length) return '<div class="empty">No attempts yet.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Setup</th><th>Attempts</th><th>Failures</th></tr></thead><tbody>${gs.map((g) => `<tr><td>${esc(bench.label(step, g.config))}</td><td>${g.runs}</td><td>${g.fails ? `<span class="badge bad">${g.fails}</span>` : '0'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function benchBody(m, step, d) {
    const cfg = d.benchCfg[step.id] || Object.fromEntries(step.variables.map((v) => [v.id, v.options[0].id]));
    d.benchCfg[step.id] = cfg;
    const log = d.logs[step.id] || [];
    const last = log[log.length - 1];
    return `<div class="bench">
      <div class="bench-controls panel soft tight" style="margin:0">
        ${step.variables.map((v) => `<fieldset><legend>${esc(v.label)}</legend><div class="seg">${v.options.map((o) => `
          <label><input type="radio" name="bv-${v.id}" value="${o.id}" data-var="${v.id}" ${cfg[v.id] === o.id ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div></fieldset>`).join('')}
        <div class="row"><button class="btn primary" data-act="run1">Run attempt</button><button class="btn" data-act="run5">Run 5 attempts</button></div>
        <p class="small muted" style="margin:10px 0 0">Attempts so far: <strong>${log.length}</strong>${step.minRuns ? ` · at least ${step.minRuns} needed to continue` : ''}</p>
      </div>
      <div>
        <div class="screen" aria-live="polite">
          <div class="screen-title">${last ? `Attempt #${log.length}: ${esc(bench.label(step, last.config))}` : 'Game output'}</div>
          ${last ? `<p style="margin:0 0 8px"><span class="badge ${last.fail ? 'bad' : 'good'}">${esc(last.summary)}</span></p><dl class="obs">${last.obs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '<p class="muted" style="margin:0">Choose a setup and run an attempt. What you observe appears here.</p>'}
        </div>
        <h4 style="margin-top:14px">Test log by setup</h4>
        ${logSummary(step, log)}
        ${log.length ? `<details style="margin-top:10px"><summary>Every attempt (${log.length})</summary><div class="log"><table><thead><tr><th>#</th><th>Setup</th><th>Result</th></tr></thead><tbody>${log.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(bench.label(step, r.config))}</td><td>${esc(r.summary)}</td></tr>`).reverse().join('')}</tbody></table></div></details>
        <div class="row end" style="margin-top:8px"><button class="btn ghost sm" data-act="clearlog">Clear log</button></div>` : ''}
      </div>
    </div>`;
  }

  function runBench(step, d, times) {
    const cfg = d.benchCfg[step.id];
    const log = d.logs[step.id] || (d.logs[step.id] = []);
    const key = bench.key(step, cfg);
    for (let i = 0; i < times; i++) {
      const n = log.filter((r) => r.key === key).length;
      const out = step.outcome(cfg, n);
      log.push({ key, config: Object.assign({}, cfg), fail: out.fail, summary: out.summary, obs: out.obs });
    }
  }

  function readStep(step, root, d) {
    switch (step.type) {
      case 'multi': return $$(`input[name="${step.id}"]:checked`, root).map((i) => i.value);
      case 'single': { const c = $(`input[name="${step.id}"]:checked`, root); return c ? c.value : null; }
      case 'classify': { const o = {}; $$('[data-item]', root).forEach((s) => { if (s.value) o[s.dataset.item] = s.value; }); return o; }
      case 'text': return ($('[data-text]', root) || {}).value || '';
      case 'report': return readFields(root);
      case 'frequency': {
        const o = {}; $$('[data-f]', root).forEach((el) => { o[el.dataset.f] = el.value; }); return o;
      }
      case 'bench': return null;
      default: return null;
    }
  }

  function validateStep(m, step, ans, d, root) {
    switch (step.type) {
      case 'multi': return ans && ans.length ? null : 'Select at least one option.';
      case 'single': return ans ? null : 'Choose an answer.';
      case 'classify': return Object.keys(ans || {}).length === step.items.length ? null : `Classify all ${step.items.length} statements (${Object.keys(ans || {}).length} done).`;
      case 'text': return QA.util.words(ans).length >= 5 ? null : 'Write your answer (at least a couple of sentences).';
      case 'report': {
        const bad = validateFields(root, new Set(step.fields));
        return bad ? `Fill in all fields (${bad} missing).` : null;
      }
      case 'frequency': {
        if (!ans || !ans.key) return 'Choose the setup from your log.';
        const x = Number(ans.x); const y = Number(ans.y);
        if (ans.x === '' || ans.y === '' || !Number.isFinite(x) || !Number.isFinite(y)) return 'Enter both numbers.';
        if (y < 1 || x < 0 || x > y || !Number.isInteger(x) || !Number.isInteger(y)) return 'Failures must be a whole number between 0 and the number of attempts.';
        return null;
      }
      case 'bench': {
        const n = (d.logs[step.id] || []).length;
        return n >= (step.minRuns || 1) ? null : `Run at least ${step.minRuns} attempts before continuing (${n} so far).`;
      }
      default: return null;
    }
  }

  /* ------------------------------ scoring ------------------------------ */
  const RULES = {
    multi: '+1 per correct option selected, −1 per incorrect option selected (minimum 0), out of the number of correct options.',
    single: 'Best answer earns full points; partly defensible answers earn partial credit.',
    classify: '1 point per correctly classified statement.',
    bench: '1 point per testing goal met, based on your actual test log.',
    frequency: '1 point for choosing the setup that shows the defect, 2 points if your numbers exactly match your log, 1 point for enough attempts.',
    text: '1 point per key element present, −1 per problem found; capped at half if the answer is too short.',
    report: 'Bug-report rubric (categories below), scaled to the step’s points.',
  };

  function targetFreqs(m, d, benchId) {
    const bstep = m.steps.find((s) => s.id === benchId);
    if (!bstep) return [];
    return bench.groups(d.logs[benchId] || []).filter((g) => bstep.isTarget(g.config)).map((g) => ({ key: g.key, x: g.fails, y: g.runs, config: g.config }));
  }

  function scoreStep(m, step, d) {
    const ans = d.answers[step.id];
    const r = { id: step.id, title: step.title, type: step.type, skill: step.skill, rule: RULES[step.type], items: [] };
    switch (step.type) {
      case 'multi': {
        const sel = new Set(ans || []);
        let good = 0; let bad = 0;
        const correct = step.options.filter((o) => o.correct);
        step.options.forEach((o) => {
          const picked = sel.has(o.id);
          if (o.correct && picked) { good++; r.items.push({ kind: 'ok', text: `${o.text}: ${o.why}` }); }
          else if (o.correct && !picked) r.items.push({ kind: 'no', text: `Missed: ${o.text} ${o.why}` });
          else if (!o.correct && picked) { bad++; r.items.push({ kind: 'no', text: `Not needed: ${o.text} ${o.why}` }); }
        });
        r.earned = Math.max(0, good - bad); r.possible = correct.length;
        break;
      }
      case 'single': {
        const w = step.weight || 2;
        const o = step.options.find((x) => x.id === ans);
        const best = step.options.reduce((a, b) => (b.points > a.points ? b : a));
        r.earned = o ? o.points * w : 0; r.possible = w;
        if (o) r.items.push({ kind: o.points === 1 ? 'ok' : o.points > 0 ? 'tip' : 'no', text: `You chose: ${o.text}. ${o.why}` });
        if (!o || o.points < 1) r.items.push({ kind: 'info', text: `Best answer: ${best.text}. ${best.why}` });
        break;
      }
      case 'classify': {
        let e = 0; const a = ans || {};
        step.items.forEach((it) => {
          const ok = a[it.id] === it.answer;
          if (ok) e++;
          r.items.push({ kind: ok ? 'ok' : 'no', text: `“${it.text}”: ${ok ? it.answer : `you said ${a[it.id] || 'nothing'}; it’s ${it.answer}`}. ${it.why}` });
        });
        r.earned = e; r.possible = step.items.length;
        break;
      }
      case 'bench': {
        const log = d.logs[step.id] || [];
        const h = helpers(step);
        let e = 0;
        step.goals.forEach((g) => { const ok = !!g.test(log, h); if (ok) e++; r.items.push({ kind: ok ? 'ok' : 'no', text: `${g.label}. ${g.why}` }); });
        r.items.push({ kind: 'info', text: `You ran ${log.length} attempts across ${h.distinct(log)} setups.` });
        r.earned = e; r.possible = step.goals.length;
        break;
      }
      case 'frequency': {
        const bstep = m.steps.find((s) => s.id === step.bench);
        const a = ans || {};
        const g = bench.groups(d.logs[bstep.id] || []).find((x) => x.key === a.key);
        let e = 0;
        if (g && bstep.isTarget(g.config)) { e += 1; r.items.push({ kind: 'ok', text: `“${bench.label(bstep, g.config)}” is a setup that shows the defect.` }); }
        else if (g) r.items.push({ kind: 'no', text: `“${bench.label(bstep, g.config)}” is not the defect under investigation${g.fails ? ' (its failures are expected behavior per the spec)' : ' (it had no failures)'}.` });
        if (g && Number(a.x) === g.fails && Number(a.y) === g.runs) { e += 2; r.items.push({ kind: 'ok', text: `${a.x}/${a.y} exactly matches your log.` }); }
        else if (g) r.items.push({ kind: 'no', text: `You stated ${a.x}/${a.y}, but your log shows ${g.fails}/${g.runs} for that setup. Report what you recorded, not an estimate.` });
        if (g && g.runs >= step.minAttempts) { e += 1; r.items.push({ kind: 'ok', text: `${g.runs} attempts is enough to state a rate.` }); }
        else if (g) r.items.push({ kind: 'tip', text: `Only ${g.runs} attempts. Run at least ${step.minAttempts} before stating a frequency.` });
        r.earned = e; r.possible = 4;
        break;
      }
      case 'text': {
        const res = QA.eval.evaluateText(ans || '', step);
        r.earned = res.earned; r.possible = res.possible; r.items = res.items;
        break;
      }
      case 'report': {
        const defect = QA.defectById(step.defectRef);
        const tf = targetFreqs(m, d, step.bench);
        const stated = QA.eval.parseFreq((ans || {}).frequency);
        let obs = tf.find((t) => stated && t.x === stated.x && t.y === stated.y) || tf.sort((a, b) => b.y - a.y)[0] || { x: 0, y: 0 };
        const res = QA.eval.evaluateReport(ans || {}, defect, { include: step.fields, observedFreq: { x: obs.x, y: obs.y } });
        const w = step.weight || 10;
        r.earned = Math.round((res.pct / 100) * w * 10) / 10; r.possible = w; r.cats = res.cats; r.reportPct = res.pct;
        r.model = defect.model;
        break;
      }
      default: r.earned = 0; r.possible = 0;
    }
    return r;
  }

  function scoreMission(m, d) {
    const results = m.steps.map((s) => scoreStep(m, s, d));
    const earned = results.reduce((s, r) => s + r.earned, 0);
    const possible = results.reduce((s, r) => s + r.possible, 0);
    const skills = {};
    results.forEach((r) => { const k = r.skill; skills[k] = skills[k] || { e: 0, p: 0 }; skills[k].e += r.earned; skills[k].p += r.possible; });
    return { earned: Math.round(earned * 10) / 10, possible, pct: pct(earned, possible), results, skills, ts: Date.now() };
  }

  /* ------------------------------ views ------------------------------ */
  function specHTML(m) {
    return `<dl class="spec">${m.spec.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  function renderIntro(root, m) {
    const rec = QA.store.get().missions[m.id];
    const d = getDraft(m);
    const back = m.kind === 'regression' ? '<a href="#/regression">Regression Lab</a>' : '<a href="#/missions">Mission Center</a>';
    root.innerHTML = `
      <div class="crumbs">${back} / ${esc(m.title)}</div>
      <div class="page-head"><div class="eyebrow">${m.kind === 'regression' ? 'Fix verification' : 'Mission'} · ${esc(m.game)} (fictional)</div><h1>${esc(m.title)}</h1><p>${esc(m.tagline)}</p></div>
      <div class="grid grid-2">
        <section class="panel"><h2>Assignment</h2>${m.briefing}</section>
        <section class="panel"><h2>Reference</h2>${specHTML(m)}
          <p class="small muted" style="margin-top:12px">${m.steps.length} steps · about ${m.minutes} minutes. Feedback and the model solution are shown after you submit.</p></section>
      </div>
      <div class="row">
        ${d ? `<a class="btn primary" href="${basePath(m)}/run">Resume (step ${d.step + 1} of ${m.steps.length})</a><button class="btn" data-act="restart">Start over</button>` : `<button class="btn primary" data-act="start">${rec ? 'Retry mission' : 'Start mission'}</button>`}
        ${rec ? `<a class="btn" href="${basePath(m)}/result">View last result (${rec.last.pct}%)</a>` : ''}
      </div>`;
    root.onclick = (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const go = () => { newDraft(m); location.hash = basePath(m) + '/run'; };
      if (act.dataset.act === 'start') go();
      if (act.dataset.act === 'restart') QA.util.ask({ title: 'Start over?', message: 'This discards your in-progress answers and test log.', confirmLabel: 'Start over', danger: true }, go);
    };
  }

  function renderRun(root, m) {
    let d = getDraft(m);
    if (!d) d = newDraft(m);
    if (d.step >= m.steps.length) d.step = m.steps.length - 1;

    function draw(focusSel) {
      const step = m.steps[d.step];
      const last = d.step === m.steps.length - 1;
      const back = m.kind === 'regression' ? '<a href="#/regression">Regression Lab</a>' : '<a href="#/missions">Mission Center</a>';
      root.innerHTML = `
        <div class="crumbs">${back} / <a href="${basePath(m)}">${esc(m.title)}</a></div>
        <div class="stepper" aria-hidden="true">${m.steps.map((s, i) => `<span class="${i < d.step ? 'done' : i === d.step ? 'current' : ''}"></span>`).join('')}</div>
        <section class="panel" aria-labelledby="step-title">
          <div class="step-count">Step ${d.step + 1} of ${m.steps.length} · ${esc(QA.SKILLS[step.skill] || step.skill)}</div>
          <h2 id="step-title" tabindex="-1">${esc(step.title)}</h2>
          <p class="text-2">${esc(step.prompt)}</p>
          ${step.showScale ? scaleTable(step.showScale) : ''}
          <div data-body>${stepBody(m, step, d)}</div>
          <div class="form-error" role="alert" hidden style="margin-top:14px"></div>
          <div class="row between" style="margin-top:16px">
            <button class="btn ghost" data-act="prev" ${d.step === 0 ? 'disabled' : ''}>← Back</button>
            <button class="btn primary" data-act="${last ? 'submit' : 'next'}">${last ? 'Submit mission' : 'Next →'}</button>
          </div>
        </section>
        <details><summary>Assignment &amp; reference</summary>${m.briefing}${specHTML(m)}</details>`;
      if (focusSel) { const f = $(focusSel, root); if (f) f.focus(); }
    }

    function capture() {
      const step = m.steps[d.step];
      if (step.type !== 'bench') d.answers[step.id] = readStep(step, root, d);
      saveDraft(m, d);
    }

    function showError(msg) {
      const el = $('.form-error', root);
      el.hidden = !msg; el.textContent = msg || '';
    }

    root.onclick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const step = m.steps[d.step];
      const act = btn.dataset.act;
      if (act === 'run1' || act === 'run5') {
        runBench(step, d, act === 'run5' ? 5 : 1); saveDraft(m, d); draw(`[data-act="${act}"]`); return;
      }
      if (act === 'clearlog') {
        QA.util.ask({ title: 'Clear test log?', message: 'Every attempt in this log will be deleted. Your frequency answer depends on it.', confirmLabel: 'Clear log', danger: true }, () => { d.logs[step.id] = []; saveDraft(m, d); draw(); });
        return;
      }
      capture();
      if (act === 'prev') { d.step = Math.max(0, d.step - 1); saveDraft(m, d); draw('#step-title'); window.scrollTo(0, 0); return; }
      const err = validateStep(m, step, d.answers[step.id], d, root);
      if (err) { showError(err); return; }
      if (act === 'next') { d.step++; saveDraft(m, d); draw('#step-title'); window.scrollTo(0, 0); return; }
      if (act === 'submit') {
        const res = scoreMission(m, d);
        QA.store.update((s) => {
          const prev = s.missions[m.id] || { attempts: 0, best: 0 };
          s.missions[m.id] = { attempts: prev.attempts + 1, best: Math.max(prev.best, res.pct), first: prev.first || res.ts, last: res };
          delete s.drafts[draftKey(m)];
        });
        location.hash = basePath(m) + '/result';
      }
    };
    root.onchange = (e) => {
      const v = e.target.closest('[data-var]');
      if (v) { d.benchCfg[m.steps[d.step].id][v.dataset.var] = v.value; saveDraft(m, d); return; }
      capture();
    };
    root.oninput = (e) => {
      if (e.target.matches('[data-text]')) { const wc = $('[data-wc]', root); if (wc) wc.textContent = QA.util.words(e.target.value).length; }
      if (e.target.matches('textarea, input[type=text], input[type=number]')) capture();
    };
    draw();
  }

  function renderResult(root, m) {
    const rec = QA.store.get().missions[m.id];
    if (!rec) { location.hash = basePath(m); return; }
    const res = rec.last;
    const tone = scoreTone(res.pct);
    const defectModel = (res.results.find((r) => r.model) || {}).model;
    const back = m.kind === 'regression' ? '<a href="#/regression">Regression Lab</a>' : '<a href="#/missions">Mission Center</a>';
    root.innerHTML = `
      <div class="crumbs">${back} / <a href="${basePath(m)}">${esc(m.title)}</a> / Result</div>
      <section class="panel"><div class="score-hero">${scoreRing(res.pct, 'Mission score')}
        <div><div class="eyebrow">Attempt ${rec.attempts} · ${QA.util.fmtDate(res.ts)}</div><h1 style="margin-bottom:6px">${esc(m.title)}</h1>
        <p class="text-2" style="margin:0">${QA.components.fmtPts(res.earned)} of ${res.possible} points. <span class="badge ${tone}">${res.pct >= 80 ? 'Strong' : res.pct >= 55 ? 'Developing' : 'Needs work'}</span> · Best so far: ${rec.best}%</p></div></div>
        <div class="row" style="margin-top:16px"><button class="btn primary" data-act="retry">Retry mission</button><a class="btn" href="#/">Back to dashboard</a><a class="btn ghost" href="${m.kind === 'regression' ? '#/regression' : '#/missions'}">All ${m.kind === 'regression' ? 'scenarios' : 'missions'}</a></div>
      </section>

      <section class="panel"><h2>How your score was calculated</h2>
        <div class="table-wrap"><table><thead><tr><th>Step</th><th>Points</th><th>Scoring rule</th></tr></thead><tbody>
        ${res.results.map((r) => `<tr><td>${esc(r.title)}</td><td class="mono">${QA.components.fmtPts(r.earned)} / ${r.possible}</td><td class="small text-2">${esc(r.rule)}</td></tr>`).join('')}
        <tr><td><strong>Total</strong></td><td class="mono"><strong>${QA.components.fmtPts(res.earned)} / ${res.possible}</strong></td><td class="small text-2">Percentage = total earned ÷ total possible.</td></tr>
        </tbody></table></div></section>

      <section class="panel"><h2>Feedback on each decision</h2>
        ${res.results.map((r) => QA.components.fbBlock(r.title, r.earned, r.possible, r.cats ? `<p class="small muted">Report quality ${r.reportPct}% → ${QA.components.fmtPts(r.earned)} of ${r.possible} points.</p>${QA.components.reportCats(r.cats)}` : fbItems(r.items))).join('')}
      </section>

      <section class="panel"><h2>Model investigation</h2><div class="text-2">${m.modelInvestigation}</div></section>
      ${defectModel ? `<section class="panel"><h2>Example defect report</h2><p class="small muted">One good way to write it. Wording can differ; the facts and structure are what matter.</p>${ticket(defectModel, { key: m.id.toUpperCase() + '-EX', status: 'Open', reporter: 'You (example)', labels: 'example, ' + m.game })}</section>` : ''}
      <div class="row"><button class="btn primary" data-act="retry">Retry mission</button><a class="btn" href="#/">Back to dashboard</a></div>`;
    root.onclick = (e) => {
      if (e.target.closest('[data-act="retry"]')) { newDraft(m); location.hash = basePath(m) + '/run'; }
    };
  }

  QA.engine = { byId, allMissions, renderIntro, renderRun, renderResult, scoreMission, basePath, getDraft, bench, helpers };
})(window.QA);
