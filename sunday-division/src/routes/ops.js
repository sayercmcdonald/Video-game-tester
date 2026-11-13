'use strict';
const views = require('../views/ops');
const { createMetrics } = require('../orchestrator/metrics');
const { HttpError, int } = require('../lib/util');

function register(router, app) {
  const A = { auth: 'admin' };
  const metrics = createMetrics(app);
  const actor = (ctx) => `staff:${ctx.user.email}`;
  const backTo = (ctx, fallback) => {
    try { const ref = new URL(ctx.req.headers.referer); if (ref.host === ctx.req.headers.host && ref.pathname.startsWith('/admin/')) return ref.pathname; } catch { /* none */ }
    return fallback;
  };
  const mustWorkflow = (ctx) => {
    const wf = app.orchestrator.engine.get(int(ctx.params.id));
    if (!wf) throw new HttpError(404, 'Workflow not found.');
    return wf;
  };

  router.get('/admin/ops', A, (ctx) => ctx.html(views.overview(ctx, {
    overview: metrics.overview(), workflows: metrics.workflows(), failed: metrics.failedJobs(), tasks: metrics.humanTasks(),
    recent: metrics.recentJobs(), profit: metrics.profitability(), paused: app.settings.get('orchestrator_paused'),
  })));
  router.post('/admin/ops/run', A, async (ctx) => {
    await app.orchestrator.drain({ maxRounds: 50 });
    ctx.redirect('/admin/ops', 'Pending work processed.');
  });

  router.get('/admin/ops/workflows/:id', A, (ctx) => {
    const d = metrics.workflowDetail(int(ctx.params.id));
    if (!d) throw new HttpError(404, 'Workflow not found.');
    ctx.html(views.workflow(ctx, d));
  });
  router.post('/admin/ops/workflows/:id/pause', A, (ctx) => { const wf = mustWorkflow(ctx); app.orchestrator.engine.pause(wf.id, actor(ctx)); ctx.redirect(`/admin/ops/workflows/${wf.id}`, 'Workflow paused.'); });
  router.post('/admin/ops/workflows/:id/resume', A, (ctx) => {
    const wf = mustWorkflow(ctx);
    app.orchestrator.engine.resume(wf.id, actor(ctx));
    app.orchestrator.engine.advance(wf.id);
    ctx.redirect(`/admin/ops/workflows/${wf.id}`, 'Workflow resumed.');
  });
  router.post('/admin/ops/workflows/:id/advance', A, (ctx) => { const wf = mustWorkflow(ctx); app.orchestrator.engine.advance(wf.id); ctx.redirect(`/admin/ops/workflows/${wf.id}`, 'Workflow re-evaluated.'); });
  router.post('/admin/ops/workflows/:id/continue', A, (ctx) => {
    const wf = mustWorkflow(ctx);
    if (!app.orchestrator.engine.continueReview(wf.id, actor(ctx))) throw new HttpError(409, 'This workflow is not waiting for a lead review.');
    app.orchestrator.engine.advance(wf.id);
    ctx.redirect(`/admin/ops/workflows/${wf.id}`, 'Lead approved for scoping.');
  });

  router.post('/admin/ops/jobs/:id/retry', A, (ctx) => {
    const job = app.orchestrator.retryJob(int(ctx.params.id), ctx.user);
    if (!job) throw new HttpError(409, 'Only failed or cancelled jobs can be retried.');
    ctx.redirect(backTo(ctx, '/admin/ops'), 'Job queued to run again.');
  });
  router.post('/admin/ops/jobs/:id/cancel', A, (ctx) => {
    const job = app.orchestrator.cancelJob(int(ctx.params.id), ctx.user);
    if (!job || job.status !== 'cancelled') throw new HttpError(409, 'Only queued or failed jobs can be cancelled.');
    ctx.redirect(backTo(ctx, '/admin/ops'), 'Job cancelled; the step is treated as handled by a person.');
  });
  for (const status of ['done', 'dismiss']) {
    router.post(`/admin/ops/tasks/:id/${status}`, A, (ctx) => {
      const task = app.humanTasks.get(int(ctx.params.id));
      if (!task) throw new HttpError(404, 'Task not found.');
      app.humanTasks.resolve(task.id, actor(ctx), status === 'done' ? 'done' : 'dismissed');
      if (task.workflow_id) app.orchestrator.engine.advance(task.workflow_id);
      ctx.redirect(backTo(ctx, '/admin/ops'), 'Task updated.');
    });
  }

  router.get('/admin/ops/agents', A, (ctx) => ctx.html(views.agents(ctx, { stats: metrics.agentStats() })));
  router.get('/admin/ops/settings', A, (ctx) => ctx.html(views.settings(ctx, {
    values: app.settings.all(), defs: app.settings.DEFINITIONS, integrations: app.integrations.status(), paymentsProvider: app.billing.providerName,
  })));
  router.post('/admin/ops/settings', A, (ctx) => {
    if (ctx.body.section === 'flags') {
      const wantsAutonomy = ctx.body.autonomous_production === 'true';
      if (wantsAutonomy && !app.integrations.status().some((i) => i.connected)) {
        throw new HttpError(409, 'Connect INDEX V3 or FORM before switching on autonomous production.');
      }
      app.settings.set('orchestrator_paused', ctx.body.orchestrator_paused === 'true', ctx.user);
      app.settings.set('autonomous_production', wantsAutonomy, ctx.user);
    } else if (ctx.body.section === 'budgets') {
      for (const k of ['ai_monthly_budget_usd', 'ai_project_budget_usd', 'external_project_budget_usd', 'external_job_estimate_usd']) {
        if (ctx.body[k] !== undefined) app.settings.set(k, ctx.body[k], ctx.user);
      }
    } else {
      throw new HttpError(400, 'Unknown settings section.');
    }
    ctx.redirect('/admin/ops/settings', 'Settings saved.');
  });
}

module.exports = { register };
