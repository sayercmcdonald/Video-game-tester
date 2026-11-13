'use strict';
const { toApiSchema } = require('../../agents/tools');

let client = null;
function getClient() {
  if (!client) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk.Anthropic || sdk;
    client = new Anthropic({ maxRetries: 2, timeout: 10 * 60e3 });
  }
  return client;
}

/** One Messages API call with tools (the live transport). */
function callClaude(config, { system, tools, messages, maxTokens }) {
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
    // Cache the stable prefix (tools + system + earlier turns) across turns.
    cache_control: { type: 'ephemeral' },
  });
}

/** After a mid-output fallback, blocks from the declined partial before the boundary are not echoed. */
function forReplay(content) {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === 'text');
}

const STOP = { tool_use: 'tool_use', end_turn: 'end', stop_sequence: 'end', max_tokens: 'max_tokens', refusal: 'refusal', pause_turn: 'end' };

/**
 * Anthropic Claude adapter. Transcripts are stored in the Messages API's own format
 * (thinking blocks are replayed unchanged); file parts are stored as references and only
 * expanded to bytes when calling.
 */
function createAnthropicAdapter(app) {
  const { config } = app;
  const a = {
    id: 'anthropic',
    label: 'Anthropic Claude',
    turnAllowance: 1,
    transport: (request) => callClaude(config, request),
    overridden: false,
    simulated: false,
    model: () => config.ai.model,
    configured: () => a.overridden || Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    missing: () => (a.configured() ? '' : 'ANTHROPIC_API_KEY is not set'),
    recordAs: () => (a.simulated ? 'simulated' : 'claude'),
    useTransport(fn, { simulated = true } = {}) { a.transport = fn; a.overridden = true; a.simulated = simulated; },

    userMessage: (text) => ({ role: 'user', content: [{ type: 'text', text }] }),
    isAssistant: (m) => m.role === 'assistant',
    userText: (m) => (m.role === 'user' && Array.isArray(m.content) && m.content.length === 1 && m.content[0].type === 'text' ? m.content[0].text : null),
    callsOf: (m) => (m.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input })),
    textOf: (m) => (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
    /** results: [{ id, content: string | [{type:'text'}|{type:'document'|'image', _file_id, media_type}], isError }] */
    toolResults: (results) => [{
      role: 'user',
      content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, ...(r.isError ? { is_error: true } : {}), content: r.content })),
    }],
    expand(messages, readFile) {
      return messages.map((m) => {
        if (m.role !== 'user' || !Array.isArray(m.content)) return m;
        return {
          role: 'user',
          content: m.content.map((b) => {
            if (b.type !== 'tool_result' || !Array.isArray(b.content)) return b;
            return { ...b, content: b.content.map((c) => (c._file_id ? { type: c.type, source: { type: 'base64', media_type: c.media_type, data: readFile(c._file_id) } } : c)) };
          }),
        };
      });
    },
    nativeTools: (tools) => tools.map((t) => ({ name: t.name, strict: true, description: t.description, input_schema: toApiSchema(t.schema) })),

    async turn({ system, tools, messages, maxTokens, readFile }) {
      const response = await a.transport({ system, tools: a.nativeTools(tools), messages: a.expand(messages, readFile), maxTokens });
      const u = response.usage || {};
      const message = { role: 'assistant', content: forReplay(response.content || []) };
      return {
        message,
        stop: STOP[response.stop_reason] || 'end',
        usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
        model: response.model || config.ai.model,
      };
    },
    /** Transcript in the shape the Agent tasks viewer renders (already native). */
    display: (transcript) => transcript,
  };
  return a;
}

module.exports = { createAnthropicAdapter, callClaude };
