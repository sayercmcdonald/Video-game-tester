'use strict';
const { token, sha256 } = require('../lib/crypto');
const { now, str, isDate, HttpError } = require('../lib/util');
const catalog = require('./catalog');

const WORK_UNLOCKED = new Set(['active', 'delivered', 'closed']);
const TASK_STATUSES = ['proposed', 'todo', 'doing', 'review', 'done'];

function createProjects(app) {
  const { db } = app;

  const get = (id) => db.get('SELECT * FROM projects WHERE id = ?', id);
  function mustGet(id) {
    const p = get(id);
    if (!p) throw new HttpError(404, 'Project not found.');
    return p;
  }
  const touch = (id) => db.update('projects', id, { updated_at: now() });

  /** The deposit rule: no production work before the agreed deposit has been received. */
  function requireWorkUnlocked(project) {
    if (!WORK_UNLOCKED.has(project.status)) {
      throw new HttpError(409, 'Work is locked until the deposit for this project has been received.');
    }
  }

  return {
    get, mustGet, touch, requireWorkUnlocked,
    isWorkUnlocked: (project) => WORK_UNLOCKED.has(project.status),

    // ── Clients ────────────────────────────────────────────────────────────
    getClient: (id) => db.get('SELECT * FROM clients WHERE id = ?', id),
    /**
     * Issue a fresh portal access key. Only its hash is stored, so the key is shown to
     * staff once; issuing a new one revokes the old key and any open portal sessions.
     */
    issuePortalKey(clientId, actor) {
      const key = token(24);
      db.update('clients', clientId, { portal_key_hash: sha256(key), portal_key_issued_at: now() });
      app.sessions.endAllFor('portal', clientId);
      app.audit.log(actor, 'client.portal_key_issued', { entity: 'client', entityId: clientId });
      return key;
    },
    clientByPortalKey: (key) => (key ? db.get('SELECT * FROM clients WHERE portal_key_hash = ?', sha256(key)) : null),

    // ── Projects ───────────────────────────────────────────────────────────
    list: () => db.all(`SELECT p.*, c.brand_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY p.id DESC`),
    forClient: (clientId) => db.all("SELECT * FROM projects WHERE client_id = ? AND status != 'cancelled' ORDER BY id DESC", clientId),
    forInquiry: (inquiryId) => db.get('SELECT * FROM projects WHERE inquiry_id = ?', inquiryId),

    /** Turn a qualified inquiry into a client + project and carry its reference files across. */
    createFromInquiry(inquiry, actor) {
      const existing = db.get('SELECT * FROM projects WHERE inquiry_id = ?', inquiry.id);
      if (existing) return existing;
      const id = db.tx(() => {
        let client = db.get('SELECT * FROM clients WHERE email = ?', inquiry.email);
        const clientId = client ? client.id : db.insert('clients', {
          brand_name: inquiry.brand_name || inquiry.contact_name, contact_name: inquiry.contact_name,
          email: inquiry.email, phone: inquiry.phone, created_at: now(),
        });
        const seq = (db.get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM projects').n);
        const projectId = db.insert('projects', {
          code: `SD-P${String(seq).padStart(4, '0')}`, client_id: clientId, inquiry_id: inquiry.id,
          name: `${inquiry.brand_name || inquiry.contact_name} — ${inquiry.garment_category || 'Project'}`,
          package: inquiry.package_interest || (inquiry.triage && inquiry.triage.suggested_package) || '',
          status: 'scoping', created_at: now(), updated_at: now(),
        });
        db.run('UPDATE files SET project_id = ? WHERE inquiry_id = ?', projectId, inquiry.id);
        if (inquiry.status === 'new') db.update('inquiries', inquiry.id, { status: 'reviewing' });
        return projectId;
      });
      const project = get(id);
      app.files.organize(project);
      app.audit.log(actor, 'project.created', { entity: 'project', entityId: id, projectId: id, detail: `from inquiry ${inquiry.ref}` });
      return project;
    },
    updateDetails(id, body, actor) {
      const project = mustGet(id);
      const pkg = str(body.package, 30);
      db.update('projects', id, {
        name: str(body.name, 160) || project.name,
        package: catalog.packageById(pkg) ? pkg : '',
        due_date: isDate(body.due_date) ? body.due_date : null,
        updated_at: now(),
      });
      app.audit.log(actor, 'project.updated', { entity: 'project', entityId: id, projectId: id });
    },
    setStatus(id, status, actor) {
      const project = mustGet(id);
      // Staff may only move a project forward once it is active, or cancel it. Unlocking
      // work happens exclusively through a recorded deposit payment (see billing).
      const allowed = { active: ['delivered'], delivered: ['closed', 'active'], scoping: ['cancelled'], awaiting_deposit: ['cancelled'] };
      if (!(allowed[project.status] || []).includes(status)) {
        throw new HttpError(409, `A project cannot move from "${project.status}" to "${status}".`);
      }
      db.update('projects', id, { status, updated_at: now() });
      app.audit.log(actor, 'project.status', { entity: 'project', entityId: id, projectId: id, detail: status });
    },

    // ── Brief (AI may draft; a person approves before the client sees it) ──
    saveBrief(id, text, { source, actor }) {
      db.update('projects', id, { brief: str(text, 12000), brief_status: 'draft', brief_source: source, updated_at: now() });
      app.audit.log(actor, 'brief.drafted', { entity: 'project', entityId: id, projectId: id, detail: source });
    },
    approveBrief(id, actor) {
      const project = mustGet(id);
      if (!project.brief.trim()) throw new HttpError(400, 'Write the brief before approving it.');
      db.update('projects', id, { brief_status: 'approved', updated_at: now() });
      app.audit.log(actor, 'brief.approved', { entity: 'project', entityId: id, projectId: id });
    },

    // ── Tasks & milestones ─────────────────────────────────────────────────
    tasks: (projectId) => db.all(
      `SELECT t.*, c.name AS contractor_name FROM tasks t LEFT JOIN contractors c ON c.id = t.contractor_id
       WHERE t.project_id = ? ORDER BY t.sort, t.id`, projectId),
    addTask(projectId, body, { source = 'manual', status = 'todo', actor }) {
      const title = str(body.title, 200);
      if (!title) throw new HttpError(400, 'A task needs a title.');
      const sort = db.get('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM tasks WHERE project_id = ?', projectId).n;
      const id = db.insert('tasks', {
        project_id: projectId, title, milestone: str(body.milestone, 80), status,
        contractor_id: body.contractor_id ? Number(body.contractor_id) || null : null,
        due_date: isDate(body.due_date) ? body.due_date : null, sort, source, created_at: now(),
      });
      if (actor) app.audit.log(actor, 'task.created', { entity: 'task', entityId: id, projectId, detail: title });
      return id;
    },
    updateTask(taskId, body, actor) {
      const task = db.get('SELECT * FROM tasks WHERE id = ?', taskId);
      if (!task) throw new HttpError(404, 'Task not found.');
      const project = mustGet(task.project_id);
      const status = TASK_STATUSES.includes(body.status) ? body.status : task.status;
      if (['doing', 'review', 'done'].includes(status) && status !== task.status) requireWorkUnlocked(project);
      db.update('tasks', taskId, {
        status,
        contractor_id: body.contractor_id === undefined ? task.contractor_id : (Number(body.contractor_id) || null),
        due_date: body.due_date === undefined ? task.due_date : (isDate(body.due_date) ? body.due_date : null),
        completed_at: status === 'done' ? (task.completed_at || now()) : null,
      });
      app.audit.log(actor, 'task.updated', { entity: 'task', entityId: taskId, projectId: project.id, detail: status });
      return task.project_id;
    },
    deleteTask(taskId, actor) {
      const task = db.get('SELECT * FROM tasks WHERE id = ?', taskId);
      if (!task) throw new HttpError(404, 'Task not found.');
      db.run('DELETE FROM tasks WHERE id = ?', taskId);
      app.audit.log(actor, 'task.deleted', { entity: 'task', entityId: taskId, projectId: task.project_id, detail: task.title });
      return task.project_id;
    },
    /** Accept or discard the task list an automation proposed. */
    resolveProposedTasks(projectId, accept, actor) {
      if (accept) db.run("UPDATE tasks SET status = 'todo' WHERE project_id = ? AND status = 'proposed'", projectId);
      else db.run("DELETE FROM tasks WHERE project_id = ? AND status = 'proposed'", projectId);
      app.audit.log(actor, accept ? 'tasks.proposal_accepted' : 'tasks.proposal_discarded', { entity: 'project', entityId: projectId, projectId });
    },

    // ── Contractors & costs ────────────────────────────────────────────────
    contractors: (activeOnly = false) => db.all(`SELECT * FROM contractors ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name`),
    addContractor(body, rateCents, actor) {
      const name = str(body.name, 120);
      if (!name) throw new HttpError(400, 'A contractor needs a name.');
      const id = db.insert('contractors', {
        name, email: str(body.email, 254), discipline: str(body.discipline, 120),
        hourly_rate_cents: rateCents || 0, notes: str(body.notes, 1000), created_at: now(),
      });
      app.audit.log(actor, 'contractor.created', { entity: 'contractor', entityId: id, detail: name });
      return id;
    },
    setContractorActive: (id, active) => db.update('contractors', id, { active: active ? 1 : 0 }),
    costs: (projectId) => db.all(
      `SELECT k.*, c.name AS contractor_name FROM costs k LEFT JOIN contractors c ON c.id = k.contractor_id
       WHERE k.project_id = ? ORDER BY k.id`, projectId),
    addCost(projectId, { description, contractorId, hours, amountCents }, actor) {
      const contractor = contractorId ? db.get('SELECT * FROM contractors WHERE id = ?', contractorId) : null;
      let amount = amountCents;
      if ((amount === null || amount === undefined) && contractor && hours > 0) {
        amount = Math.round(hours * contractor.hourly_rate_cents);
      }
      if (!description || !(amount > 0)) throw new HttpError(400, 'A cost needs a description and an amount (or hours for a contractor with a rate).');
      const id = db.insert('costs', {
        project_id: projectId, contractor_id: contractor ? contractor.id : null, description,
        hours: hours > 0 ? hours : null, amount_cents: amount, created_at: now(),
      });
      app.audit.log(actor, 'cost.logged', { entity: 'cost', entityId: id, projectId, detail: description });
    },
    deleteCost(costId, actor) {
      const cost = db.get('SELECT * FROM costs WHERE id = ?', costId);
      if (!cost) throw new HttpError(404, 'Cost not found.');
      db.run('DELETE FROM costs WHERE id = ?', costId);
      app.audit.log(actor, 'cost.deleted', { entity: 'cost', entityId: costId, projectId: cost.project_id, detail: cost.description });
      return cost.project_id;
    },
    /** Quote value vs cash collected vs costs logged. */
    profitability(projectId) {
      const quote = db.get("SELECT total_cents FROM quotes WHERE project_id = ? AND status = 'accepted' ORDER BY id DESC", projectId);
      const sum = (sql) => db.get(sql, projectId).n;
      const quoted = quote ? quote.total_cents : 0;
      const invoiced = sum("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE project_id = ? AND status IN ('open','paid')");
      const collected = sum("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE project_id = ? AND status = 'paid'");
      const costs = sum('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM costs WHERE project_id = ?');
      const basis = quoted || invoiced;
      return {
        quoted, invoiced, collected, costs,
        outstanding: invoiced - collected,
        projectedProfit: basis - costs,
        projectedMargin: basis ? (basis - costs) / basis : null,
        cashPosition: collected - costs,
      };
    },

    // ── Deliverables & revisions ───────────────────────────────────────────
    deliverables: (projectId) => db.all(
      `SELECT d.*, f.original_name, f.size FROM deliverables d LEFT JOIN files f ON f.id = d.file_id
       WHERE d.project_id = ? ORDER BY d.id`, projectId),
    getDeliverable: (id) => db.get('SELECT * FROM deliverables WHERE id = ?', id),
    addDeliverable(projectId, body, { source = 'manual', actor }) {
      const project = mustGet(projectId);
      requireWorkUnlocked(project);
      const title = str(body.title, 160);
      if (!title) throw new HttpError(400, 'A deliverable needs a title.');
      const id = db.insert('deliverables', {
        project_id: projectId, title,
        type: catalog.DELIVERABLE_TYPES.includes(body.type) ? body.type : 'other',
        stage: body.stage === 'preview' ? 'preview' : 'final', source, notes: str(body.notes, 2000), created_at: now(),
      });
      app.audit.log(actor, 'deliverable.created', { entity: 'deliverable', entityId: id, projectId, detail: title });
      return id;
    },
    /** Attach a new file version. Any earlier approval is withdrawn — the new file needs its own review. */
    attachDeliverableFile(deliverableId, fileId, actor) {
      const d = db.get('SELECT * FROM deliverables WHERE id = ?', deliverableId);
      if (!d) throw new HttpError(404, 'Deliverable not found.');
      requireWorkUnlocked(mustGet(d.project_id));
      db.update('deliverables', deliverableId, {
        file_id: fileId, version: d.version + 1, status: 'in_review', approved_by: null, approved_at: null, released_at: null,
      });
      app.audit.log(actor, 'deliverable.version_uploaded', { entity: 'deliverable', entityId: deliverableId, projectId: d.project_id, detail: `v${d.version + 1}` });
      return d.project_id;
    },
    /** Human technical review sign-off. Required for every deliverable, whatever produced it. */
    approveDeliverable(deliverableId, user) {
      const d = db.get('SELECT * FROM deliverables WHERE id = ?', deliverableId);
      if (!d) throw new HttpError(404, 'Deliverable not found.');
      if (!d.file_id) throw new HttpError(400, 'Upload a file before approving.');
      if (d.status !== 'in_review') throw new HttpError(409, 'Only deliverables in review can be approved.');
      db.update('deliverables', deliverableId, { status: 'approved', approved_by: user.id, approved_at: now() });
      app.audit.log(`staff:${user.email}`, 'deliverable.approved', { entity: 'deliverable', entityId: deliverableId, projectId: d.project_id, detail: `v${d.version}` });
      return d.project_id;
    },
    /** Make an approved deliverable visible to the client. Final files wait for the balance. */
    releaseDeliverable(deliverableId, user, { overrideBalance = false } = {}) {
      const d = db.get('SELECT * FROM deliverables WHERE id = ?', deliverableId);
      if (!d) throw new HttpError(404, 'Deliverable not found.');
      if (d.status !== 'approved') throw new HttpError(409, 'A deliverable must be approved by a reviewer before release.');
      if (d.stage === 'final' && !overrideBalance) {
        const balance = app.billing.balanceDue(d.project_id);
        if (balance > 0) throw new HttpError(409, 'Final files are held until the balance is paid. Tick the override to release anyway.');
      }
      db.update('deliverables', deliverableId, { status: 'released', released_at: now() });
      app.audit.log(`staff:${user.email}`, 'deliverable.released', {
        entity: 'deliverable', entityId: deliverableId, projectId: d.project_id,
        detail: `v${d.version}${overrideBalance ? ' (balance override)' : ''}`,
      });
      return d.project_id;
    },
    revisions: (projectId) => db.all(
      `SELECT r.*, d.title AS deliverable_title FROM revisions r JOIN deliverables d ON d.id = r.deliverable_id
       WHERE r.project_id = ? ORDER BY r.id DESC`, projectId),
    requestRevision(deliverableId, notes, requestedBy) {
      const d = db.get('SELECT * FROM deliverables WHERE id = ?', deliverableId);
      const text = str(notes, 3000);
      if (!d) throw new HttpError(404, 'Deliverable not found.');
      if (text.length < 5) throw new HttpError(400, 'Describe the change you need.');
      const id = db.insert('revisions', { deliverable_id: d.id, project_id: d.project_id, requested_by: requestedBy, notes: text, created_at: now() });
      app.audit.log(requestedBy, 'revision.requested', { entity: 'revision', entityId: id, projectId: d.project_id, detail: d.title });
      return d.project_id;
    },
    resolveRevision(revisionId, actor) {
      const r = db.get('SELECT * FROM revisions WHERE id = ?', revisionId);
      if (!r) throw new HttpError(404, 'Revision not found.');
      db.update('revisions', revisionId, { status: 'resolved', resolved_at: now() });
      app.audit.log(actor, 'revision.resolved', { entity: 'revision', entityId: revisionId, projectId: r.project_id });
      return r.project_id;
    },

    // ── Status updates (drafted by AI or staff; published only by a person) ─
    statusUpdates: (projectId, publishedOnly = false) => db.all(
      `SELECT * FROM status_updates WHERE project_id = ? ${publishedOnly ? "AND status = 'published'" : ''} ORDER BY id DESC`, projectId),
    saveStatusDraft(projectId, body, { source = 'manual', actor, id = null }) {
      const text = str(body, 4000);
      if (!text) throw new HttpError(400, 'Write the update first.');
      if (id) {
        const existing = db.get("SELECT * FROM status_updates WHERE id = ? AND status = 'draft'", id);
        if (!existing) throw new HttpError(409, 'Only drafts can be edited.');
        db.update('status_updates', id, { body: text });
        return id;
      }
      const newId = db.insert('status_updates', { project_id: projectId, body: text, source, created_at: now() });
      app.audit.log(actor, 'status_update.drafted', { entity: 'status_update', entityId: newId, projectId, detail: source });
      return newId;
    },
    publishStatusUpdate(id, user) {
      const u = db.get('SELECT * FROM status_updates WHERE id = ?', id);
      if (!u || u.status !== 'draft') throw new HttpError(409, 'Only drafts can be published.');
      db.update('status_updates', id, { status: 'published', approved_by: user.id, published_at: now() });
      app.audit.log(`staff:${user.email}`, 'status_update.published', { entity: 'status_update', entityId: id, projectId: u.project_id });
      return u.project_id;
    },
    deleteStatusDraft(id, actor) {
      const u = db.get('SELECT * FROM status_updates WHERE id = ?', id);
      if (!u || u.status !== 'draft') throw new HttpError(409, 'Only drafts can be discarded.');
      db.run('DELETE FROM status_updates WHERE id = ?', id);
      app.audit.log(actor, 'status_update.discarded', { entity: 'status_update', entityId: id, projectId: u.project_id });
      return u.project_id;
    },
  };
}

module.exports = { createProjects };
