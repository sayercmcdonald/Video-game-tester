'use strict';
const { BudgetExceededError } = require('./errors');

/**
 * Prices in USD per million tokens. Unknown models are charged at the most expensive known
 * rate, so a misconfigured model can only make the budget more conservative.
 */
const MODEL_PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
};
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute cache writes
const FALLBACK_PRICE = Object.values(MODEL_PRICES).reduce((a, b) => (b.output > a.output ? b : a));

const toMicros = (usd) => Math.round(usd * 1e6);
const priceFor = (model) => MODEL_PRICES[model] || FALLBACK_PRICE;

/** Cost of a call in micro-dollars (integer arithmetic downstream). */
function tokenCostMicros(model, inputTokens, outputTokens, { cacheRead = 0, cacheWrite = 0 } = {}) {
  const p = priceFor(model);
  // $/MTok × tokens = micro-dollars
  return Math.round(inputTokens * p.input + outputTokens * p.output + cacheRead * p.cacheRead + cacheWrite * p.input * CACHE_WRITE_MULTIPLIER);
}

function createBudget({ db, settings, clock, config }) {
  // OpenAI prices come from configuration (the application does not guess them).
  const extra = {};
  const oa = config && config.ai.openai;
  if (oa && oa.model && oa.prices) extra[oa.model] = oa.prices;
  // Providers report dated snapshots ("model-2026-05-01") of the configured model name.
  const configured = (model) => extra[model] || (Object.entries(extra).find(([k]) => String(model).startsWith(`${k}-`)) || [])[1];
  const cost = (model, inputTokens, outputTokens, cache = {}) => {
    const own = configured(model);
    const p = own || priceFor(model);
    const { cacheRead = 0, cacheWrite = 0 } = cache;
    return Math.round(inputTokens * p.input + outputTokens * p.output + cacheRead * p.cacheRead + (own ? 0 : cacheWrite * p.input * CACHE_WRITE_MULTIPLIER));
  };
  const monthStart = () => {
    const d = new Date(clock());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  };
  const spent = (where, ...params) => db.get(`SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE ${where}`, ...params).n;

  return {
    MODEL_PRICES, tokenCostMicros: cost,
    aiSpentThisMonth: () => spent("provider IN ('claude','openai','simulated') AND created_at >= ?", monthStart()),
    aiSpentForProject: (projectId) => spent("provider IN ('claude','openai','simulated') AND project_id = ?", projectId),
    externalSpentForProject: (projectId) => spent("provider = 'integration' AND project_id = ?", projectId),
    /**
     * Refuse a model call whose worst-case cost would take spending over a limit.
     * The estimate assumes a full response, so the limit is never overshot by more than
     * the difference between estimate and actual on a single call.
     */
    assertAi({ model, inputChars, maxOutputTokens, projectId }) {
      const estimate = cost(model, Math.ceil(inputChars / 3), maxOutputTokens);
      const monthly = toMicros(settings.get('ai_monthly_budget_usd'));
      if (this.aiSpentThisMonth() + estimate > monthly) throw new BudgetExceededError('Monthly AI budget reached.');
      if (projectId) {
        const perProject = toMicros(settings.get('ai_project_budget_usd'));
        if (this.aiSpentForProject(projectId) + estimate > perProject) throw new BudgetExceededError('AI budget for this project reached.');
      }
      return estimate;
    },
    assertExternal({ projectId, estimateMicros }) {
      const limit = toMicros(settings.get('external_project_budget_usd'));
      if (this.externalSpentForProject(projectId) + estimateMicros > limit) {
        throw new BudgetExceededError('External service budget for this project reached.');
      }
    },
    externalJobEstimateMicros: () => toMicros(settings.get('external_job_estimate_usd')),
  };
}

module.exports = { createBudget, tokenCostMicros, MODEL_PRICES };
