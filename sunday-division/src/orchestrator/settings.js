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

  // ── Founder settings (Sunday Division Command) ──
  ai_provider: {
    type: 'enum', values: ['auto', 'anthropic', 'openai', 'rules'], label: 'Model provider', permission: true,
    default: (c) => c.ai.provider,
    help: 'Auto uses Anthropic when its key is set, otherwise OpenAI when fully configured, otherwise rules. Tasks already running finish on the provider they started on.',
  },
  brief_hour: { type: 'int', min: 0, max: 23, label: 'Morning Brief time (hour, local)', default: () => 7 },
  timezone: { type: 'tz', label: 'Time zone', default: (c) => c.command.timezone || 'UTC' },
  unusual_expense_usd: { type: 'money', label: 'Flag any single cost above (USD)', default: () => 500, permission: true },
};
const AGENT_IDS = ['sales', 'project_manager', 'talent', 'production', 'qa', 'client_success'];
const AGENT_MODES = ['auto', 'rules', 'paused'];
for (const id of AGENT_IDS) {
  DEFINITIONS[`agent_mode_${id}`] = {
    type: 'enum', values: AGENT_MODES, label: `Agent mode: ${id}`, default: () => 'auto', permission: true,
    help: 'auto: model when a provider is available, rules otherwise · rules: never use a model · paused: queued tasks wait',
  };
}
const NOTIFY_KINDS = ['paid_project', 'approval', 'workflow_failed', 'contractor_delay', 'project_risk', 'unusual_expense', 'brief'];
for (const kind of NOTIFY_KINDS) DEFINITIONS[`push_${kind}`] = { type: 'bool', label: `Push: ${kind}`, default: () => true };
// Changes to these alter what agents may do or what money may be spent: in Command they go
// through a previewed, confirmed action; in the admin dashboard they are audited.
for (const k of ['orchestrator_paused', 'autonomous_production', 'ai_monthly_budget_usd', 'ai_project_budget_usd', 'external_project_budget_usd', 'external_job_estimate_usd']) DEFINITIONS[k].permission = true;

function createSettings(app) {
  const { db, config, audit } = app;
  function parse(def, raw) {
    if (def.type === 'bool') return raw === 'true';
    if (def.type === 'enum' || def.type === 'tz') return raw;
    return Number(raw);
  }
  /** Normalise and validate a submitted value; throws a 400 with a readable message. */
  function normalise(key, value) {
    const def = DEFINITIONS[key];
    if (!def) throw new HttpError(400, 'Unknown setting.');
    if (def.type === 'bool') return value === true || value === 'true' || value === 'on' ? 'true' : 'false';
    if (def.type === 'enum') {
      if (!def.values.includes(String(value))) throw new HttpError(400, `${def.label}: choose one of ${def.values.join(', ')}.`);
      return String(value);
    }
    if (def.type === 'tz') {
      try { new Intl.DateTimeFormat('en-US', { timeZone: String(value) }); } catch { throw new HttpError(400, 'Unknown time zone.'); }
      return String(value);
    }
    const n = Number(value);
    if (def.type === 'int') {
      if (!Number.isInteger(n) || n < def.min || n > def.max) throw new HttpError(400, `${def.label}: enter a whole number from ${def.min} to ${def.max}.`);
      return String(n);
    }
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, `${def.label}: enter an amount between 0 and 100,000.`);
    return String(Math.round(n * 100) / 100);
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
    AGENT_IDS, AGENT_MODES, NOTIFY_KINDS,
    all: () => Object.fromEntries(Object.keys(DEFINITIONS).map((k) => [k, get(k)])),
    normalise: (key, value) => parse(DEFINITIONS[key], normalise(key, value)),
    agentMode: (agentId) => (DEFINITIONS[`agent_mode_${agentId}`] ? get(`agent_mode_${agentId}`) : 'auto'),
    pausedAgents: () => AGENT_IDS.filter((id) => get(`agent_mode_${id}`) === 'paused'),
    /** Every change is audited. Agent permissions and spending limits are founder-only, checked
     *  here on the server whichever screen the change came from. Pausing automation is the one
     *  permission-type change any member of staff may make: it can only reduce what agents do. */
    set(key, value, user) {
      const def = DEFINITIONS[key];
      const stored = normalise(key, value);
      if (String(get(key)) === String(parse(def, stored))) return; // unchanged: nothing to authorise or record
      if (def.permission) {
        const safetyStop = key === 'orchestrator_paused' && stored === 'true';
        if (!safetyStop) user = app.permissions.authorize(user, def.type === 'money' ? 'agents.limits' : 'permissions.change', { entity: 'setting' });
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
