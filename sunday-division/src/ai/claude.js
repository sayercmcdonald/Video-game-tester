'use strict';
const { SYSTEM, TASKS } = require('./prompts');

let client = null;
function getClient() {
  if (!client) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk.Anthropic || sdk;
    client = new Anthropic({ maxRetries: 2, timeout: 120000 });
  }
  return client;
}

const MAX_TOKENS = 16000;

/**
 * One structured drafting call, constrained to the task's JSON schema.
 * Returns { data, usage, model, stopReason }. Throws on refusal, truncation or bad JSON
 * so the gateway can fall back to rules.
 */
async function draftWithClaude(config, task, context) {
  const spec = TASKS[task];
  const response = await getClient().beta.messages.create({
    model: config.ai.model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    // If the primary model declines, let the API route the request to its default fallback.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: spec.schema } },
    messages: [{ role: 'user', content: `${spec.instruction}\n\n${context}` }],
  });
  const usage = { input: response.usage.input_tokens || 0, output: response.usage.output_tokens || 0 };
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('model declined the request'), { usage, model: response.model, refusal: true });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('response was truncated'), { usage, model: response.model });
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { data: JSON.parse(text), usage, model: response.model, stopReason: response.stop_reason };
}

module.exports = { draftWithClaude, MAX_TOKENS };
