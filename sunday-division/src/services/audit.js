'use strict';
const { now, str } = require('../lib/util');

/** Append-only record of who did what — especially approvals and money. */
function createAudit({ db }) {
  return {
    log(actor, action, { entity = '', entityId = null, projectId = null, detail = '' } = {}) {
      db.insert('audit_log', {
        actor: str(actor, 120), action, entity, entity_id: entityId, project_id: projectId,
        detail: str(detail, 1000), created_at: now(),
      });
    },
    forProject: (projectId, limit = 40) =>
      db.all('SELECT * FROM audit_log WHERE project_id = ? ORDER BY id DESC LIMIT ?', projectId, limit),
    recent: (limit = 15) => db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit),
  };
}

module.exports = { createAudit };
