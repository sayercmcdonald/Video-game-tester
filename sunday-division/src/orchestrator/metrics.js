'use strict';

/** Read-only queries behind the Operations dashboard. */
function createMetrics(app) {
  const { db } = app;
  const n = (sql, ...p) => db.get(sql, ...p).n;
  const hours = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600e3;
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  /** Average hours between a workflow's creation (or a state) and reaching a later state. */
  function turnaround(fromState, toState) {
    const rows = db.all(`
      SELECT w.created_at AS created,
        (SELECT MIN(created_at) FROM workflow_transitions WHERE workflow_id = w.id AND to_state = ?) AS from_at,
        (SELECT MIN(created_at) FROM workflow_transitions WHERE workflow_id = w.id AND to_state = ?) AS to_at
      FROM workflows w`, fromState || '__none__', toState);
    return avg(rows.filter((r) => r.to_at && (fromState ? r.from_at : true)).map((r) => hours(fromState ? r.from_at : r.created, r.to_at)));
  }

  return {
    overview() {
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const succeeded = n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'succeeded'");
      // Human work on routine steps the system could in principle do. Approvals and reviews
      // are excluded: they are required by policy, not a gap in automation.
      const routineHuman = n("SELECT COUNT(*) AS n FROM human_tasks WHERE kind IN ('production','escalation','communication')");
      return {
        activeWorkflows: n("SELECT COUNT(*) AS n FROM workflows WHERE state NOT IN ('completed','cancelled','lost')"),
        blockedWorkflows: n("SELECT COUNT(*) AS n FROM workflows WHERE blocked_reason IS NOT NULL AND state NOT IN ('completed','cancelled','lost')"),
        pausedWorkflows: n("SELECT COUNT(*) AS n FROM workflows WHERE paused = 1 AND state NOT IN ('completed','cancelled','lost')"),
        jobs: Object.fromEntries(['queued', 'running', 'succeeded', 'failed', 'cancelled'].map((s) => [s, n('SELECT COUNT(*) AS n FROM jobs WHERE status = ?', s)])),
        openHumanTasks: n("SELECT COUNT(*) AS n FROM human_tasks WHERE status = 'open'"),
        openByKind: db.all("SELECT kind, COUNT(*) AS n FROM human_tasks WHERE status = 'open' GROUP BY kind"),
        aiSpentMonthMicros: app.budget.aiSpentThisMonth(),
        aiBudgetMonthUsd: app.settings.get('ai_monthly_budget_usd'),
        aiSpentAllMicros: n("SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE provider = 'claude'"),
        externalSpentMicros: n("SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE provider = 'integration'"),
        externalSpentMonthMicros: n("SELECT COALESCE(SUM(cost_micros), 0) AS n FROM agent_runs WHERE provider = 'integration' AND created_at >= ?", monthStart),
        budgetBlocked: n("SELECT COUNT(*) AS n FROM agent_runs WHERE status = 'budget_blocked' AND created_at >= ?", monthStart),
        automationRate: succeeded + routineHuman ? succeeded / (succeeded + routineHuman) : null,
        automationBasis: { agentSteps: succeeded, routineHumanSteps: routineHuman },
        turnaround: {
          toDraftQuote: turnaround(null, 'awaiting_quote_approval'),
          toQuoteSent: turnaround(null, 'awaiting_client_acceptance'),
          depositToProduction: turnaround('setup', 'in_production'),
          toCompletion: turnaround(null, 'completed'),
        },
      };
    },
    workflows: () => db.all(`
      SELECT w.*, p.code AS project_code, p.name AS project_name, i.ref AS inquiry_ref, i.brand_name,
        (SELECT COUNT(*) FROM jobs j WHERE j.workflow_id = w.id AND j.status IN ('queued','running')) AS pending_jobs,
        (SELECT COUNT(*) FROM human_tasks h WHERE h.workflow_id = w.id AND h.status = 'open') AS open_tasks
      FROM workflows w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN inquiries i ON i.id = w.inquiry_id
      ORDER BY CASE WHEN w.state IN ('completed','cancelled','lost') THEN 1 ELSE 0 END, w.id DESC LIMIT 100`),
    failedJobs: () => db.all("SELECT * FROM jobs WHERE status = 'failed' ORDER BY id DESC LIMIT 50"),
    recentJobs: (limit = 25) => db.all('SELECT * FROM jobs ORDER BY id DESC LIMIT ?', limit),
    humanTasks: () => db.all(`SELECT h.*, p.code AS project_code FROM human_tasks h LEFT JOIN projects p ON p.id = h.project_id
      WHERE h.status = 'open' ORDER BY CASE h.kind WHEN 'escalation' THEN 0 WHEN 'approval' THEN 1 WHEN 'review' THEN 2 ELSE 3 END, h.id LIMIT 200`),
    agentStats() {
      const rows = db.all(`SELECT agent, COUNT(*) AS jobs,
          SUM(status = 'succeeded') AS succeeded, SUM(status = 'failed') AS failed,
          SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END) AS retries,
          AVG(CASE WHEN status = 'succeeded' THEN (julianday(finished_at) - julianday(started_at)) * 86400000 END) AS avg_ms
        FROM jobs GROUP BY agent`);
      const runs = db.all(`SELECT agent, COALESCE(SUM(cost_micros), 0) AS cost, SUM(provider = 'claude' AND status = 'ok') AS model_ok,
          SUM(provider = 'rules') AS rules, SUM(status IN ('fallback','error','invalid_output','refused','budget_blocked')) AS problems,
          GROUP_CONCAT(DISTINCT NULLIF(model_served, '')) AS models, GROUP_CONCAT(DISTINCT NULLIF(prompt_version, '')) AS prompts
        FROM agent_runs GROUP BY agent`);
      const escalations = db.all("SELECT REPLACE(created_by, 'agent:', '') AS agent, COUNT(*) AS n FROM human_tasks WHERE created_by LIKE 'agent:%' GROUP BY created_by");
      const denied = db.all("SELECT agent, COUNT(*) AS n FROM agent_tool_calls WHERE decision = 'denied' GROUP BY agent");
      const by = (list, key = 'agent') => Object.fromEntries(list.map((r) => [r[key], r]));
      return { jobs: by(rows), runs: by(runs), escalations: by(escalations), denied: by(denied) };
    },
    profitability: () => app.projects.list().map((p) => ({ ...p, money: app.projects.profitability(p.id) })),
    workflowDetail(id) {
      const wf = app.orchestrator.engine.get(id);
      if (!wf) return null;
      return {
        wf,
        project: wf.project_id ? app.projects.get(wf.project_id) : null,
        inquiry: wf.inquiry_id ? app.intake.get(wf.inquiry_id) : null,
        transitions: db.all('SELECT * FROM workflow_transitions WHERE workflow_id = ? ORDER BY id', id),
        jobs: app.orchestrator.queue.forWorkflow(id).map((j) => ({ ...j, deps: app.orchestrator.queue.dependencies(j.id) })),
        runs: db.all('SELECT * FROM agent_runs WHERE workflow_id = ? ORDER BY id', id),
        toolCalls: db.all('SELECT t.* FROM agent_tool_calls t JOIN jobs j ON j.id = t.job_id WHERE j.workflow_id = ? ORDER BY t.id', id),
        tasks: app.humanTasks.forWorkflow(id),
        events: db.all('SELECT * FROM events WHERE (inquiry_id = ? AND inquiry_id IS NOT NULL) OR (project_id = ? AND project_id IS NOT NULL) ORDER BY id', wf.inquiry_id, wf.project_id),
      };
    },
  };
}

module.exports = { createMetrics };
