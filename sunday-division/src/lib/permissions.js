'use strict';
/**
 * Who may do what — one table, enforced on the server in the service functions themselves, so the
 * studio dashboard, the inbox, Command and anything added later all pass through the same check.
 * Hiding a button is a courtesy; this is the control.
 *
 * Roles are flags on the user row, read fresh from the database for every check (a role removed
 * a minute ago does not linger in a session):
 *   founder              set only on the server (FOUNDER_EMAIL or `npm run founder`), never from the web
 *   studio_manager       granted by the founder in Command → Settings → Team (previewed, confirmed, audited)
 *   technical_reviewer   granted the same way; qualifies a person to sign off technical files
 *
 * Agents have no user row. Every check below needs one, so no agent can pass any of them —
 * agents cannot approve their own outputs, override a payment gate, change permissions or
 * release final deliverables, whatever a tool or a prompt asks for.
 */
const { HttpError } = require('./util');

const POLICY = {
  // Founder only
  'payment.record_manual': { roles: ['founder'], label: 'Recording a payment made outside checkout', deny: 'Only the founder can record a payment made outside checkout.' },
  'payment.override': { roles: ['founder'], label: 'Overriding a payment gate', deny: 'Only the founder can override a payment gate.' },
  'deliverable.release_final': { roles: ['founder'], label: 'Releasing final files', deny: 'Only the founder can release final files to a client.' },
  'permissions.change': { roles: ['founder'], label: 'Changing roles or agent permissions', deny: 'Only the founder can change roles or agent permissions.' },
  'agents.limits': { roles: ['founder'], label: 'Changing agent spending limits', deny: 'Only the founder can change agent spending limits.' },
  // Founder or studio manager
  'client.send': { roles: ['founder', 'studio_manager'], label: 'Sending quotes, invoices and messages to clients or contractors', deny: 'Sending to a client or contractor needs the founder or a studio manager. You can still prepare the draft.' },
  'project.complete': { roles: ['founder', 'studio_manager'], label: 'Commercial completion of a project', deny: 'Closing a project needs the founder or a studio manager.' },
  // Qualified technical reviewer
  'spec.technical_approve': { roles: ['technical_reviewer'], label: 'Signing off technical files', deny: 'Technical sign-off needs a member of staff marked as a technical reviewer.' },
};

const ROLE_LABEL = { founder: 'Founder', studio_manager: 'Studio manager', technical_reviewer: 'Technical reviewer' };

/** Pure check against a user row's flags (for views; the server re-reads the row in authorize). */
function can(user, perm) {
  const p = POLICY[perm];
  if (!p) throw new Error(`Unknown permission ${perm}`);
  return Boolean(user && user.id) && p.roles.some((r) => Boolean(user[r]));
}

function createPermissions(app) {
  return {
    POLICY, ROLE_LABEL, can,
    /** The user's current row, or null for anything that is not a real, existing account (agents, systems). */
    current(user) {
      if (!user || !Number.isInteger(user.id)) return null;
      return app.db.get('SELECT id, email, name, founder, studio_manager, technical_reviewer FROM users WHERE id = ?', user.id) || null;
    },
    /** Throws 403 and records the attempt unless the user holds a role the policy allows. */
    authorize(user, perm, { entity = '', entityId = null, projectId = null } = {}) {
      const row = this.current(user);
      if (row && can(row, perm)) return row;
      const who = row ? `staff:${row.email}` : user && user.email ? String(user.email) : 'unknown';
      app.audit.log(who, 'permission.denied', { entity, entityId, projectId, detail: perm });
      throw new HttpError(403, POLICY[perm].deny);
    },
  };
}

module.exports = { createPermissions, can, POLICY, ROLE_LABEL };
