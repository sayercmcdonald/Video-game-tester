'use strict';
const { getAction } = require('../agents/definitions');
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
 * Execute one claimed job: validate its input, bind the agent's tools to the job's subject,
 * run the agent (model or rules brain) with a timeout, validate the result, then record
 * success, a retry or a failure.
 */
async function runJob(app, queue, job, clock) {
  let agent; let action;
  try {
    ({ agent, action } = getAction(job.agent, job.action));
  } catch (err) {
    queue.fail(job, new FatalError(`Unknown agent action ${job.agent}.${job.action}`), 'fatal');
    return 'failed';
  }
  const scope = { agent: agent.id, agentVersion: agent.version, jobId: job.id, workflowId: job.workflow_id, projectId: job.project_id, inquiryId: job.inquiry_id, brain: 'rules' };
  try {
    const inputErrors = validate(action.input, job.input);
    if (inputErrors.length) throw new FatalError(`Invalid job input: ${inputErrors.join('; ')}`);
    // The subject named in the input must be the subject the job is bound to.
    if (job.input.project_id !== undefined && job.input.project_id !== job.project_id) throw new PermissionDeniedError('Job input names a different project from the one it is bound to.');
    if (job.input.inquiry_id !== undefined && job.input.inquiry_id !== job.inquiry_id) throw new PermissionDeniedError('Job input names a different inquiry from the one it is bound to.');

    const tools = bindTools(app, { job, agentDef: agent, actionDef: action, scope });
    const ctx = { app, job, agent, action, input: job.input, tools, scope, now: clock };
    const output = await withTimeout(Promise.resolve().then(() => app.agentRuntime.run(ctx)), action.timeoutMs);
    const outputErrors = validate(action.output, output);
    if (outputErrors.length) throw new FatalError(`Result failed its schema: ${outputErrors.slice(0, 5).join('; ')}`);
    queue.succeed(job, output);
    return 'succeeded';
  } catch (err) {
    if (err && err.kind === 'reschedule') return queue.reschedule(job, err.delayMs, action.maxReschedules || 100);
    const kind = classify(err);
    const outcome = queue.fail(job, err, kind);
    if (outcome === 'failed') {
      app.audit.log(`agent:${agent.id}`, 'job.failed', { entity: 'job', entityId: job.id, projectId: job.project_id, detail: `${agent.id}.${action.id} (${kind}): ${err.message}` });
    }
    if (kind !== 'retryable' || outcome === 'failed') console.error(`[agents] ${agent.id}.${action.id} #${job.id} ${outcome} (${kind}):`, err.message);
    return outcome;
  }
}

module.exports = { runJob };
