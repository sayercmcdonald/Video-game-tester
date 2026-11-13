'use strict';
const { createQueue } = require('./queue');
const { createWorkflowEngine } = require('./workflow');
const { runJob } = require('./runner');

/**
 * In-process orchestrator for a single-instance deployment. All state is in SQLite, so a
 * restart loses nothing: running jobs are re-queued at boot, unprocessed events are picked
 * up, and the periodic sweep re-evaluates every active workflow.
 */
function createOrchestrator(app) {
  const { config } = app;
  const opts = config.orchestrator;
  const clockState = { offsetMs: 0 };
  const clock = () => Date.now() + clockState.offsetMs;
  const queue = createQueue(app, clock);
  const engine = createWorkflowEngine(app, { queue, clock });
  let timer = null;
  let ticking = false;
  let lastSweep = 0;
  const inflight = new Set();

  const globallyPaused = () => app.settings.get('orchestrator_paused');

  function processEvents() {
    if (globallyPaused()) return 0;
    const events = app.events.pending(100);
    for (const ev of events) {
      try {
        if (ev.type === 'inquiry.received') engine.start(ev.inquiry_id);
        if (ev.type === 'payment.exception') {
          const payload = JSON.parse(ev.payload);
          app.humanTasks.create({ projectId: ev.project_id, kind: 'escalation', key: `payment_exception:p${payload.paymentId}`, createdBy: 'agent:finance_ops', title: `Payment needs review: ${payload.status} on ${payload.invoice}`, detail: payload.note || '', link: `/admin/projects/${ev.project_id}#billing` });
        }
        const wf = engine.findFor(ev);
        if (wf) engine.advance(wf.id);
        if (app.command) app.command.onEvent(ev);
      } catch (err) {
        console.error(`[orchestrator] event ${ev.type} #${ev.id} failed:`, err);
        app.audit.log('system', 'orchestrator.event_error', { entity: 'event', entityId: ev.id, projectId: ev.project_id, detail: `${ev.type}: ${err.message}` });
      }
      app.events.markProcessed(ev.id);
    }
    return events.length;
  }

  async function execute(job) {
    await runJob(app, queue, job, clock);
    if (app.command) {
      try { app.command.afterJob(queue.get(job.id)); } catch (err) { console.error('[orchestrator] command hook failed:', err); }
    }
    if (job.workflow_id) {
      try { engine.advance(job.workflow_id); } catch (err) { console.error('[orchestrator] advance failed:', err); }
    }
  }

  function sweep() {
    for (const wf of engine.active()) {
      try { engine.advance(wf.id); } catch (err) { console.error(`[orchestrator] sweep of workflow ${wf.id} failed:`, err); }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const wfId of queue.recoverExpired()) engine.advance(wfId);
      if (globallyPaused()) return;
      processEvents();
      if (app.command) app.command.tick();
      if (clock() - lastSweep > opts.sweepMs) { lastSweep = clock(); sweep(); }
      const free = opts.concurrency - inflight.size;
      if (free > 0) {
        for (const job of queue.claim(free, opts.leaseMs)) {
          const p = execute(job).finally(() => inflight.delete(p));
          inflight.add(p);
        }
      }
    } catch (err) {
      console.error('[orchestrator] tick failed:', err);
    } finally {
      ticking = false;
    }
  }

  return {
    queue, engine, clock, clockState,
    STATES: engine.STATES,
    processEvents,
    sweep,
    start() {
      // Single instance: anything still "running" at boot was interrupted by the restart.
      for (const wfId of queue.recoverExpired({ all: true })) engine.advance(wfId);
      if (opts.pollMs > 0 && !timer) {
        timer = setInterval(tick, opts.pollMs);
        timer.unref();
      }
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.allSettled([...inflight]);
    },
    /** Run until there is nothing runnable now (tests and manual "run now"). */
    async drain({ maxRounds = 500 } = {}) {
      for (let i = 0; i < maxRounds; i++) {
        if (globallyPaused()) return;
        const processed = processEvents();
        const jobs = queue.claim(opts.concurrency, opts.leaseMs);
        if (!jobs.length && !processed) return;
        await Promise.all(jobs.map(execute));
      }
    },
    retryJob(jobId, user) {
      const job = queue.retry(jobId);
      if (!job) return null;
      app.audit.log(`staff:${user.email}`, 'job.retried', { entity: 'job', entityId: jobId, projectId: job.project_id, detail: `${job.agent}.${job.action}` });
      if (job.workflow_id) engine.advance(job.workflow_id);
      return job;
    },
    cancelJob(jobId, user) {
      const job = queue.cancel(jobId);
      app.audit.log(`staff:${user.email}`, 'job.cancelled', { entity: 'job', entityId: jobId, projectId: job && job.project_id });
      if (job && job.workflow_id) engine.advance(job.workflow_id);
      return job;
    },
  };
}

module.exports = { createOrchestrator };
