'use strict';
/**
 * Studio dashboard helpers on the shared design system (see command-ui.js and public/css/ui.css).
 *
 * Status colour follows the same rule everywhere: sage only for finished / operating states,
 * bone for "a person needs to decide", amber for something that needs attention, clay for
 * failures. Each screen says which of its statuses are waiting on the studio.
 */
const { html, titleCase } = require('../lib/util');
const { StatusPill } = require('./command-ui');

const FAILED = new Set(['failed', 'error', 'denied', 'invalid_output', 'budget_blocked', 'mismatch', 'duplicate']);
const ATTENTION = new Set(['needs_human', 'escalation', 'quote_declined', 'changes_requested']);
const DONE = new Set(['done', 'paid', 'released', 'won', 'published', 'completed', 'accepted', 'succeeded', 'resolved', 'executed', 'signed_off', 'approved']);

/** tone for a status; `waiting` lists the statuses that need a person on this screen. */
function statusTone(status, waiting = new Set()) {
  if (FAILED.has(status)) return 'danger';
  if (ATTENTION.has(status)) return 'attention';
  if (waiting.has(status)) return 'review';
  if (DONE.has(status)) return 'success';
  return 'neutral';
}

/** A status pill for a record. */
const statusBadge = (status, label, waiting) => StatusPill({ tone: statusTone(status, waiting), label: label || titleCase(status) });

/** Development deliveries are always labelled, the same way Command labels sample data. */
const SimulatedPill = () => html`<span class="ui-pill ui-pill--attention" title="Development/test delivery: nothing was actually sent">Simulated</span>`;

module.exports = { statusTone, statusBadge, SimulatedPill };
