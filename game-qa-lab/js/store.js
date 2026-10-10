/* Local persistence. All progress lives in this browser's localStorage only. */
(function (QA) {
  'use strict';

  const KEY = 'game-qa-lab:v1';

  function defaults() {
    return {
      version: 1,
      missions: {},     // id -> { attempts, best, last: { pct, earned, possible, skills, results, answers, log, ts } }
      reports: {},      // defectId -> { attempts, best, last: { pct, fields, result, ts } }
      drafts: {},       // free-form drafts keyed by context
      testCases: [],    // trainee-authored test cases
      workshop: {},     // exerciseId -> { attempts, best, last: { pct, result, ts } }
      interview: {},    // questionId -> { attempts: [{ text, pct, criteria, ts }] }
      lessons: {},      // lessonId -> { quiz: { pct, answers, ts } }
      checklist: {},    // readiness checklist ticks
    };
  }

  let state = defaults();
  let storageOk = true;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') state = Object.assign(defaults(), parsed);
      }
    } catch (e) {
      storageOk = false;
      state = defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
  }

  QA.store = {
    KEY,
    load,
    get: () => state,
    storageOk: () => storageOk,
    update(fn) { fn(state); save(); },
    reset() {
      state = defaults();
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      save();
    },
  };

  load();
})(window.QA);
