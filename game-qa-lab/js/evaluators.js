/* Local, rule-based evaluators. No AI service is involved: every score is
   produced by the transparent rules below, and each rule explains itself
   in the feedback it returns. */
(function (QA) {
  'use strict';
  const { words, lines, matchGroups } = QA.util;

  const SPECULATION = [
    'probably', 'i think', 'i guess', 'i bet', 'maybe', 'must be', 'the code', 'code is', 'memory leak',
    'out of memory', 'obviously', 'whoever', 'nobody', 'imo', 'for everyone', 'every item', 'all moving',
    'huge problem', 'will hate', 'i\'d guess', 'pretty sure', 'is a mess',
  ];
  const HEDGE_LABELS = ['hypothesis', 'unverified', 'not verified', 'untested', 'not tested', 'possibly', 'unconfirmed', 'may be related', 'didn\'t try', 'did not test'];
  const VAGUE_STEPS = ['somehow', 'etc', 'some point', 'a while', 'mess with', 'stuff', 'whatever', 'and so on', 'a few times', 'random', 'do the thing'];
  const VAGUE_TITLE = ['broken', 'doesn\'t work', 'does not work', 'weird', 'bug found', 'issue found', 'problem', 'not working'];

  function hits(text, list) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    return list.filter((w) => t.includes(w));
  }

  function parseFreq(text) {
    const m = String(text || '').toLowerCase().match(/(\d+)\s*(?:\/|out of|of|in)\s*(\d+)/);
    return m ? { x: +m[1], y: +m[2] } : null;
  }

  function coverage(text, groups) {
    const res = matchGroups(text, (groups || []).map((g) => ({ any: g })));
    const hit = res.filter((r) => r.hit).length;
    return { ratio: groups && groups.length ? hit / groups.length : 1, hit, total: (groups || []).length };
  }

  /* -------------------------------------------------------------------------------------
     Bug report evaluator.
     fields: { title, env, pre, steps, expected, actual, frequency, severity, priority, observations }
     defect: entry from QA.DEFECTS
     opts.include: which fields are part of this exercise (default: all)
     opts.observedFreq: { x, y } override (missions use the trainee's own test log)
     ------------------------------------------------------------------------------------- */
  const REPORT_FIELDS = ['title', 'env', 'pre', 'steps', 'expected', 'actual', 'frequency', 'severity', 'priority', 'observations'];

  function evaluateReport(fields, defect, opts) {
    opts = opts || {};
    const inc = new Set(opts.include || REPORT_FIELDS);
    const f = {};
    REPORT_FIELDS.forEach((k) => { f[k] = String(fields[k] || '').trim(); });
    const kw = defect.kw;
    const cats = [];

    if (inc.has('title')) {
      const items = []; let e = 0;
      const len = f.title.length;
      if (len >= 20 && len <= 150) { e += 3; items.push({ kind: 'ok', text: 'Length is in a useful range (20–150 characters).' }); }
      else if (len > 0) { e += 1; items.push({ kind: 'tip', text: len < 20 ? 'Too short to identify the problem. Say what happens, where, and under what condition.' : 'Very long. Keep the summary to one line and put detail in the steps.' }); }
      const c = coverage(f.title, kw.title);
      e += Math.round(c.ratio * 5);
      items.push({ kind: c.ratio >= 0.75 ? 'ok' : 'tip', text: `Covers ${c.hit} of ${c.total} key elements (what happens, where, trigger).` });
      const v = hits(f.title, VAGUE_TITLE);
      if (!v.length && len) { e += 2; items.push({ kind: 'ok', text: 'No vague words like “broken” or “weird”.' }); }
      else if (v.length) items.push({ kind: 'no', text: `Vague wording (“${v[0]}”). Describe the observed behavior instead.` });
      cats.push({ id: 'title', label: 'Summary / title', earned: e, possible: 10, items });
    }

    if (inc.has('env')) {
      const items = []; let e = 0;
      if (hits(f.env, kw.env.build).length) { e += 6; items.push({ kind: 'ok', text: `Build ${defect.build} identified.` }); }
      else items.push({ kind: 'no', text: `Build number missing or wrong. The notes say ${defect.build}. Results depend on the build.` });
      if (hits(f.env, kw.env.platform).length) { e += 4; items.push({ kind: 'ok', text: 'Hardware / mode / configuration noted.' }); }
      else items.push({ kind: 'tip', text: `Add the hardware and mode (${defect.platform}).` });
      cats.push({ id: 'env', label: 'Build & environment', earned: e, possible: 10, items });
    }

    if (inc.has('pre')) {
      const items = []; let e = 0;
      if (f.pre.length >= 10) { e += 3; items.push({ kind: 'ok', text: 'States a starting point.' }); }
      else items.push({ kind: 'no', text: 'Preconditions missing. What state must the game be in before step 1?' });
      const c = coverage(f.pre, kw.pre);
      e += Math.round(c.ratio * 5);
      if (c.ratio < 1) items.push({ kind: 'tip', text: `Covers ${c.hit} of ${c.total} important starting conditions from the notes.` });
      cats.push({ id: 'pre', label: 'Preconditions', earned: e, possible: 8, items });
    }

    if (inc.has('steps')) {
      const items = []; let e = 0;
      const ls = lines(f.steps);
      if (ls.length >= 3) { e += 6; items.push({ kind: 'ok', text: `${ls.length} separate steps.` }); }
      else if (ls.length === 2) { e += 3; items.push({ kind: 'tip', text: 'Only 2 steps. Break the actions down so each line is one action.' }); }
      else items.push({ kind: 'no', text: 'Write the steps on separate lines, one action each.' });
      const longOnes = ls.filter((l) => l.length > 180);
      if (ls.length >= 2 && !longOnes.length) { e += 4; items.push({ kind: 'ok', text: 'Each step is short enough to follow.' }); }
      else if (longOnes.length) { e += 1; items.push({ kind: 'tip', text: 'Some steps are long. Split compound steps (“do X and then Y and also Z”).' }); }
      const c = coverage(f.steps, kw.steps);
      e += Math.round(c.ratio * 10);
      items.push({ kind: c.ratio >= 0.75 ? 'ok' : 'tip', text: `Includes ${c.hit} of ${c.total} actions another tester needs (location, setup, trigger, what to look at).` });
      const v = hits(f.steps, VAGUE_STEPS);
      if (!v.length) { e += 4; if (ls.length) items.push({ kind: 'ok', text: 'No vague wording.' }); }
      else { e += Math.max(0, 4 - 2 * v.length); items.push({ kind: 'no', text: `Vague wording (“${v.join('”, “')}”) can’t be repeated exactly.` }); }
      cats.push({ id: 'steps', label: 'Steps to reproduce', earned: Math.min(e, 24), possible: 24, items });
    }

    if (inc.has('expected') || inc.has('actual')) {
      const items = []; let e = 0;
      const ce = coverage(f.expected, kw.expected);
      const ca = coverage(f.actual, kw.actual);
      if (f.expected) { e += Math.round(ce.ratio * 6); items.push({ kind: ce.ratio ? 'ok' : 'tip', text: ce.ratio ? 'Expected result describes the intended behavior.' : 'Expected result doesn’t clearly state the intended behavior. Cite the spec or established behavior.' }); }
      else items.push({ kind: 'no', text: 'Expected result missing.' });
      if (f.actual) { e += Math.round(ca.ratio * 6); items.push({ kind: ca.ratio >= 0.5 ? 'ok' : 'tip', text: `Actual result covers ${ca.hit} of ${ca.total} key observations.` }); }
      else items.push({ kind: 'no', text: 'Actual result missing.' });
      let sep = 0;
      if (f.expected && f.actual) sep += 2;
      if (f.expected && f.actual && f.expected.toLowerCase() !== f.actual.toLowerCase() && !/\b(fell|falls through|crash|lost|gone|stuck)\b/i.test(f.expected)) sep += 2;
      else if (f.expected) items.push({ kind: 'no', text: 'The expected result describes the failure. Keep the failure in “Actual”.' });
      if (f.actual && !/\bshould\b/i.test(f.actual)) sep += 2;
      else if (f.actual) items.push({ kind: 'tip', text: '“Should” in the actual result mixes in expectations. State only what happened.' });
      if (sep === 6) items.push({ kind: 'ok', text: 'Expected and actual are clearly separated.' });
      e += sep;
      cats.push({ id: 'expact', label: 'Expected vs. actual', earned: e, possible: 18, items });
    }

    if (inc.has('frequency')) {
      const items = []; let e = 0;
      const truth = opts.observedFreq || defect.freq;
      const got = parseFreq(f.frequency);
      const absolute = /\b(always|every time|100%|never fails)\b/i.test(f.frequency);
      if (got) {
        e += 4; items.push({ kind: 'ok', text: `States a count (${got.x}/${got.y}).` });
        if (truth && got.x === truth.x && got.y === truth.y) { e += 8; items.push({ kind: 'ok', text: `Matches the recorded results (${truth.x}/${truth.y}).` }); }
        else if (truth) items.push({ kind: 'no', text: `Doesn’t match the recorded results (${truth.x}/${truth.y}). Report exactly what you observed.` });
      } else if (absolute && truth && truth.x === truth.y) {
        e += 6; items.push({ kind: 'tip', text: `Accurate, but give the count: “${truth.x}/${truth.y} attempts” tells readers how many times you tried.` });
      } else if (absolute) {
        items.push({ kind: 'no', text: `Says “always” but the results were ${truth ? truth.x + '/' + truth.y : 'not 100%'}. Overstating frequency misleads the team.` });
      } else items.push({ kind: 'no', text: 'State frequency as a count, e.g. “4/5 attempts”.' });
      cats.push({ id: 'freq', label: 'Reproduction frequency', earned: e, possible: 12, items });
    }

    if (inc.has('severity') || inc.has('priority')) {
      const items = []; let e = 0; let p = 0;
      if (inc.has('severity')) {
        p += 6;
        if (f.severity === defect.severity) { e += 6; items.push({ kind: 'ok', text: `Severity ${f.severity} fits the evidence.` }); }
        else if ((defect.severityNear || []).includes(f.severity)) { e += 3; items.push({ kind: 'tip', text: `${f.severity} is arguable. The evidence best supports ${defect.severity}: ${sevReason(defect.severity)}` }); }
        else items.push({ kind: 'no', text: `${f.severity || 'No severity'} doesn’t match the impact. Expected around ${defect.severity}: ${sevReason(defect.severity)}` });
      }
      if (inc.has('priority')) {
        p += 4;
        if ((defect.priority || []).includes(f.priority)) { e += 4; items.push({ kind: 'ok', text: `Priority ${f.priority} is reasonable.` }); }
        else if (f.priority) { e += 1; items.push({ kind: 'tip', text: `Priority ${f.priority} is unusual here; ${defect.priority.join(' or ')} would be typical. Priority is often adjusted by a lead.` }); }
        else items.push({ kind: 'no', text: 'Priority not set.' });
      }
      cats.push({ id: 'sev', label: inc.has('priority') ? 'Severity & priority' : 'Severity', earned: e, possible: p, items });
    }

    {
      const items = []; let e = 8;
      const main = ['title', 'pre', 'steps', 'expected', 'actual', 'frequency'].filter((k) => inc.has(k)).map((k) => f[k]).join('\n');
      const sp = hits(main, SPECULATION);
      if (sp.length) { e -= 3 * sp.length; items.push({ kind: 'no', text: `Speculation stated as fact in the main fields (“${sp.join('”, “')}”). Keep causes and opinions out, or label them as hypotheses in Additional observations.` }); }
      if (inc.has('observations') && f.observations) {
        const so = hits(f.observations, SPECULATION);
        const labeled = hits(f.observations, HEDGE_LABELS).length > 0;
        if (so.length && !labeled) { e -= 2; items.push({ kind: 'tip', text: 'Additional observations contain guesses. Label them clearly (“Hypothesis, unverified: …”).' }); }
        else if (labeled) items.push({ kind: 'ok', text: 'Uncertainty is labeled explicitly.' });
      }
      if (/!!+/.test(main)) { e -= 1; items.push({ kind: 'tip', text: 'Exclamation marks read as emotional. Keep the tone neutral.' }); }
      e = Math.max(0, e);
      if (e === 8) items.unshift({ kind: 'ok', text: 'Observations are stated objectively, without guesses about cause.' });
      cats.push({ id: 'obj', label: 'Facts vs. assumptions', earned: e, possible: 8, items });
    }

    const earned = cats.reduce((s, c) => s + c.earned, 0);
    const possible = cats.reduce((s, c) => s + c.possible, 0);
    return { earned, possible, pct: QA.util.pct(earned, possible), cats };
  }

  function sevReason(id) {
    const s = QA.SCALES.severity.find((x) => x.id === id);
    return s ? s.desc : '';
  }

  /* -------------------------------------------------------------------------------------
     Free-text step evaluator (mission/regression "text" steps)
     ------------------------------------------------------------------------------------- */
  function evaluateText(text, step) {
    const items = [];
    const res = matchGroups(text, step.groups);
    let earned = 0;
    res.forEach((r, i) => {
      if (r.hit) { earned += 1; items.push({ kind: 'ok', text: step.groups[i].label }); }
      else items.push({ kind: 'no', text: 'Missing: ' + step.groups[i].label });
    });
    const possible = step.groups.length;
    (step.penalties || []).forEach((p) => {
      if (matchGroups(text, [{ any: p.any }])[0].hit) { earned -= 1; items.push({ kind: 'no', text: p.label }); }
    });
    const wc = words(text).length;
    if (step.minWords && wc < step.minWords) {
      earned = Math.min(earned, Math.floor(possible / 2));
      items.push({ kind: 'tip', text: `Only ${wc} words. At least ${step.minWords} are needed to cover this properly (score capped at half).` });
    }
    if (step.minLines && lines(text).length < step.minLines) {
      earned -= 1;
      items.push({ kind: 'tip', text: `Use at least ${step.minLines} numbered lines, one action per line.` });
    }
    earned = Math.max(0, earned);
    return { earned, possible, items };
  }

  /* -------------------------------------------------------------------------------------
     Interview answer evaluator — 5 criteria × 0–4 points.
     ------------------------------------------------------------------------------------- */
  const OVERCLAIM = ['never make mistakes', 'never made a mistake', 'perfect', 'i\'m an expert', 'i am an expert', 'i always find', 'never miss', 'guarantee', '100%', 'never get bored', 'i know everything', 'best tester', 'years of qa experience', 'i\'ve worked in qa for', 'flawless'];
  const BLAME = ['lazy', 'stupid', 'idiot', 'their fault', 'incompetent', 'developers are wrong', 'dumb'];
  const HONEST_SIGNALS = ['i would ask', 'i\'d ask', 'not sure', 'i haven\'t', 'i have not', 'i\'m still learning', 'i am still learning', 'i don\'t have professional', 'i learned', 'i was wrong', 'my mistake', 'i would check', 'i\'d check'];

  function evaluateAnswer(text, q) {
    const t = String(text || '').trim();
    const lower = t.toLowerCase();
    const wc = words(t).length;
    const sentences = t.split(/[.!?]+\s|\n+/).map((s) => s.trim()).filter((s) => words(s).length > 2);
    const conceptRes = matchGroups(t, q.concepts);
    const matched = conceptRes.filter((c) => c.hit);
    const missing = conceptRes.filter((c) => !c.hit);
    const behavioral = q.type === 'behavioral';
    const crit = [];

    // Relevance
    const ratio = q.concepts.length ? matched.length / q.concepts.length : 0;
    let rel = Math.round(ratio * 4);
    if (matched.length && rel === 0) rel = 1;
    crit.push({ id: 'relevance', label: 'Relevance', score: rel, why: `Touches ${matched.length} of ${q.concepts.length} key points interviewers listen for.` });

    // Clarity
    let cla = 0; const claWhy = [];
    if (wc >= 40 && wc <= 260) { cla += 2; claWhy.push(`${wc} words, a good length for a spoken answer`); }
    else if (wc >= 20) { cla += 1; claWhy.push(wc < 40 ? `${wc} words, likely too brief to show your thinking` : `${wc} words, long; aim for 60–200`); }
    else claWhy.push(`${wc} words, too short`);
    const avg = sentences.length ? wc / sentences.length : wc;
    if (sentences.length >= 3) { cla += 1; claWhy.push(`${sentences.length} sentences`); }
    if (avg <= 28 && wc >= 20) { cla += 1; claWhy.push('sentences are a manageable length'); }
    else if (wc >= 20) claWhy.push('some sentences are very long; break them up');
    crit.push({ id: 'clarity', label: 'Clarity', score: Math.min(4, cla), why: claWhy.join('; ') + '.' });

    // Specific evidence
    let ev = 0; const evWhy = [];
    if (/\b(for example|for instance|such as|one time|once|when i|at my|in my|last (year|month|week))\b/.test(lower)) { ev += 2; evWhy.push('gives a concrete example'); }
    else evWhy.push('no concrete example');
    if (/\d/.test(t)) { ev += 1; evWhy.push('includes specific numbers'); }
    if (behavioral ? /\bi (noticed|checked|found|told|wrote|asked|fixed|made|started|went|realized|compared|corrected|set up|practiced)\b/.test(lower)
                   : /\b(build|steps|video|log|spec|design|frequency|expected|actual|checklist|test case)\b/.test(lower)) {
      ev += 1; evWhy.push(behavioral ? 'describes your own actions' : 'names concrete QA artifacts');
    }
    crit.push({ id: 'evidence', label: 'Specific evidence', score: Math.min(4, ev), why: evWhy.join('; ') + '.' });

    // Logical process
    let lo = 0; const loWhy = [];
    let star = null;
    if (behavioral) {
      star = {
        S: /\b(situation|when i|at my|once|during|last (year|month|week)|in my)\b/.test(lower),
        T: /\b(task|needed to|had to|responsible|my job was|goal|asked to)\b/.test(lower),
        A: /\b(action|i (noticed|checked|found|told|wrote|asked|fixed|made|started|went|decided|compared|corrected|set up|practiced|traced|created|reviewed))\b/.test(lower),
        R: /\b(result|as a result|ended up|outcome|learned|since then|afterwards|after that|which meant|so we|now i)\b/.test(lower),
      };
      lo = Object.values(star).filter(Boolean).length;
      const found = Object.keys(star).filter((k) => star[k]);
      loWhy.push('STAR parts found: ' + (found.length ? found.join(', ') : 'none'));
    } else {
      const seq = (lower.match(/\b(first|then|next|after that|afterwards|finally|before|once|second|lastly)\b/g) || []).length;
      if (seq >= 2) { lo += 2; loWhy.push('clear sequence of steps'); } else if (seq === 1) { lo += 1; loWhy.push('some sequencing; make the order explicit'); } else loWhy.push('no clear sequence');
      if (/\b(because|so that|that way|which means|since|so i|so the|to make sure|in order to)\b/.test(lower)) { lo += 1; loWhy.push('explains why'); }
      if (ratio >= 0.5) { lo += 1; loWhy.push('covers the main parts of the process'); }
    }
    crit.push({ id: 'logic', label: behavioral ? 'Logical process (STAR)' : 'Logical process', score: Math.min(4, lo), why: loWhy.join('; ') + '.' });

    // Honesty / professionalism
    let ho = 4; const hoWhy = [];
    const oc = OVERCLAIM.filter((w) => lower.includes(w));
    const bl = BLAME.filter((w) => lower.includes(w));
    if (oc.length) { ho -= 2 * oc.length; hoWhy.push(`overclaiming (“${oc.join('”, “')}”) undermines credibility`); }
    if (bl.length) { ho -= 2; hoWhy.push('blaming language; keep it objective'); }
    if (wc < 15) { ho = Math.min(ho, 2); hoWhy.push('too short to judge'); }
    const hs = HONEST_SIGNALS.filter((w) => lower.includes(w));
    if (!oc.length && !bl.length && wc >= 15) hoWhy.push(hs.length ? 'realistic and candid (e.g. asking, admitting limits)' : 'no overclaiming or blame detected');
    crit.push({ id: 'honesty', label: 'Honesty & professionalism', score: Math.max(0, ho), why: hoWhy.join('; ') + '.' });

    const earned = crit.reduce((s, c) => s + c.score, 0);
    const strengths = [];
    crit.filter((c) => c.score >= 3).forEach((c) => strengths.push(`${c.label}: ${c.why}`));
    matched.slice(0, 4).forEach((m) => strengths.push('Covered: ' + m.label));
    return { earned, possible: 20, pct: QA.util.pct(earned, 20), crit, matched, missing, star, wc };
  }

  /* -------------------------------------------------------------------------------------
     Test case set evaluator (workshop)
     ------------------------------------------------------------------------------------- */
  function caseQuality(c) {
    const checks = [];
    checks.push({ ok: words(c.title).length >= 3, text: 'Title names the specific behavior (3+ words)' });
    checks.push({ ok: String(c.pre || '').trim().length >= 5, text: 'Preconditions describe the starting state' });
    checks.push({ ok: lines(c.steps).length >= 2 && !hits(c.steps, VAGUE_STEPS).length, text: '2+ specific steps, no vague wording' });
    const exp = String(c.expected || '').trim();
    checks.push({ ok: words(exp).length >= 4 && !/^(it )?(works|fine|ok|okay|correct|no bugs?)\.?$/i.test(exp), text: 'Expected result is observable (not just “works”)' });
    return { score: checks.filter((x) => x.ok).length, checks };
  }

  function evaluateTestCases(cases, ex) {
    const all = cases.map((c) => [c.title, c.pre, c.steps, c.expected].join(' ')).join('\n');
    const cov = matchGroups(all, ex.coverage);
    const covHit = cov.filter((c) => c.hit).length;
    const qualities = cases.map((c) => ({ id: c.id, title: c.title, ...caseQuality(c) }));
    const avgQ = qualities.length ? qualities.reduce((s, q) => s + q.score, 0) / (qualities.length * 4) : 0;
    const covRatio = ex.coverage.length ? covHit / ex.coverage.length : 0;
    const pctVal = Math.round(covRatio * 60 + avgQ * 40);
    return { pct: pctVal, cov, covHit, covRatio, qualities, avgQ };
  }

  QA.eval = { evaluateReport, evaluateText, evaluateAnswer, evaluateTestCases, caseQuality, parseFreq, REPORT_FIELDS };
})(window.QA);
