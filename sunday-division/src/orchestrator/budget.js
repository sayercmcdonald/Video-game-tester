'use strict';
const { BudgetExceededError } = require('./errors');

/**
 * Prices in USD per million tokens. Unknown models are charged at the most expensive known
 * rate, so a misconfigured model can only make the budget more conservative.
 */
const MODEL_PRICES = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-fable-5-2': { input: 8, output: 40 },
};
const FALLBACK_PRICE = Object.values(MODEL_PRICES).reduce((a, b) => (b.output > a.output ? b : a));

const toMicros = (usd) => Math.round(usd * 1e6);
const priceFor = (model) => MODEL_PRICES[model] || FALLBACK_PRICE;

/** Cost of a call in micro-dollars (integer arithmetic downstream). */
function tokenCostMicros(model, inputTokens, outputTokens) {
  const p = priceFor(model);
  return Math.round(inputTokens * p.input + outputTokens * p.output); // $/MTok × tokens = micro-dollars
}

function createBudget({ db, settings, clock }) {
  const monthStart = () => {
    const d = new Date(clock());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  };
  const spent = (where, ...params) => db.get(`SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE ${where}`, ...params).n;

  return {
    MODEL_PRICES, tokenCostMicros,
    aiSpentThisMonth: () => spent("provider = 'claude' AND created_at >= ?", monthStart()),
    aiSpentForProject: (projectId) => spent("provider = 'claude' AND project_id = ?", projectId),
    externalSpentForProject: (projectId) => spent("provider = 'integration' AND project_id = ?", projectId),
    /**
     * Refuse a model call whose worst-case cost would take spending over a limit.
     * The estimate assumes a full response, so the limit is never overshot by more than
     * the difference between estimate and actual on a single call.
     */
    assertAi({ model, inputChars, maxOutputTokens, projectId }) {
      const estimate = tokenCostMicros(model, Math.ceil(inputChars / 3), maxOutputTokens);
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
