'use strict';
const { now, str } = require('../lib/util');

const KINDS = ['approval', 'production', 'escalation', 'communication', 'review'];

/**
 * The human intervention queue: everything that needs a person. Tasks are keyed per
 * workflow so repeated requests collapse into one, and most resolve themselves once the
 * underlying record shows the work was done (see workflow.autoResolve).
 */
function createHumanTasks(app) {
  const { db, audit } = app;
  const scopedKey = (workflowId, key) => (workflowId ? `wf${workflowId}:${key}` : key);
  return {
    KINDS,
    create({ workflowId = null, projectId = null, inquiryId = null, kind, title, detail = '', link = '', key, createdBy }) {
      if (!KINDS.includes(kind)) throw new Error(`Unknown human task kind ${kind}`);
      const dedupe = key.startsWith('wf') ? key : scopedKey(workflowId, key);
      const id = db.insertIgnore('human_tasks', {
        workflow_id: workflowId, project_id: projectId, inquiry_id: inquiryId, kind, title: str(title, 200), detail: str(detail, 2000),
        link: str(link, 200), dedupe_key: dedupe, created_by: createdBy, created_at: now(),
      });
      // A genuinely new task may need to reach the founder (approvals, failures, risks).
      if (id && app.command) app.command.notifications.onHumanTask(db.get('SELECT * FROM human_tasks WHERE id = ?', id));
      return id || db.get('SELECT id FROM human_tasks WHERE dedupe_key = ?', dedupe).id;
    },
    get: (id) => db.get('SELECT * FROM human_tasks WHERE id = ?', id),
    open: (limit = 100) => db.all("SELECT * FROM human_tasks WHERE status = 'open' ORDER BY id LIMIT ?", limit),
    openForWorkflow: (wfId) => db.all("SELECT * FROM human_tasks WHERE workflow_id = ? AND status = 'open' ORDER BY id", wfId),
    forWorkflow: (wfId) => db.all('SELECT * FROM human_tasks WHERE workflow_id = ? ORDER BY id DESC', wfId),
    resolve(id, by, status = 'done') {
      const r = db.run("UPDATE human_tasks SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'", status, by, now(), id);
      if (r.changes && !by.startsWith('system')) {
        const t = db.get('SELECT * FROM human_tasks WHERE id = ?', id);
        audit.log(by, `human_task.${status}`, { entity: 'human_task', entityId: id, projectId: t.project_id, detail: t.title });
      }
      return r.changes > 0;
    },
    resolveKey(workflowId, key, by = 'system:auto') {
      const t = db.get("SELECT id FROM human_tasks WHERE dedupe_key = ? AND status = 'open'", scopedKey(workflowId, key));
      return t ? this.resolve(t.id, by) : false;
    },
  };
}

module.exports = { createHumanTasks };
