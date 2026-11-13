'use strict';
const { getAction } = require('../agents/definitions');
const { HANDLERS } = require('../agents/handlers');
const { bindTools } = require('../agents/tools');
const { validate } = require('../lib/schema');
const { FatalError, PermissionDeniedError, classify } = require('./errors');

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`Timed out after ${ms} ms`), { kind: 'retryable' })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Execute one claimed job: validate its input against the action's schema, bind the
 * agent's tools to the job's subject, run the handler with a timeout, validate the output,
 * then record success, retry or failure.
 */
async function runJob(app, queue, job, clock) {
  const { agent, action } = getAction(job.agent, job.action);
  const handler = HANDLERS[agent.id] && HANDLERS[agent.id][action.id];
  const scope = { agent: agent.id, agentVersion: agent.version, jobId: job.id, workflowId: job.workflow_id, projectId: job.project_id, inquiryId: job.inquiry_id };
  try {
    if (!handler) throw new FatalError(`No handler for ${agent.id}.${action.id}`);
    const inputErrors = validate(action.input, job.input);
    if (inputErrors.length) throw new FatalError(`Invalid job input: ${inputErrors.join('; ')}`);
    // The subject named in the input must be the subject the job is bound to.
    if (job.input.project_id !== undefined && job.input.project_id !== job.project_id) throw new PermissionDeniedError('Job input names a different project from the one it is bound to.');
    if (job.input.inquiry_id !== undefined && job.input.inquiry_id !== job.inquiry_id) throw new PermissionDeniedError('Job input names a different inquiry from the one it is bound to.');

    const tools = bindTools(app, { job, agentDef: agent, actionDef: action, scope, aiMeta: { agent: agent.id, agentVersion: agent.version, jobId: job.id, workflowId: job.workflow_id, projectId: job.project_id } });
    const output = await withTimeout(Promise.resolve().then(() => handler({ input: job.input, tools, job, now: clock })), action.timeoutMs);
    const outputErrors = validate(action.output, output);
    if (outputErrors.length) throw new FatalError(`Output failed its schema: ${outputErrors.slice(0, 5).join('; ')}`);
    queue.succeed(job, output);
    return 'succeeded';
  } catch (err) {
    if (err && err.kind === 'reschedule') return queue.reschedule(job, err.delayMs, action.maxReschedules || 100);
    const kind = classify(err);
    const outcome = queue.fail(job, err, kind);
    if (outcome === 'failed') {
      app.audit.log(`agent:${agent.id}`, 'job.failed', { entity: 'job', entityId: job.id, projectId: job.project_id, detail: `${agent.id}.${action.id} (${kind}): ${err.message}` });
    }
    if (kind !== 'retryable' || outcome === 'failed') console.error(`[orchestrator] ${agent.id}.${action.id} #${job.id} ${outcome} (${kind}):`, err.message);
    return outcome;
  }
}

module.exports = { runJob };
