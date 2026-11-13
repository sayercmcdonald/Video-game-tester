'use strict';
const fs = require('node:fs');
const { sha256 } = require('../lib/crypto');
const { validate } = require('../lib/schema');
const { now, HttpError } = require('../lib/util');
const { apiTools } = require('./tools');
const { POLICIES } = require('./policies');
const { FatalError, PermissionDeniedError, classify } = require('../orchestrator/errors');

const MAX_OUTPUT_TOKENS = 16000;
const MAX_DENIED = 3;
const MAX_NUDGES = 2;
const NUDGE = 'You have not called submit_result. Finish the task with the tools available, then call submit_result exactly once.';
const RESULT_LIMIT = 20000;

/**
 * Runs one agent job. Two brains share the same tools, permissions and output schema:
 *
 *   model — Claude decides which tools to call (manual tool-use loop). Every turn is
 *           appended to agent_sessions.transcript before the next step, so a restart or a
 *           retry resumes exactly where it stopped; state-changing tool calls are keyed by
 *           tool_use id in the effect ledger, so resuming never repeats an effect.
 *   rules — a fixed, deterministic policy, used when no model is configured, when the AI
 *           budget will not cover a task, or for steps that should never use a model.
 *
 * A job never switches brain part-way through.
 */
function createRuntime(app) {
  const { db } = app;
  const getSession = (jobId) => db.get('SELECT * FROM agent_sessions WHERE job_id = ?', jobId);
  const saveSession = (jobId, fields) => db.run(
    `UPDATE agent_sessions SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE job_id = ?`,
    ...Object.values(fields), now(), jobId,
  );

  function startSession(job, agent, action, brain, transcript) {
    db.insertIgnore('agent_sessions', { job_id: job.id, agent: agent.id, action: action.id, brain, transcript: JSON.stringify(transcript), created_at: now(), updated_at: now() });
    return getSession(job.id);
  }

  function chooseBrain(job, agent, action) {
    const existing = getSession(job.id);
    if (existing) return existing.brain;
    if (action.brains.includes('model') && app.agentModel.enabled()) {
      try {
        app.budget.assertAi({ model: app.config.ai.model, inputChars: 30000, maxOutputTokens: 8000, projectId: job.project_id });
        return 'model';
      } catch (err) {
        if (err.kind !== 'budget') throw err;
        db.insert('agent_runs', { job_id: job.id, workflow_id: job.workflow_id, project_id: job.project_id, agent: agent.id, agent_version: agent.version, task: `${agent.id}.${action.id}`, provider: app.agentModel.provider(), model_requested: app.config.ai.model, status: 'budget_blocked', detail: err.message, created_at: now() });
        if (!action.brains.includes('rules')) throw err;
      }
    }
    if (action.brains.includes('rules')) return 'rules';
    throw new FatalError('No model is configured and this action has no rules fallback.');
  }

  // ── rules brain ─────────────────────────────────────────────────────
  async function runRules(ctx) {
    const { job, agent, action, tools } = ctx;
    const policy = POLICIES[agent.id] && POLICIES[agent.id][action.id];
    if (!policy) throw new FatalError(`No rules policy for ${agent.id}.${action.id}`);
    const session = getSession(job.id) || startSession(job, agent, action, 'rules', []);
    const log = JSON.parse(session.transcript);
    const recording = {
      async call(name, args, opts) {
        const result = await tools.call(name, args, opts);
        log.push({ role: 'rules', tool: name, input: args, result: truncate(JSON.stringify(result ?? null), 4000) });
        saveSession(job.id, { transcript: JSON.stringify(log), tool_calls: log.length });
        return result;
      },
    };
    const output = await policy({ ...ctx, tools: recording });
    db.insert('agent_runs', { job_id: job.id, workflow_id: job.workflow_id, project_id: job.project_id, agent: agent.id, agent_version: agent.version, task: `${agent.id}.${action.id}`, provider: 'rules', model_served: 'rules@2', prompt_version: 'rules@2', status: 'ok', detail: `${log.length} tool call(s)`, created_at: now() });
    return output;
  }

  // ── model brain ─────────────────────────────────────────────────────
  function firstMessage(agent, action, job) {
    return {
      role: 'user',
      content: [{ type: 'text', text: `${action.instruction}\n\n<task_input>\n${JSON.stringify(job.input, null, 2)}\n</task_input>\n\nToday is ${new Date(app.orchestrator.clock()).toISOString().slice(0, 10)}.` }],
    };
  }

  /** Stored transcripts keep file references; the bytes are attached only when calling the model. */
  function expand(transcript) {
    return transcript.map((m) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return m;
      return {
        role: 'user',
        content: m.content.map((b) => {
          if (b.type !== 'tool_result' || !Array.isArray(b.content)) return b;
          return {
            ...b,
            content: b.content.map((c) => {
              if (!c._file_id) return c;
              const file = app.files.get(c._file_id);
              const data = fs.readFileSync(app.files.pathOf(file)).toString('base64');
              return { type: c.type, source: { type: 'base64', media_type: c.media_type, data } };
            }),
          };
        }),
      };
    });
  }

  /** After a mid-output fallback, blocks from the declined partial before the boundary are not echoed. */
  function forReplay(content) {
    const boundary = content.map((b) => b.type).lastIndexOf('fallback');
    if (boundary < 0) return content;
    return content.filter((b, i) => i >= boundary || b.type === 'text');
  }

  function resultContent(result) {
    if (result && result.__attachment) {
      const { __attachment: att, ...rest } = result;
      return [{ type: 'text', text: truncate(JSON.stringify(rest), RESULT_LIMIT) }, { type: att.kind, _file_id: att.file_id, media_type: att.media_type }];
    }
    return truncate(typeof result === 'string' ? result : JSON.stringify(result ?? null), RESULT_LIMIT);
  }

  async function executeTools(content, ctx) {
    const { action, tools } = ctx;
    const results = [];
    let final = null;
    let denied = 0;
    const uses = content.filter((b) => b.type === 'tool_use');
    for (const use of uses) {
      if (use.name === 'submit_result') {
        const errors = validate(action.output, use.input);
        if (errors.length) results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `The result does not match the required fields: ${errors.slice(0, 6).join('; ')}` });
        else { final = use.input; results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Result recorded.' }); }
        continue;
      }
      try {
        const out = await tools.call(use.name, use.input, { effectKey: `${use.name}:${use.id}` });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: resultContent(out) });
      } catch (err) {
        const kind = err instanceof HttpError ? (err.status >= 500 ? 'retryable' : 'refused') : classify(err);
        if (kind === 'budget' || kind === 'retryable') throw err; // stop here; a retry resumes this turn and replays any effects
        if (kind === 'permission') denied += 1;
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `${kind === 'permission' ? 'Not permitted' : 'Refused'}: ${err.message}` });
      }
    }
    return { results, final, denied, count: uses.length };
  }

  async function runModel(ctx) {
    const { job, agent, action } = ctx;
    const session = getSession(job.id) || startSession(job, agent, action, 'model', [firstMessage(agent, action, job)]);
    const transcript = JSON.parse(session.transcript);
    let { turns, denied_calls: denied, tool_calls: toolCalls } = session;
    const tools = apiTools(action);
    const promptVersion = sha256(agent.systemPrompt + action.instruction + JSON.stringify(tools)).slice(0, 12);
    const provider = app.agentModel.provider();

    for (;;) {
      const last = transcript[transcript.length - 1];
      if (last.role === 'assistant') {
        const { results, final, denied: d, count } = await executeTools(last.content, ctx);
        denied += d; toolCalls += count;
        transcript.push({ role: 'user', content: results.length ? results : [{ type: 'text', text: NUDGE }] });
        saveSession(job.id, { transcript: JSON.stringify(transcript), denied_calls: denied, tool_calls: toolCalls, ...(final ? { status: 'done', result: JSON.stringify(final) } : {}) });
        if (final) return final;
        if (denied >= MAX_DENIED) throw new PermissionDeniedError(`Stopped after ${denied} refused tool requests.`);
        if (transcript.filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].text === NUDGE).length > MAX_NUDGES) {
          throw new FatalError('The agent stopped without submitting a result.');
        }
        continue;
      }

      if (turns >= action.maxTurns) throw new FatalError(`Turn limit (${action.maxTurns}) reached without a result.`);
      app.budget.assertAi({ model: app.config.ai.model, inputChars: agent.systemPrompt.length + JSON.stringify(transcript).length, maxOutputTokens: 4000, projectId: job.project_id });
      const started = Date.now();
      const run = { job_id: job.id, workflow_id: job.workflow_id, project_id: job.project_id, agent: agent.id, agent_version: agent.version, task: `${agent.id}.${action.id}#${turns + 1}`, provider, model_requested: app.config.ai.model, prompt_version: promptVersion, created_at: now() };
      let response;
      try {
        response = await app.agentModel.call({ system: agent.systemPrompt, tools, messages: expand(transcript), maxTokens: MAX_OUTPUT_TOKENS });
      } catch (err) {
        db.insert('agent_runs', { ...run, status: 'error', detail: String(err.message).slice(0, 300), latency_ms: Date.now() - started });
        if (err.status === 429 || err.status === 408 || err.status === 409 || err.status === 529 || err.status >= 500) throw Object.assign(new Error(`Model temporarily unavailable: ${err.message}`), { kind: 'retryable' });
        throw err;
      }
      const u = response.usage || {};
      const usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
      const cost = app.budget.tokenCostMicros(response.model || app.config.ai.model, usage.input, usage.output, usage);
      const refused = response.stop_reason === 'refusal';
      db.insert('agent_runs', { ...run, model_served: response.model || '', input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, cost_micros: cost, latency_ms: Date.now() - started, status: refused ? 'refused' : 'ok', detail: response.stop_reason || '' });
      turns += 1;
      const content = forReplay(response.content || []);
      transcript.push({ role: 'assistant', content });
      db.run('UPDATE agent_sessions SET transcript = ?, turns = ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_micros = cost_micros + ?, updated_at = ? WHERE job_id = ?',
        JSON.stringify(transcript), turns, usage.input + usage.cacheRead + usage.cacheWrite, usage.output, cost, now(), job.id);
      if (refused) throw new FatalError('The model declined this task; a person needs to handle it.');
      if (response.stop_reason === 'max_tokens' && !content.some((b) => b.type === 'tool_use')) throw new FatalError('The model response was cut off.');
    }
  }

  return {
    chooseBrain,
    async run(ctx) {
      const brain = chooseBrain(ctx.job, ctx.agent, ctx.action);
      ctx.scope.brain = brain === 'rules' ? 'rules' : app.agentModel.provider();
      try {
        return brain === 'model' ? await runModel(ctx) : await runRules(ctx);
      } catch (err) {
        if (getSession(ctx.job.id)) saveSession(ctx.job.id, { status: classify(err) === 'retryable' ? 'waiting_retry' : 'failed' });
        throw err;
      }
    },
    session: getSession,
  };
}

function truncate(s, n) { return s.length > n ? `${s.slice(0, n)}… [truncated]` : s; }

module.exports = { createRuntime, NUDGE };
