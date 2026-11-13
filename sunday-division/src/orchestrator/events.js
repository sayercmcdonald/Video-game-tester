'use strict';
const { now } = require('../lib/util');

/**
 * Durable event log (transactional outbox). Services emit events inside the same
 * transaction as the state change, so an event exists if and only if the change committed.
 * Each event has a dedupe key: emitting the same fact twice records it once.
 * Events are hints to re-evaluate a workflow; the workflow always re-reads the database.
 */
function createEvents({ db }) {
  return {
    emit(type, { inquiryId = null, projectId = null, key = null, ...payload } = {}) {
      return db.insertIgnore('events', {
        type, dedupe_key: key || `${type}:${inquiryId || ''}:${projectId || ''}:${JSON.stringify(payload)}`,
        inquiry_id: inquiryId, project_id: projectId, payload: JSON.stringify(payload), created_at: now(),
      });
    },
    pending: (limit = 50) => db.all('SELECT * FROM events WHERE processed_at IS NULL ORDER BY id LIMIT ?', limit),
    markProcessed: (id) => db.run('UPDATE events SET processed_at = ? WHERE id = ?', now(), id),
    recent: (limit = 30) => db.all('SELECT * FROM events ORDER BY id DESC LIMIT ?', limit),
  };
}

module.exports = { createEvents };
