'use strict';
const { getAction } = require('../agents/definitions');
const { safeJson } = require('../lib/util');

/**
 * Durable job queue on SQLite. A job is one agent action for one subject.
 *  - idempotency_key is unique: ensure() returns the existing job instead of a duplicate
 *  - dependencies: a job is claimable only when every job it depends on has succeeded
 *  - leases: a running job holds a lease; an expired lease (crashed worker) puts it back
 *  - retries: exponential backoff per the action's policy; permanent failures stop
 */
function createQueue(app, clock) {
  const { db } = app;
  const iso = (ms) => new Date(ms).toISOString();
  const hydrate = (j) => (j ? { ...j, input: safeJson(j.input, {}), output: safeJson(j.output, null) } : null);
  const get = (id) => hydrate(db.get('SELECT * FROM jobs WHERE id = ?', id));

  function backoffMs(policy, attempts) {
    return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempts - 1));
  }

  return {
    get,
    byKey: (key) => hydrate(db.get('SELECT * FROM jobs WHERE idempotency_key = ?', key)),
    forWorkflow: (wfId) => db.all('SELECT * FROM jobs WHERE workflow_id = ? ORDER BY id', wfId).map(hydrate),
    dependencies: (jobId) => db.all('SELECT depends_on FROM job_dependencies WHERE job_id = ?', jobId).map((r) => r.depends_on),

    /** Create the job for this key unless it already exists. Returns the job either way. */
    ensure({ key, agent, action, input, workflowId = null, projectId = null, inquiryId = null, dependsOn = [], priority = 0, runAt = null }) {
      const existing = db.get('SELECT * FROM jobs WHERE idempotency_key = ?', key);
      if (existing) return hydrate(existing);
      const { action: def } = getAction(agent, action);
      return db.tx(() => {
        const id = db.insertIgnore('jobs', {
          workflow_id: workflowId, project_id: projectId, inquiry_id: inquiryId, agent, action, idempotency_key: key,
          status: 'queued', priority, max_attempts: def.retry.maxAttempts, run_at: iso(runAt ?? clock()),
          input: JSON.stringify(input), created_at: iso(clock()),
        });
        if (!id) return hydrate(db.get('SELECT * FROM jobs WHERE idempotency_key = ?', key));
        for (const dep of dependsOn) db.insertIgnore('job_dependencies', { job_id: id, depends_on: dep });
        return get(id);
      });
    },

    /** Atomically take up to `limit` runnable jobs and lease them. */
    claim(limit, leaseMs) {
      const t = iso(clock());
      return db.tx(() => {
        const rows = db.all(`
          SELECT j.id FROM jobs j
          LEFT JOIN workflows w ON w.id = j.workflow_id
          WHERE j.status = 'queued' AND j.run_at <= ? AND COALESCE(w.paused, 0) = 0
            AND NOT EXISTS (SELECT 1 FROM job_dependencies d JOIN jobs p ON p.id = d.depends_on
                            WHERE d.job_id = j.id AND p.status NOT IN ('succeeded','cancelled'))
          ORDER BY j.priority DESC, j.run_at, j.id LIMIT ?`, t, limit);
        return rows.map(({ id }) => {
          db.run("UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, started_at = ? WHERE id = ? AND status = 'queued'",
            iso(clock() + leaseMs), t, id);
          return get(id);
        });
      });
    },

    succeed(job, output) {
      db.run("UPDATE jobs SET status = 'succeeded', output = ?, error = NULL, error_kind = NULL, lease_until = NULL, finished_at = ? WHERE id = ? AND status = 'running'",
        JSON.stringify(output), iso(clock()), job.id);
    },

    /** Record a failure; returns 'retry' or 'failed'. */
    fail(job, err, kind) {
      const { action: def } = getAction(job.agent, job.action);
      const retry = kind === 'retryable' && job.attempts < job.max_attempts;
      if (retry) {
        db.run("UPDATE jobs SET status = 'queued', run_at = ?, error = ?, error_kind = ?, lease_until = NULL WHERE id = ? AND status = 'running'",
          iso(clock() + backoffMs(def.retry, job.attempts)), String(err.message).slice(0, 1000), kind, job.id);
        return 'retry';
      }
      db.run("UPDATE jobs SET status = 'failed', error = ?, error_kind = ?, lease_until = NULL, finished_at = ? WHERE id = ? AND status = 'running'",
        String(err.message).slice(0, 1000), kind, iso(clock()), job.id);
      return 'failed';
    },

    /** "Not yet" — wait and run again without consuming an attempt. */
    reschedule(job, delayMs, maxReschedules) {
      if (job.reschedules + 1 > maxReschedules) {
        db.run("UPDATE jobs SET status = 'failed', error = 'Gave up waiting for the external service.', error_kind = 'fatal', lease_until = NULL, finished_at = ? WHERE id = ?", iso(clock()), job.id);
        return 'failed';
      }
      db.run("UPDATE jobs SET status = 'queued', attempts = attempts - 1, reschedules = reschedules + 1, run_at = ?, lease_until = NULL, error = NULL WHERE id = ? AND status = 'running'",
        iso(clock() + delayMs), job.id);
      return 'rescheduled';
    },

    /** Crash recovery: running jobs whose lease ran out go back to the queue (the attempt counts). */
    recoverExpired({ all = false } = {}) {
      const t = iso(clock());
      const rows = db.all(`SELECT * FROM jobs WHERE status = 'running' ${all ? '' : 'AND lease_until < ?'}`, ...(all ? [] : [t]));
      for (const j of rows) {
        if (j.attempts >= j.max_attempts) {
          db.run("UPDATE jobs SET status = 'failed', error = 'Worker stopped while running this job (no attempts left).', error_kind = 'fatal', lease_until = NULL, finished_at = ? WHERE id = ?", t, j.id);
        } else {
          db.run("UPDATE jobs SET status = 'queued', run_at = ?, error = 'Recovered after the worker stopped mid-run.', error_kind = 'retryable', lease_until = NULL WHERE id = ?", t, j.id);
        }
      }
      return rows.map((r) => r.workflow_id).filter(Boolean);
    },

    /** Staff: run a failed job again with a fresh set of attempts. */
    retry(jobId) {
      const job = get(jobId);
      if (!job || !['failed', 'cancelled'].includes(job.status)) return null;
      const { action: def } = getAction(job.agent, job.action);
      db.run("UPDATE jobs SET status = 'queued', max_attempts = attempts + ?, reschedules = 0, run_at = ?, error = NULL, error_kind = NULL, finished_at = NULL WHERE id = ?",
        def.retry.maxAttempts, iso(clock()), jobId);
      return get(jobId);
    },
    cancel(jobId) {
      db.run("UPDATE jobs SET status = 'cancelled', lease_until = NULL, finished_at = ? WHERE id = ? AND status IN ('queued','failed')", iso(clock()), jobId);
      return get(jobId);
    },
    cancelOpenForWorkflow(wfId) {
      db.run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE workflow_id = ? AND status IN ('queued','failed')", iso(clock()), wfId);
    },
    nextRunAt: () => (db.get("SELECT MIN(run_at) AS t FROM jobs WHERE status = 'queued'") || {}).t,
  };
}

module.exports = { createQueue };
