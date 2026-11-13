'use strict';
const { now, HttpError } = require('../lib/util');

/**
 * Operating settings changed by administrators in the dashboard. Agents can read them
 * but there is no tool through which an agent can write them.
 */
const DEFINITIONS = {
  orchestrator_paused: { type: 'bool', label: 'Pause all automation', default: () => false },
  autonomous_production: {
    type: 'bool', label: 'Autonomous production (submit work to INDEX V3 / FORM without a person)', default: () => false,
    help: 'Off until each integration and its outputs have been verified. While off, all production is routed to the human queue.',
  },
  ai_monthly_budget_usd: { type: 'money', label: 'AI budget per calendar month (USD)', default: (c) => c.budgets.aiMonthlyUsd },
  ai_project_budget_usd: { type: 'money', label: 'AI budget per project (USD)', default: (c) => c.budgets.aiProjectUsd },
  external_project_budget_usd: { type: 'money', label: 'External service budget per project (USD)', default: (c) => c.budgets.externalProjectUsd },
  external_job_estimate_usd: { type: 'money', label: 'Assumed cost of one INDEX V3 / FORM job when the service does not report one (USD)', default: (c) => c.budgets.externalJobEstimateUsd },
};

function createSettings({ db, config, audit }) {
  function parse(def, raw) {
    if (def.type === 'bool') return raw === 'true';
    return Number(raw);
  }
  function get(key) {
    const def = DEFINITIONS[key];
    if (!def) throw new Error(`Unknown setting ${key}`);
    const row = db.get('SELECT value FROM ops_settings WHERE key = ?', key);
    return row ? parse(def, row.value) : def.default(config);
  }
  return {
    DEFINITIONS,
    get,
    all: () => Object.fromEntries(Object.keys(DEFINITIONS).map((k) => [k, get(k)])),
    /** Admin-only (enforced by the route). Every change is audited. */
    set(key, value, user) {
      const def = DEFINITIONS[key];
      if (!def) throw new HttpError(400, 'Unknown setting.');
      let stored;
      if (def.type === 'bool') stored = value === true || value === 'true' || value === 'on' ? 'true' : 'false';
      else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, `${def.label}: enter an amount between 0 and 100,000.`);
        stored = String(Math.round(n * 100) / 100);
      }
      const before = get(key);
      db.run('INSERT INTO ops_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        key, stored, `staff:${user.email}`, now());
      if (String(before) !== String(parse(def, stored))) {
        audit.log(`staff:${user.email}`, 'ops.setting_changed', { entity: 'setting', detail: `${key}: ${before} → ${parse(def, stored)}` });
      }
    },
  };
}

module.exports = { createSettings, DEFINITIONS };
