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

/**
 * One structured drafting call. The response is constrained to the task's JSON schema.
 * Throws on any failure (including a refusal) so the caller can fall back to rules.
 */
async function draftWithClaude(config, task, context) {
  const spec = TASKS[task];
  const response = await getClient().beta.messages.create({
    model: config.ai.model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    // If the primary model declines, let the API route the request to its default fallback.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: spec.schema } },
    messages: [{ role: 'user', content: `${spec.instruction}\n\n${context}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('model declined the request');
  if (response.stop_reason === 'max_tokens') throw new Error('response was truncated');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

module.exports = { draftWithClaude };
