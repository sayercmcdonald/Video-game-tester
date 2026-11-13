'use strict';
const { now, str, HttpError, isEmail } = require('../lib/util');

/**
 * Outbound messages to clients and contractors.
 *
 * Agents and staff PREPARE messages; the recipient address is always looked up from the
 * recipient's record, never supplied by an agent. Nothing leaves the studio until a member
 * of staff approves it. Delivery depends on MESSAGING_PROVIDER:
 *   simulated — development and tests only: marked sent, clearly labelled, nothing is sent
 *   manual    — production default: staff send it themselves and mark it sent
 */
function createMessaging(app) {
  const { db, config } = app;
  const provider = config.messaging.provider;

  function recipient(type, id) {
    const row = type === 'client' ? db.get('SELECT id, email, contact_name AS name FROM clients WHERE id = ?', id)
      : type === 'contractor' ? db.get('SELECT id, email, name FROM contractors WHERE id = ?', id) : null;
    if (!row) throw new HttpError(400, 'Unknown message recipient.');
    if (!isEmail(row.email || '')) throw new HttpError(400, `${row.name} has no valid email address on file.`);
    return row;
  }
  const get = (id) => db.get('SELECT * FROM messages WHERE id = ?', id);

  function deliver(message, user) {
    if (provider === 'simulated') {
      db.update('messages', message.id, { status: 'sent', channel: 'simulated', provider_ref: `SIMULATED-${message.id}`, sent_at: now() });
      app.audit.log(`staff:${user.email}`, 'message.sent_simulated', { entity: 'message', entityId: message.id, projectId: message.project_id, detail: `${message.purpose} → ${message.recipient_type} (simulated, not delivered)` });
      app.events.emit('message.sent', { projectId: message.project_id, messageId: message.id, key: `message.sent:${message.id}` });
      return 'simulated';
    }
    app.humanTasks.create({
      projectId: message.project_id, kind: 'communication', key: `send_message:m${message.id}`, createdBy: 'system:messaging',
      title: `Send approved message: ${message.subject}`, detail: `To ${message.to_address}. Copy it from the outbox, send it, then mark it sent.`, link: `/admin/messages#m${message.id}`,
    });
    return 'manual';
  }

  return {
    provider,
    get,
    list: (status) => db.all(`SELECT m.*, p.code AS project_code FROM messages m LEFT JOIN projects p ON p.id = m.project_id ${status ? 'WHERE m.status = ?' : ''} ORDER BY m.id DESC LIMIT 200`, ...(status ? [status] : [])),
    forProject: (projectId) => db.all('SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC', projectId),
    forAssignment: (assignmentId) => db.all('SELECT * FROM messages WHERE assignment_id = ? ORDER BY id', assignmentId),

    prepare({ projectId = null, assignmentId = null, recipientType, recipientId, purpose, subject, body, preparedBy }) {
      const r = recipient(recipientType, recipientId);
      const text = str(body, 6000);
      if (!text) throw new HttpError(400, 'A message needs a body.');
      const id = db.insert('messages', {
        project_id: projectId, assignment_id: assignmentId, recipient_type: recipientType, recipient_id: r.id, to_address: r.email,
        purpose: str(purpose, 40), subject: str(subject, 200) || 'Sunday Division', body: text, prepared_by: preparedBy, created_at: now(),
      });
      app.audit.log(preparedBy, 'message.prepared', { entity: 'message', entityId: id, projectId, detail: `${purpose} → ${recipientType}` });
      return id;
    },

    /** Staff approval gate. Returns how it was delivered: 'simulated' or 'manual'. */
    approveAndSend(id, user, { body } = {}) {
      const m = get(id);
      if (!m) throw new HttpError(404, 'Message not found.');
      if (m.status !== 'draft') throw new HttpError(409, 'Only draft messages can be approved.');
      if (body !== undefined) {
        const text = str(body, 6000);
        if (!text) throw new HttpError(400, 'A message needs a body.');
        db.update('messages', id, { body: text });
      }
      return db.tx(() => {
        db.update('messages', id, { status: 'approved', approved_by: user.id, approved_at: now(), channel: provider });
        app.audit.log(`staff:${user.email}`, 'message.approved', { entity: 'message', entityId: id, projectId: m.project_id, detail: m.purpose });
        return deliver(get(id), user);
      });
    },
    markSentManually(id, user) {
      const m = get(id);
      if (!m || m.status !== 'approved' || m.channel !== 'manual') throw new HttpError(409, 'Only approved manual messages can be marked sent.');
      db.tx(() => {
        db.update('messages', id, { status: 'sent', sent_at: now(), provider_ref: `manual:${user.email}` });
        app.events.emit('message.sent', { projectId: m.project_id, messageId: id, key: `message.sent:${id}` });
      });
      app.humanTasks.resolveKey(null, `send_message:m${id}`, `staff:${user.email}`);
      app.audit.log(`staff:${user.email}`, 'message.sent_manually', { entity: 'message', entityId: id, projectId: m.project_id });
    },
    discard(id, user) {
      const m = get(id);
      if (!m || m.status !== 'draft') throw new HttpError(409, 'Only draft messages can be discarded.');
      db.update('messages', id, { status: 'discarded' });
      app.audit.log(`staff:${user.email}`, 'message.discarded', { entity: 'message', entityId: id, projectId: m.project_id });
    },
  };
}

module.exports = { createMessaging };
