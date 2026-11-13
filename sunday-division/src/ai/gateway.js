'use strict';
const { sha256 } = require('../lib/crypto');
const { validate } = require('../lib/schema');
const { now } = require('../lib/util');
const { SYSTEM, TASKS } = require('./prompts');
const { toOpenAISchema, fromOpenAIArgs } = require('./providers/schema');

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

  /** One structured call through whichever provider is selected. Returns { data, usage, model }. */
  async function structured(adapter, task, context) {
    if (adapter.id === 'anthropic' && !adapter.overridden) return require('./claude').draftWithClaude(config, task, context);
    if (adapter.id === 'openai') {
      const spec = TASKS[task];
      const response = await adapter.transport({
        model: adapter.model(), max_completion_tokens: 16000,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${spec.instruction}\n\n${context}` }],
        response_format: { type: 'json_schema', json_schema: { name: task, strict: true, schema: toOpenAISchema(spec.schema) } },
      });
      const choice = (response.choices || [])[0] || {};
      const u = response.usage || {};
      const usage = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
      if (choice.message && choice.message.refusal) throw Object.assign(new Error('model declined the request'), { usage, model: response.model, refusal: true });
      if (choice.finish_reason === 'length') throw Object.assign(new Error('response was truncated'), { usage, model: response.model });
      return { data: fromOpenAIArgs(spec.schema, JSON.parse(choice.message.content)), usage, model: response.model || adapter.model() };
    }
    throw new Error('No structured-output path for this provider.');
  }

  const gateway = {
    /** Replaceable in tests (recorded as Claude); otherwise the selected provider. Must return { data, usage, model }. */
    transport: null,
    transportOverridden: false,
    adapter: () => (gateway.transportOverridden ? null : app.providers.selected()),
    enabled() {
      if (gateway.transportOverridden) return true; // tests inject a fake model
      return Boolean(app.providers.selected());
    },
    mode() {
      if (gateway.transportOverridden) return `Claude (${config.ai.model})`;
      const a = app.providers.selected();
      return a ? `${a.label} (${a.model()})` : 'Rules-based drafting';
    },
    useTransport(fn) { gateway.transport = fn; gateway.transportOverridden = true; },

    /**
     * meta: { agent, agentVersion, jobId, workflowId, projectId }
     * Returns { data, source: 'claude'|'openai'|'rules', runId }.
     */
    async draft(task, context, fallback, meta = {}) {
      const adapter = gateway.adapter();
      const recordAs = adapter ? adapter.recordAs() : 'claude';
      const modelName = adapter ? adapter.model() : config.ai.model;
      const record = (row) => db.insert('agent_runs', {
        job_id: meta.jobId || null, workflow_id: meta.workflowId || null, project_id: meta.projectId || null,
        agent: meta.agent || 'staff_assist', agent_version: meta.agentVersion || '', task,
        prompt_version: row.provider !== 'rules' ? promptVersion(task) : RULES_VERSION,
        model_requested: row.provider !== 'rules' ? modelName : '', created_at: now(), ...row,
      });
      const useRules = (status, detail, extra = {}) => {
        const data = fallback();
        const runId = record({ provider: 'rules', status, detail, model_served: RULES_VERSION, ...extra });
        return { data, source: 'rules', runId };
      };

      if (!gateway.enabled()) return useRules('ok', 'model not configured');
      try {
        app.budget.assertAi({ model: modelName, inputChars: SYSTEM.length + context.length + 2000, maxOutputTokens: 4000, projectId: meta.projectId });
      } catch (err) {
        if (err.kind !== 'budget') throw err;
        // Spending limit reached: no model call is made at all.
        record({ provider: recordAs, status: 'budget_blocked', detail: err.message });
        return useRules('fallback', 'budget limit reached');
      }

      const started = Date.now();
      let result;
      try {
        result = gateway.transportOverridden ? await gateway.transport(task, context) : await structured(adapter, task, context);
      } catch (err) {
        const usage = err.usage || { input: 0, output: 0 };
        record({
          provider: recordAs, status: err.refusal ? 'refused' : 'error', detail: String(err.message).slice(0, 300),
          model_served: err.model || '', input_tokens: usage.input, output_tokens: usage.output,
          cost_micros: app.budget.tokenCostMicros(err.model || modelName, usage.input, usage.output), latency_ms: Date.now() - started,
        });
        console.error(`[ai] ${task}: model call failed, using rules —`, err.message);
        return useRules('fallback', 'model call failed');
      }

      const usage = result.usage || { input: 0, output: 0 };
      const base = {
        provider: recordAs, model_served: result.model || '', input_tokens: usage.input, output_tokens: usage.output,
        cost_micros: app.budget.tokenCostMicros(result.model || modelName, usage.input, usage.output), latency_ms: Date.now() - started,
      };
      const errors = validate(TASKS[task].schema, result.data);
      if (errors.length) {
        record({ ...base, status: 'invalid_output', detail: errors.slice(0, 5).join('; ') });
        return useRules('fallback', 'model output failed validation');
      }
      const runId = record({ ...base, status: 'ok' });
      return { data: result.data, source: recordAs === 'openai' ? 'openai' : 'claude', runId };
    },
  };
  return gateway;
}

module.exports = { createAiGateway, RULES_VERSION };
