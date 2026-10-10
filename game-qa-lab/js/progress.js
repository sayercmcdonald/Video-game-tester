/* Derived progress metrics. Everything here is computed from recorded activity
   in the store; nothing is estimated or invented. */
(function (QA) {
  'use strict';

  QA.SKILLS = {
    repro: 'Reproduction & isolation',
    facts: 'Facts vs. assumptions',
    reporting: 'Bug report writing',
    severity: 'Severity & priority',
    testdesign: 'Test case design',
    regression: 'Regression testing',
    multiplayer: 'Multiplayer testing',
    tracker: 'Bug tracker workflow',
    communication: 'Interview answers',
  };

  const SKILL_PRACTICE = {
    repro: { href: '#/mission/m1', label: 'Mission 1: The Moving Platform' },
    facts: { href: '#/mission/m2', label: 'Mission 2: The Missing Save' },
    reporting: { href: '#/reports', label: 'Bug Report Lab' },
    severity: { href: '#/tracker', label: 'Bug Tracker Basics (severity vs. priority)' },
    testdesign: { href: '#/testcases', label: 'Test Case Workshop' },
    regression: { href: '#/regression', label: 'Regression Lab' },
    multiplayer: { href: '#/mission/m3', label: 'Mission 3: The Multiplayer Disconnect' },
    tracker: { href: '#/tracker', label: 'Bug Tracker Basics quiz' },
    communication: { href: '#/interview', label: 'Mock Interview' },
  };

  const TARGETS = { reports: 3, workshop: 3, interview: 10 };

  function skillSummary() {
    const st = QA.store.get();
    const acc = {};
    const add = (k, ratio) => { (acc[k] = acc[k] || []).push(Math.max(0, Math.min(1, ratio))); };
    Object.values(st.missions).forEach((rec) => {
      Object.entries(rec.last.skills || {}).forEach(([k, v]) => { if (v.p) add(k, v.e / v.p); });
    });
    Object.values(st.reports).forEach((rec) => add('reporting', rec.last.pct / 100));
    Object.values(st.workshop).forEach((rec) => add('testdesign', rec.last.pct / 100));
    const ivs = interviewLatest();
    ivs.forEach((a) => add('communication', a.pct / 100));
    const quiz = st.lessons.tracker && st.lessons.tracker.quiz;
    if (quiz) add('tracker', quiz.pct / 100);
    return Object.keys(QA.SKILLS).map((id) => {
      const arr = acc[id] || [];
      const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      return { id, label: QA.SKILLS[id], avg, pct: avg == null ? null : Math.round(avg * 100), count: arr.length, practice: SKILL_PRACTICE[id] };
    });
  }

  function interviewLatest() {
    const st = QA.store.get();
    return Object.entries(st.interview).filter(([, v]) => v.attempts && v.attempts.length).map(([id, v]) => {
      const a = v.attempts;
      return { id, pct: a[a.length - 1].pct, best: Math.max(...a.map((x) => x.pct)), first: a[0].pct, count: a.length };
    });
  }

  function modules() {
    const st = QA.store.get();
    const mDone = QA.MISSIONS.filter((m) => st.missions[m.id]).length;
    const rDone = QA.REGRESSIONS.filter((m) => st.missions[m.id]).length;
    const reps = Object.keys(st.reports).length;
    const ws = Object.keys(st.workshop).length;
    const iv = interviewLatest().length;
    const quiz = !!(st.lessons.tracker && st.lessons.tracker.quiz);
    return [
      { id: 'missions', label: 'Missions completed', done: mDone, total: QA.MISSIONS.length, href: '#/missions' },
      { id: 'regression', label: 'Regression scenarios', done: rDone, total: QA.REGRESSIONS.length, href: '#/regression' },
      { id: 'reports', label: 'Bug reports written', done: Math.min(reps, TARGETS.reports), total: TARGETS.reports, raw: reps, href: '#/reports' },
      { id: 'workshop', label: 'Test case exercises', done: Math.min(ws, TARGETS.workshop), total: TARGETS.workshop, raw: ws, href: '#/testcases' },
      { id: 'tracker', label: 'Bug tracker lesson quiz', done: quiz ? 1 : 0, total: 1, href: '#/tracker' },
      { id: 'interview', label: 'Interview questions practiced', done: Math.min(iv, TARGETS.interview), total: TARGETS.interview, raw: iv, href: '#/interview' },
    ];
  }

  function overall() {
    const mods = modules();
    return Math.round((mods.reduce((s, m) => s + m.done / m.total, 0) / mods.length) * 100);
  }

  function hasActivity() {
    const st = QA.store.get();
    return !!(Object.keys(st.missions).length || Object.keys(st.reports).length || Object.keys(st.workshop).length ||
      Object.keys(st.interview).length || st.testCases.length || (st.lessons.tracker && st.lessons.tracker.quiz));
  }

  /* A fixed learning path; the first unfinished item is recommended. */
  function nextActivity() {
    const st = QA.store.get();
    const reps = Object.keys(st.reports).length;
    const ws = Object.keys(st.workshop).length;
    const iv = interviewLatest().length;
    const path = [
      { done: !!st.missions.m1, href: '#/mission/m1', title: 'Mission 1: The Moving Platform', why: 'Start here: reproduce an intermittent bug and write your first report.' },
      { done: !!(st.lessons.tracker && st.lessons.tracker.quiz), href: '#/tracker', title: 'Bug Tracker Basics', why: 'Learn how tickets, severity, priority and statuses work in a team tracker.' },
      { done: reps >= 1, href: '#/reports', title: 'Bug Report Lab', why: 'Turn messy tester notes into a clean, objective defect report.' },
      { done: !!st.missions.m2, href: '#/mission/m2', title: 'Mission 2: The Missing Save', why: 'Design save/load tests and tell real defects from expected behavior.' },
      { done: ws >= 1, href: '#/testcases', title: 'Test Case Workshop', why: 'Write repeatable test cases, including edge cases.' },
      { done: !!st.missions.m3, href: '#/mission/m3', title: 'Mission 3: The Multiplayer Disconnect', why: 'Test disconnects across the match lifecycle.' },
      { done: !!st.missions.r1, href: '#/regression/r1', title: 'Regression Lab: Verify the platform fix', why: 'Learn why one passing test doesn’t prove a fix.' },
      { done: iv >= 5, href: '#/interview', title: 'Mock Interview (5 questions)', why: 'Practice explaining your process out loud.' },
      { done: !!st.missions.r2, href: '#/regression/r2', title: 'Regression Lab: Verify the disconnect fix', why: 'Practice pass / fail / blocked decisions.' },
      { done: reps >= 3, href: '#/reports', title: 'Bug Report Lab (3 defects)', why: 'Repetition builds the habit of complete reports.' },
      { done: ws >= 3, href: '#/testcases', title: 'Test Case Workshop (3 exercises)', why: 'Cover boundaries, save/load and multiplayer.' },
      { done: iv >= 10, href: '#/interview', title: 'Mock Interview (10 questions)', why: 'Cover every topic area at least once.' },
    ];
    const next = path.find((p) => !p.done);
    if (next) return next;
    const weak = skillSummary().filter((s) => s.pct != null).sort((a, b) => a.pct - b.pct)[0];
    if (weak && weak.pct < 80) return { href: weak.practice.href, title: weak.practice.label, why: `Your lowest skill is ${weak.label} (${weak.pct}%). Another round should help.` };
    return { href: '#/review', title: 'Readiness Review', why: 'You’ve covered the full path. Review your results and checklist.' };
  }

  function bestMission() {
    const st = QA.store.get();
    const bests = QA.MISSIONS.map((m) => st.missions[m.id]).filter(Boolean).map((r) => r.best);
    return bests.length ? Math.max(...bests) : null;
  }

  QA.progress = { skillSummary, modules, overall, nextActivity, bestMission, interviewLatest, hasActivity, SKILL_PRACTICE };
})(window.QA);
