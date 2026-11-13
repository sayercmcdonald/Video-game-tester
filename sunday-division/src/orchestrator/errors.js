'use strict';

/** Transient failure (network, 5xx, timeout): retried with backoff up to the action's limit. */
class RetryableError extends Error {
  constructor(message) { super(message); this.kind = 'retryable'; }
}
/** Permanent failure: no retry; the workflow is blocked until a person intervenes. */
class FatalError extends Error {
  constructor(message) { super(message); this.kind = 'fatal'; }
}
/** An agent tried to use a tool outside its policy, or data outside its scope. Never retried. */
class PermissionDeniedError extends Error {
  constructor(message) { super(message); this.kind = 'permission'; }
}
/** A spending limit would be exceeded. Never retried automatically. */
class BudgetExceededError extends Error {
  constructor(message) { super(message); this.kind = 'budget'; }
}
/** Not a failure: "check again later" (e.g. polling a long-running external job). */
class Reschedule extends Error {
  constructor(delayMs, message = 'rescheduled') { super(message); this.kind = 'reschedule'; this.delayMs = delayMs; }
}

/** Map an arbitrary error to a kind the runner understands. Unknown errors are retryable once. */
function classify(err) {
  if (err && err.kind) return err.kind;
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'retryable';
  if (err && (err.status >= 500 || [408, 429].includes(err.status))) return 'retryable';
  if (err && err.status >= 400) return 'fatal';
  if (err && /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket/i.test(String(err.message || err.code))) return 'retryable';
  return 'retryable';
}

module.exports = { RetryableError, FatalError, PermissionDeniedError, BudgetExceededError, Reschedule, classify };
