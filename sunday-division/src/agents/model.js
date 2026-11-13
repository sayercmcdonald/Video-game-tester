'use strict';

/**
 * The model behind the business agents.
 *
 * Live: Claude through the Anthropic Messages API with tool use. Tests install a scripted
 * transport with use(fn, { simulated: true }); every run it makes is recorded with provider
 * "simulated" so it can never be mistaken for real model output.
 */
let client = null;
function getClient() {
  if (!client) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk.Anthropic || sdk;
    client = new Anthropic({ maxRetries: 2, timeout: 10 * 60e3 });
  }
  return client;
}

async function callClaude(config, { system, tools, messages, maxTokens }) {
  return getClient().beta.messages.create({
    model: config.ai.model,
    max_tokens: maxTokens,
    system,
    tools,
    messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.ai.agentEffort },
    // If the primary model declines, the API routes the request to its default fallback.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // Cache the stable prefix (tools + system + earlier turns) across the agent's turns.
    cache_control: { type: 'ephemeral' },
  });
}

function createAgentModel(app) {
  const { config } = app;
  const model = {
    transport: (request) => callClaude(config, request),
    overridden: false,
    simulated: false,
    enabled() {
      if (model.overridden) return true;
      if (config.ai.provider === 'rules') return false;
      if (config.ai.provider === 'claude') return true;
      return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    },
    provider: () => (model.simulated ? 'simulated' : 'claude'),
    describe() {
      if (model.simulated) return 'Simulated model (tests only)';
      return model.enabled() ? `Claude (${config.ai.model}), tool use` : 'Rules only — no API key configured';
    },
    /** Install a different transport. Pass { simulated: true } for test doubles. */
    use(fn, { simulated = true } = {}) {
      model.transport = fn;
      model.overridden = true;
      model.simulated = simulated;
    },
    call: (request) => model.transport(request),
  };
  return model;
}

module.exports = { createAgentModel };
