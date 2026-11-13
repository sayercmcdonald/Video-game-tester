'use strict';
const { sha256 } = require('../lib/crypto');
const { validate } = require('../lib/schema');
const { now } = require('../lib/util');
const { SYSTEM, TASKS } = require('./prompts');

const RULES_VERSION = 'rules@1';

/**
 * Every model call in the application goes through here. The gateway:
 *  - checks the AI budget before calling (worst-case estimate),
 *  - validates the model's JSON against the task schema (extra or missing fields → rejected),
 *  - records provider, model requested/served, prompt version, tokens, cost and latency,
 *  - falls back to deterministic rules on any failure, so drafting never blocks a workflow.
 * The model's output is only ever data handed back to code; it cannot call anything.
 */
function createAiGateway(app) {
  const { config, db } = app;
  const promptVersion = (task) => sha256(SYSTEM + TASKS[task].instruction + JSON.stringify(TASKS[task].schema)).slice(0, 12);

  const gateway = {
    /** Replaceable in tests; defaults to the Anthropic SDK. Must return { data, usage, model }. */
    transport: (task, context) => require('./claude').draftWithClaude(config, task, context),
    transportOverridden: false,
    enabled() {
      if (gateway.transportOverridden) return true; // tests inject a fake model
      if (config.ai.provider === 'rules') return false;
      if (config.ai.provider === 'claude') return true;
      return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    },
    mode: () => (gateway.enabled() ? `Claude (${config.ai.model})` : 'Rules-based drafting'),
    useTransport(fn) { gateway.transport = fn; gateway.transportOverridden = true; },

    /**
     * meta: { agent, agentVersion, jobId, workflowId, projectId }
     * Returns { data, source: 'claude'|'rules', runId }.
     */
    async draft(task, context, fallback, meta = {}) {
      const record = (row) => db.insert('agent_runs', {
        job_id: meta.jobId || null, workflow_id: meta.workflowId || null, project_id: meta.projectId || null,
        agent: meta.agent || 'staff_assist', agent_version: meta.agentVersion || '', task,
        prompt_version: row.provider === 'claude' ? promptVersion(task) : RULES_VERSION,
        model_requested: row.provider === 'claude' ? config.ai.model : '', created_at: now(), ...row,
      });
      const useRules = (status, detail, extra = {}) => {
        const data = fallback();
        const runId = record({ provider: 'rules', status, detail, model_served: RULES_VERSION, ...extra });
        return { data, source: 'rules', runId };
      };

      if (!gateway.enabled()) return useRules('ok', 'model not configured');
      try {
        app.budget.assertAi({ model: config.ai.model, inputChars: SYSTEM.length + context.length + 2000, maxOutputTokens: 4000, projectId: meta.projectId });
      } catch (err) {
        if (err.kind !== 'budget') throw err;
        // Spending limit reached: no model call is made at all.
        record({ provider: 'claude', status: 'budget_blocked', detail: err.message });
        return useRules('fallback', 'budget limit reached');
      }

      const started = Date.now();
      let result;
      try {
        result = await gateway.transport(task, context);
      } catch (err) {
        const usage = err.usage || { input: 0, output: 0 };
        record({
          provider: 'claude', status: err.refusal ? 'refused' : 'error', detail: String(err.message).slice(0, 300),
          model_served: err.model || '', input_tokens: usage.input, output_tokens: usage.output,
          cost_micros: app.budget.tokenCostMicros(err.model || config.ai.model, usage.input, usage.output), latency_ms: Date.now() - started,
        });
        console.error(`[ai] ${task}: model call failed, using rules —`, err.message);
        return useRules('fallback', 'model call failed');
      }

      const usage = result.usage || { input: 0, output: 0 };
      const base = {
        provider: 'claude', model_served: result.model || '', input_tokens: usage.input, output_tokens: usage.output,
        cost_micros: app.budget.tokenCostMicros(result.model || config.ai.model, usage.input, usage.output), latency_ms: Date.now() - started,
      };
      const errors = validate(TASKS[task].schema, result.data);
      if (errors.length) {
        record({ ...base, status: 'invalid_output', detail: errors.slice(0, 5).join('; ') });
        return useRules('fallback', 'model output failed validation');
      }
      const runId = record({ ...base, status: 'ok' });
      return { data: result.data, source: 'claude', runId };
    },
  };
  return gateway;
}

module.exports = { createAiGateway, RULES_VERSION };
