'use strict';
const { now, str, isDate, HttpError } = require('../lib/util');
const catalog = require('./catalog');

const OPEN = ['recommended', 'offered', 'accepted', 'submitted', 'changes_requested'];
const CLOSED = ['rejected', 'declined', 'cancelled'];

/**
 * Contractor assignments for production tasks.
 *
 *   recommended ──staff approves──► offered ──contractor accepts──► accepted ──contractor submits──► submitted
 *        │                            │                                                              │
 *   staff rejects                contractor declines                         QA, then staff technical sign-off
 *        ▼                            ▼                                                              ▼
 *     rejected                     declined                                        signed_off (or changes_requested)
 *
 * An agent can only create "recommended" rows. Offering work to a contractor (and the message
 * that goes with it) needs a member of staff. Only the contractor can accept, decline or submit.
 */
function createAssignments(app) {
  const { db, config } = app;
  const get = (id) => db.get('SELECT * FROM assignments WHERE id = ?', id);
  function mustGet(id) {
    const a = get(id);
    if (!a) throw new HttpError(404, 'Assignment not found.');
    return a;
  }
  const emit = (type, a, extra = '') => app.events.emit(type, { projectId: a.project_id, assignmentId: a.id, key: `${type}:${a.id}${extra}` });
  const task = (id) => db.get('SELECT * FROM tasks WHERE id = ?', id);
  const money = (c) => `$${(c / 100).toFixed(2)}`;

  function offerMessage(a, contractor, project, t) {
    const label = (catalog.JOB_TYPES[t.job_type] || { label: t.title }).label;
    return {
      subject: `New assignment offer: ${label} for ${project.code}`,
      body: [
        `Hello ${contractor.name},`,
        '',
        `Sunday Division would like to offer you an assignment: ${t.title} (${project.code}).`,
        '',
        `Fee: ${money(a.fee_cents)} for an estimated ${a.estimated_hours} hours at ${money(contractor.hourly_rate_cents)}/hour.`,
        a.due_date ? `Due: ${a.due_date}.` : 'Due date: to be agreed.',
        '',
        a.rationale ? `Why we thought of you: ${a.rationale}` : '',
        '',
        `Read the technical brief and accept or decline in the contractor portal: ${config.baseUrl}/contractor`,
        'Please do not start work until you have accepted the assignment in the portal.',
        '',
        'Sunday Division',
      ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n'),
    };
  }

  return {
    OPEN, CLOSED, get, mustGet,
    forProject: (projectId) => db.all(`SELECT a.*, c.name AS contractor_name, t.title AS task_title, t.job_type FROM assignments a
      JOIN contractors c ON c.id = a.contractor_id JOIN tasks t ON t.id = a.task_id WHERE a.project_id = ? ORDER BY a.id`, projectId),
    forContractor: (contractorId) => db.all(`SELECT a.*, t.title AS task_title, t.job_type, t.brief, t.checklist, p.code AS project_code, p.name AS project_name
      FROM assignments a JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = a.project_id
      WHERE a.contractor_id = ? AND a.status IN ('offered','accepted','submitted','changes_requested','signed_off') ORDER BY a.id DESC`, contractorId),
    openForTask: (taskId) => db.get(`SELECT * FROM assignments WHERE task_id = ? AND status IN (${OPEN.map(() => '?').join(',')}) ORDER BY id DESC`, taskId, ...OPEN),
    closedForTask: (taskId) => db.all(`SELECT * FROM assignments WHERE task_id = ? AND status IN (${CLOSED.map(() => '?').join(',')})`, taskId, ...CLOSED),
    signedOffForTask: (taskId) => db.get("SELECT * FROM assignments WHERE task_id = ? AND status = 'signed_off'", taskId),

    /** Agent tool: record a recommendation. Every condition is checked here, not trusted from the agent. */
    recommend({ taskId, contractorId, estimatedHours, rationale, recommendedBy }) {
      const t = task(taskId);
      if (!t || t.kind !== 'production' || t.route !== 'contractor') throw new HttpError(409, 'This task is not routed to a contractor.');
      const project = app.projects.mustGet(t.project_id);
      app.projects.requireWorkUnlocked(project);
      if (this.openForTask(taskId)) throw new HttpError(409, 'This task already has an open assignment.');
      if (this.signedOffForTask(taskId)) throw new HttpError(409, 'This task is already signed off.');
      const c = app.contractors.get(contractorId);
      if (!c || c.status !== 'approved') throw new HttpError(409, 'Only approved contractors can be recommended.');
      if (!c.skills.includes(t.job_type)) throw new HttpError(409, `${c.name} is not approved for ${t.job_type}.`);
      if (this.closedForTask(taskId).some((a) => a.contractor_id === c.id)) throw new HttpError(409, `${c.name} already declined or was rejected for this task.`);
      if (app.contractors.load(c.id) >= c.capacity) throw new HttpError(409, `${c.name} is at capacity.`);
      const hours = Math.round(Number(estimatedHours) * 2) / 2;
      if (!(hours >= 0.5 && hours <= 200)) throw new HttpError(400, 'Estimated hours must be between 0.5 and 200.');
      const id = db.tx(() => {
        const newId = db.insert('assignments', {
          project_id: t.project_id, task_id: t.id, contractor_id: c.id, status: 'recommended', estimated_hours: hours,
          fee_cents: Math.round(hours * c.hourly_rate_cents), due_date: t.due_date, rationale: str(rationale, 600), recommended_by: recommendedBy, created_at: now(),
        });
        app.events.emit('assignment.recommended', { projectId: t.project_id, assignmentId: newId, key: `assignment.recommended:${newId}` });
        return newId;
      });
      app.audit.log(recommendedBy, 'assignment.recommended', { entity: 'assignment', entityId: id, projectId: t.project_id, detail: `${c.name} · ${hours}h` });
      return id;
    },

    /** Staff approval: offers the work and sends the offer message (one decision, one audit entry each). */
    approve(id, user, { feeCents, dueDate } = {}) {
      const a = mustGet(id);
      if (a.status !== 'recommended') throw new HttpError(409, 'Only recommended assignments can be approved.');
      const c = app.contractors.get(a.contractor_id);
      if (!c || c.status !== 'approved') throw new HttpError(409, 'This contractor is no longer approved.');
      const project = app.projects.mustGet(a.project_id);
      const t = task(a.task_id);
      return db.tx(() => {
        db.update('assignments', id, {
          status: 'offered', decided_by: user.id, decided_at: now(), offered_at: now(),
          fee_cents: feeCents > 0 ? feeCents : a.fee_cents, due_date: isDate(dueDate) ? dueDate : a.due_date,
        });
        db.update('tasks', t.id, { contractor_id: c.id });
        const offer = offerMessage(get(id), c, project, t);
        const messageId = app.messaging.prepare({ projectId: a.project_id, assignmentId: id, recipientType: 'contractor', recipientId: c.id, purpose: 'assignment_offer', ...offer, preparedBy: `staff:${user.email}` });
        const delivery = app.messaging.approveAndSend(messageId, user);
        emit('assignment.offered', a);
        app.audit.log(`staff:${user.email}`, 'assignment.approved', { entity: 'assignment', entityId: id, projectId: a.project_id, detail: `${c.name} · ${money(get(id).fee_cents)} · offer ${delivery}` });
        return { messageId, delivery };
      });
    },
    reject(id, user, note) {
      const a = mustGet(id);
      if (a.status !== 'recommended') throw new HttpError(409, 'Only recommended assignments can be rejected.');
      db.tx(() => {
        db.update('assignments', id, { status: 'rejected', decided_by: user.id, decided_at: now(), decision_note: str(note, 500) });
        emit('assignment.rejected', a);
      });
      app.audit.log(`staff:${user.email}`, 'assignment.rejected', { entity: 'assignment', entityId: id, projectId: a.project_id, detail: str(note, 200) });
    },
    cancel(id, user) {
      const a = mustGet(id);
      if (!['offered', 'accepted', 'changes_requested'].includes(a.status)) throw new HttpError(409, 'This assignment cannot be cancelled now.');
      db.tx(() => { db.update('assignments', id, { status: 'cancelled', decided_at: now() }); emit('assignment.cancelled', a); });
      app.audit.log(`staff:${user.email}`, 'assignment.cancelled', { entity: 'assignment', entityId: id, projectId: a.project_id });
    },

    /** Contractor action in the portal. Never performed by an agent. */
    respond(id, contractorId, { accept, note }) {
      const a = mustGet(id);
      if (a.contractor_id !== contractorId) throw new HttpError(404, 'Assignment not found.');
      if (a.status !== 'offered') throw new HttpError(409, 'This offer is no longer open.');
      const status = accept ? 'accepted' : 'declined';
      db.tx(() => {
        db.update('assignments', id, { status, responded_at: now(), response_note: str(note, 1000) });
        if (!accept) db.update('tasks', a.task_id, { contractor_id: null });
        else db.update('tasks', a.task_id, { status: 'doing' });
        emit(`assignment.${status}`, a);
      });
      app.audit.log(`contractor:${contractorId}`, `assignment.${status}`, { entity: 'assignment', entityId: id, projectId: a.project_id, detail: str(note, 200) });
    },
    /** Contractor upload: becomes a new version of the task's deliverable, in review. */
    submit(id, contractorId, upload, note) {
      const a = mustGet(id);
      if (a.contractor_id !== contractorId) throw new HttpError(404, 'Assignment not found.');
      if (!['accepted', 'changes_requested'].includes(a.status)) throw new HttpError(409, 'Accept the assignment before submitting work.');
      if (!upload || !upload.data.length) throw new HttpError(400, 'Choose a file to submit.');
      if (upload.data.length > app.config.limits.adminFileBytes) throw new HttpError(413, 'Files are limited to 50 MB.');
      const t = task(a.task_id);
      const spec = catalog.JOB_TYPES[t.job_type] || { deliverable: 'other' };
      const deliverableId = db.tx(() => {
        let d = db.get('SELECT * FROM deliverables WHERE task_id = ? ORDER BY id DESC', t.id);
        if (!d) {
          const newId = app.projects.addDeliverable(a.project_id, { title: t.title, type: spec.deliverable, stage: 'final', notes: '' }, { actor: `contractor:${contractorId}` });
          db.update('deliverables', newId, { task_id: t.id });
          d = db.get('SELECT * FROM deliverables WHERE id = ?', newId);
        }
        db.update('deliverables', d.id, { assignment_id: a.id, notes: `Submitted by contractor. ${str(note, 1500)}`.trim() });
        const fileId = app.files.storeStaffUpload(upload, { projectId: a.project_id, kind: 'deliverable', uploadedBy: `contractor:${contractorId}` });
        app.projects.attachDeliverableFile(d.id, fileId, `contractor:${contractorId}`);
        db.update('assignments', id, { status: 'submitted', submitted_at: now(), submission_note: str(note, 1500) });
        db.update('tasks', t.id, { status: 'review' });
        emit('assignment.submitted', a, `:${Date.now()}`);
        return d.id;
      });
      app.audit.log(`contractor:${contractorId}`, 'assignment.submitted', { entity: 'assignment', entityId: id, projectId: a.project_id, detail: upload.filename });
      return deliverableId;
    },
    /** Staff: send the work back with notes. The message is part of the same decision. */
    requestChanges(id, user, notes) {
      const a = mustGet(id);
      if (a.status !== 'submitted') throw new HttpError(409, 'Only submitted work can be sent back.');
      const text = str(notes, 3000);
      if (text.length < 5) throw new HttpError(400, 'Describe the changes needed.');
      const t = task(a.task_id);
      const project = app.projects.mustGet(a.project_id);
      db.tx(() => {
        db.update('assignments', id, { status: 'changes_requested' });
        db.update('tasks', t.id, { status: 'doing' });
        const messageId = app.messaging.prepare({ projectId: a.project_id, assignmentId: id, recipientType: 'contractor', recipientId: a.contractor_id, purpose: 'changes_requested', subject: `Changes requested: ${t.title} (${project.code})`, body: `Thank you for your submission. Please make these changes and resubmit in the contractor portal:\n\n${text}\n\n${config.baseUrl}/contractor`, preparedBy: `staff:${user.email}` });
        app.messaging.approveAndSend(messageId, user);
        emit('assignment.changes_requested', a, `:${Date.now()}`);
      });
      app.audit.log(`staff:${user.email}`, 'assignment.changes_requested', { entity: 'assignment', entityId: id, projectId: a.project_id });
    },
    /** Called when a reviewer signs off the deliverable a contractor submitted. */
    onDeliverableApproved(deliverable, user) {
      if (!deliverable.assignment_id) {
        if (deliverable.task_id) db.run("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND status != 'done'", now(), deliverable.task_id);
        return;
      }
      const a = get(deliverable.assignment_id);
      if (!a || a.status !== 'submitted') return;
      const c = app.contractors.get(a.contractor_id);
      db.update('assignments', a.id, { status: 'signed_off', signed_off_at: now() });
      db.update('tasks', a.task_id, { status: 'done', completed_at: now() });
      // Internal cost record for profitability. No payment is made by the system.
      db.insert('costs', { project_id: a.project_id, contractor_id: a.contractor_id, description: `Contractor fee — ${c ? c.name : 'contractor'} (${task(a.task_id).title}); pay outside the system`, hours: a.estimated_hours, amount_cents: a.fee_cents, created_at: now() });
      emit('assignment.signed_off', a);
      app.audit.log(`staff:${user.email}`, 'assignment.signed_off', { entity: 'assignment', entityId: a.id, projectId: a.project_id });
    },
  };
}

module.exports = { createAssignments, OPEN, CLOSED };
