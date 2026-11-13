'use strict';
const views = require('../views/admin');
const { verifyPassword } = require('../lib/crypto');
const { HttpError, int, str, list, parseMoney } = require('../lib/util');

function register(router, app) {
  const { db } = app;
  const A = { auth: 'admin' };
  const upload = { auth: 'admin', maxBody: app.config.limits.adminFileBytes + 1024 * 1024 };
  const actor = (ctx) => `staff:${ctx.user.email}`;
  const back = (ctx, projectId, anchor, flash) => ctx.redirect(`/admin/projects/${projectId}#${anchor}`, flash);

  // ── Auth ──────────────────────────────────────────────────────────────
  router.get('/admin/login', (ctx) => (ctx.user ? ctx.redirect('/admin') : ctx.html(views.login(ctx))));
  router.post('/admin/login', (ctx) => {
    const email = str(ctx.body.email, 254).toLowerCase();
    const fail = (message, status) => ctx.html(views.login(ctx, { error: message, email }), status);
    if (!app.rateLimit.take(`login:${ctx.ip}`, 10, 15 * 60e3) || !app.rateLimit.take(`login:${email}`, 10, 15 * 60e3)) {
      return fail('Too many attempts. Wait fifteen minutes and try again.', 429);
    }
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    // Verify against a dummy hash when the user is unknown so timing does not reveal accounts.
    const ok = verifyPassword(str(ctx.body.password, 500), user ? user.password_hash : DUMMY_HASH) && Boolean(user);
    if (!ok) {
      app.audit.log('public', 'admin.login_failed', { detail: email });
      return fail('Email or password is incorrect.', 401);
    }
    app.rateLimit.reset(`login:${email}`);
    ctx.setCookies.push(app.sessions.start('admin', user.id));
    app.audit.log(`staff:${user.email}`, 'admin.signed_in');
    ctx.redirect('/admin');
  });
  router.post('/admin/logout', A, (ctx) => {
    ctx.setCookies.push(app.sessions.end('admin', ctx.cookies));
    ctx.redirect('/admin/login');
  });

  // ── Overview ──────────────────────────────────────────────────────────
  const n = (sql, ...p) => db.get(sql, ...p).n;
  function approvalQueues() {
    const join = 'JOIN projects p ON p.id = x.project_id';
    return {
      quotes: db.all(`SELECT x.*, p.code FROM quotes x ${join} WHERE x.status = 'draft' ORDER BY x.id`),
      invoices: db.all(`SELECT x.*, p.code FROM invoices x ${join} WHERE x.status = 'draft' ORDER BY x.id`),
      deliverables: db.all(`SELECT x.*, p.code FROM deliverables x ${join} WHERE x.status IN ('in_review','approved') ORDER BY x.id`),
      updates: db.all(`SELECT x.*, p.code FROM status_updates x ${join} WHERE x.status = 'draft' ORDER BY x.id`),
      revisions: db.all(`SELECT x.*, p.code FROM revisions x ${join} WHERE x.status = 'open' ORDER BY x.id`),
      briefs: db.all("SELECT id AS project_id, code, name, brief_source FROM projects WHERE brief_status = 'draft' AND status != 'cancelled'"),
      tasks: db.all(`SELECT x.project_id, p.code, COUNT(*) AS n FROM tasks x ${join} WHERE x.status = 'proposed' GROUP BY x.project_id`),
      payments: app.billing.paymentsNeedingReview(),
    };
  }
  router.get('/admin', A, (ctx) => {
    const queues = approvalQueues();
    ctx.html(views.overview(ctx, {
      newLeads: n("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'new'"),
      approvals: Object.values(queues).reduce((sum, q) => sum + q.length, 0),
      awaitingDeposit: n("SELECT COUNT(*) AS n FROM projects WHERE status = 'awaiting_deposit'"),
      active: n("SELECT COUNT(*) AS n FROM projects WHERE status = 'active'"),
      outstanding: n("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE status = 'open'"),
      collected: n("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE status = 'paid'"),
      activity: app.audit.recent(14),
      system: { payments: app.billing.providerName, drafting: app.automation.mode(), integrations: app.integrations.status() },
      ops: { humanTasks: app.db.get("SELECT COUNT(*) AS n FROM human_tasks WHERE status = 'open'").n, failed: app.db.get("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed'").n },
    }));
  });
  router.get('/admin/approvals', A, (ctx) => ctx.html(views.approvals(ctx, approvalQueues())));

  // ── Leads ─────────────────────────────────────────────────────────────
  router.get('/admin/leads', A, (ctx) => {
    const status = str(ctx.query.get('status'), 20);
    ctx.html(views.leads(ctx, { rows: app.intake.list(status), status }));
  });
  function mustLead(ctx) {
    const inquiry = app.intake.get(int(ctx.params.id));
    if (!inquiry) throw new HttpError(404, 'Inquiry not found.');
    return inquiry;
  }
  router.get('/admin/leads/:id', A, (ctx) => {
    const inquiry = mustLead(ctx);
    ctx.html(views.lead(ctx, { inquiry, files: app.files.forInquiry(inquiry.id), project: app.projects.forInquiry(inquiry.id) }));
  });
  router.post('/admin/leads/:id/status', A, (ctx) => {
    const inquiry = mustLead(ctx);
    app.intake.setStatus(inquiry.id, str(ctx.body.status, 20), actor(ctx));
    ctx.redirect(`/admin/leads/${inquiry.id}`, 'Status updated.');
  });
  router.post('/admin/leads/:id/notes', A, (ctx) => {
    const inquiry = mustLead(ctx);
    app.intake.setNotes(inquiry.id, ctx.body.notes);
    ctx.redirect(`/admin/leads/${inquiry.id}`, 'Notes saved.');
  });
  router.post('/admin/leads/:id/triage', A, async (ctx) => {
    const inquiry = mustLead(ctx);
    await app.automation.triageInquiry(inquiry);
    ctx.redirect(`/admin/leads/${inquiry.id}`, 'Submission organised.');
  });
  router.post('/admin/leads/:id/convert', A, (ctx) => {
    const inquiry = mustLead(ctx);
    if (inquiry.kind !== 'project') throw new HttpError(400, 'Only project inquiries can become projects.');
    const project = app.projects.createFromInquiry(inquiry, actor(ctx));
    ctx.redirect(`/admin/projects/${project.id}`, `Project ${project.code} created.`);
  });
  router.get('/admin/files/:id', A, (ctx) => {
    const file = app.files.get(int(ctx.params.id));
    if (!file) throw new HttpError(404, 'File not found.');
    app.files.send(ctx, file, { inline: ctx.query.get('inline') === '1' });
  });

  // ── Projects ──────────────────────────────────────────────────────────
  router.get('/admin/projects', A, (ctx) => {
    const rows = app.projects.list().map((p) => ({ ...p, money: app.projects.profitability(p.id) }));
    ctx.html(views.projects(ctx, { rows }));
  });
  const mustProject = (ctx) => app.projects.mustGet(int(ctx.params.id));
  router.get('/admin/projects/:id', A, (ctx) => {
    const project = mustProject(ctx);
    // A freshly issued portal key travels in a one-time flash cookie, never in the URL.
    let portalKey = '';
    if (ctx.flash.startsWith('portal-key:')) { portalKey = ctx.flash.slice(11); ctx.flash = ''; }
    ctx.html(views.project(ctx, {
      project, portalKey,
      client: app.projects.getClient(project.client_id),
      unlocked: app.projects.isWorkUnlocked(project),
      quotes: app.quotes.forProject(project.id),
      tasks: app.projects.tasks(project.id),
      contractors: app.projects.contractors(true),
      deliverables: app.projects.deliverables(project.id),
      revisions: app.projects.revisions(project.id),
      invoices: app.billing.forProject(project.id),
      payments: app.billing.payments(project.id),
      remaining: app.billing.remainingToInvoice(project.id),
      balanceDue: app.billing.balanceDue(project.id),
      costs: app.projects.costs(project.id),
      money: app.projects.profitability(project.id),
      updates: app.projects.statusUpdates(project.id),
      files: app.files.forProject(project.id),
      integrations: app.integrations.status(),
      jobs: app.integrations.jobs(project.id),
      history: app.audit.forProject(project.id),
      workflow: app.db.get('SELECT * FROM workflows WHERE project_id = ?', project.id),
    }));
  });
  router.post('/admin/projects/:id/details', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.updateDetails(project.id, ctx.body, actor(ctx));
    ctx.redirect(`/admin/projects/${project.id}`, 'Project saved.');
  });
  router.post('/admin/projects/:id/status', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.setStatus(project.id, str(ctx.body.status, 20), actor(ctx));
    ctx.redirect(`/admin/projects/${project.id}`, 'Status updated.');
  });
  router.post('/admin/projects/:id/portal-key', A, (ctx) => {
    const project = mustProject(ctx);
    const key = app.projects.issuePortalKey(project.client_id, actor(ctx));
    ctx.redirect(`/admin/projects/${project.id}`, `portal-key:${key}`);
  });

  // Automation: every branch produces a draft or an internal label, never a client-facing action.
  router.post('/admin/projects/:id/automate', A, async (ctx) => {
    const project = mustProject(ctx);
    const task = str(ctx.body.task, 20);
    const who = actor(ctx);
    if (task === 'brief') { await app.automation.draftBrief(project, who); return back(ctx, project.id, 'brief', 'Brief drafted — review and approve it.'); }
    if (task === 'quote') { await app.automation.draftQuote(project, who); return back(ctx, project.id, 'quote', 'Quote drafted — check scope and pricing before sending.'); }
    if (task === 'tasks') { await app.automation.proposeTasks(project, who); return back(ctx, project.id, 'tasks', 'Task list proposed — accept or discard it.'); }
    if (task === 'status') { await app.automation.draftStatusUpdate(project, who); return back(ctx, project.id, 'updates', 'Update drafted — edit and publish when ready.'); }
    if (task === 'files') { const changed = app.automation.organizeFiles(project, who); return back(ctx, project.id, 'files', `${changed} file label(s) updated.`); }
    throw new HttpError(400, 'Unknown automation.');
  });

  router.post('/admin/projects/:id/brief', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.saveBrief(project.id, ctx.body.brief, { source: 'manual', actor: actor(ctx) });
    if (ctx.body.action === 'approve') app.projects.approveBrief(project.id, actor(ctx));
    back(ctx, project.id, 'brief', ctx.body.action === 'approve' ? 'Brief approved.' : 'Brief saved as draft.');
  });

  router.post('/admin/projects/:id/quote', A, (ctx) => {
    const project = mustProject(ctx);
    const descriptions = list(ctx.body.item_description);
    const quantities = list(ctx.body.item_quantity);
    const units = list(ctx.body.item_unit);
    const lineItems = descriptions.map((description, i) => ({
      description, quantity: quantities[i], unit_cents: parseMoney(units[i]) || 0,
    }));
    const quoteId = app.quotes.saveDraft(project.id, {
      scope: ctx.body.scope, line_items: lineItems, deposit_percent: ctx.body.deposit_percent,
      terms: ctx.body.terms, valid_until: ctx.body.valid_until,
    }, { actor: actor(ctx), quoteId: int(ctx.body.quote_id) });
    if (ctx.body.action === 'send') {
      app.quotes.approveAndSend(quoteId, ctx.user);
      return back(ctx, project.id, 'quote', 'Quote approved and visible in the client portal. Send the client their portal link.');
    }
    back(ctx, project.id, 'quote', 'Quote draft saved.');
  });

  // ── Tasks ─────────────────────────────────────────────────────────────
  router.post('/admin/projects/:id/tasks', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.addTask(project.id, ctx.body, { actor: actor(ctx) });
    back(ctx, project.id, 'tasks');
  });
  router.post('/admin/projects/:id/tasks/proposed', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.resolveProposedTasks(project.id, ctx.body.decision === 'accept', actor(ctx));
    back(ctx, project.id, 'tasks', ctx.body.decision === 'accept' ? 'Task list accepted.' : 'Proposal discarded.');
  });
  router.post('/admin/tasks/:id', A, (ctx) => back(ctx, app.projects.updateTask(int(ctx.params.id), ctx.body, actor(ctx)), 'tasks'));
  router.post('/admin/tasks/:id/delete', A, (ctx) => back(ctx, app.projects.deleteTask(int(ctx.params.id), actor(ctx)), 'tasks'));

  // ── Files & deliverables ──────────────────────────────────────────────
  function oneUpload(ctx) {
    const file = ctx.files.find((f) => f.field === 'file');
    if (!file || !file.data.length) throw new HttpError(400, 'Choose a file to upload.');
    if (file.data.length > app.config.limits.adminFileBytes) throw new HttpError(413, 'Files are limited to 50 MB.');
    return file;
  }
  router.post('/admin/projects/:id/files', upload, (ctx) => {
    const project = mustProject(ctx);
    app.files.storeStaffUpload(oneUpload(ctx), { projectId: project.id, kind: 'working', uploadedBy: actor(ctx) });
    app.files.organize(project);
    back(ctx, project.id, 'files', 'File uploaded.');
  });
  router.post('/admin/projects/:id/deliverables', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.addDeliverable(project.id, ctx.body, { actor: actor(ctx) });
    back(ctx, project.id, 'deliverables');
  });
  router.post('/admin/deliverables/:id/upload', upload, (ctx) => {
    const d = app.projects.getDeliverable(int(ctx.params.id));
    if (!d) throw new HttpError(404, 'Deliverable not found.');
    const file = oneUpload(ctx);
    const projectId = db.tx(() => {
      const fileId = app.files.storeStaffUpload(file, { projectId: d.project_id, kind: 'deliverable', uploadedBy: actor(ctx) });
      return app.projects.attachDeliverableFile(d.id, fileId, actor(ctx));
    });
    app.files.organize(app.projects.mustGet(projectId));
    back(ctx, projectId, 'deliverables', 'File uploaded — it now needs review before release.');
  });
  router.post('/admin/deliverables/:id/approve', A, (ctx) => back(ctx, app.projects.approveDeliverable(int(ctx.params.id), ctx.user), 'deliverables', 'Deliverable approved.'));
  router.post('/admin/deliverables/:id/release', A, (ctx) => back(ctx,
    app.projects.releaseDeliverable(int(ctx.params.id), ctx.user, { overrideBalance: ctx.body.override === 'yes' }), 'deliverables', 'Released to the client portal.'));
  router.post('/admin/revisions/:id/resolve', A, (ctx) => back(ctx, app.projects.resolveRevision(int(ctx.params.id), actor(ctx)), 'deliverables'));

  // ── Invoices, payments, costs ─────────────────────────────────────────
  router.get('/admin/invoices', A, (ctx) => ctx.html(views.invoices(ctx, { rows: app.billing.all() })));
  router.post('/admin/projects/:id/invoices', A, (ctx) => {
    const project = mustProject(ctx);
    if (!app.quotes.accepted(project.id)) throw new HttpError(409, 'Invoices can be drafted once the client has accepted a quote.');
    const amount = parseMoney(ctx.body.amount);
    if (!amount) throw new HttpError(400, 'Enter a valid amount.');
    const kind = ctx.body.kind === 'other' ? 'other' : 'final';
    app.billing.createInvoice({
      projectId: project.id, kind, amountCents: amount, actor: actor(ctx),
      description: str(ctx.body.description, 200) || (kind === 'final' ? 'Final balance' : 'Additional work'),
    });
    back(ctx, project.id, 'billing', 'Draft invoice created — approve it to issue it to the client.');
  });
  router.post('/admin/invoices/:id/approve', A, (ctx) => back(ctx, app.billing.approve(int(ctx.params.id), ctx.user), 'billing', 'Invoice issued. It is now payable in the client portal.'));
  router.post('/admin/invoices/:id/void', A, (ctx) => back(ctx, app.billing.void(int(ctx.params.id), ctx.user), 'billing', 'Invoice voided.'));
  router.post('/admin/invoices/:id/manual-payment', A, (ctx) => back(ctx, app.billing.recordManualPayment(int(ctx.params.id), ctx.body.reference, ctx.user), 'billing', 'Payment recorded.'));
  router.post('/admin/projects/:id/costs', A, (ctx) => {
    const project = mustProject(ctx);
    const hours = Number(ctx.body.hours);
    app.projects.addCost(project.id, {
      description: str(ctx.body.description, 200), contractorId: int(ctx.body.contractor_id),
      hours: Number.isFinite(hours) && hours > 0 ? hours : 0, amountCents: ctx.body.amount ? parseMoney(ctx.body.amount) : null,
    }, actor(ctx));
    back(ctx, project.id, 'profit');
  });
  router.post('/admin/costs/:id/delete', A, (ctx) => back(ctx, app.projects.deleteCost(int(ctx.params.id), actor(ctx)), 'profit'));

  // ── Client updates ────────────────────────────────────────────────────
  router.post('/admin/projects/:id/updates', A, (ctx) => {
    const project = mustProject(ctx);
    app.projects.saveStatusDraft(project.id, ctx.body.body, { actor: actor(ctx) });
    back(ctx, project.id, 'updates', 'Update saved as draft.');
  });
  router.post('/admin/updates/:id', A, (ctx) => {
    const id = int(ctx.params.id);
    const row = db.get('SELECT * FROM status_updates WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Update not found.');
    if (ctx.body.action === 'discard') return back(ctx, app.projects.deleteStatusDraft(id, actor(ctx)), 'updates', 'Draft discarded.');
    app.projects.saveStatusDraft(row.project_id, ctx.body.body, { id, actor: actor(ctx) });
    if (ctx.body.action === 'publish') return back(ctx, app.projects.publishStatusUpdate(id, ctx.user), 'updates', 'Update published to the client portal.');
    back(ctx, row.project_id, 'updates', 'Draft saved.');
  });

  // ── INDEX V3 / FORM ───────────────────────────────────────────────────
  router.post('/admin/projects/:id/integrations', A, async (ctx) => {
    const project = mustProject(ctx);
    await app.integrations.request(project, str(ctx.body.product, 20), str(ctx.body.job_type, 40), ctx.body.notes, actor(ctx));
    back(ctx, project.id, 'production', 'Production request created.');
  });
  router.post('/admin/jobs/:id/refresh', A, async (ctx) => {
    const job = await app.integrations.refresh(int(ctx.params.id), actor(ctx));
    back(ctx, job.project_id, 'production', job.status === 'completed' ? 'Job complete — outputs are waiting for review.' : `Job is ${job.status}.`);
  });
  router.post('/admin/jobs/:id/complete', A, (ctx) => back(ctx, app.integrations.completeManual(int(ctx.params.id), actor(ctx)), 'production'));

  // ── Contractors ───────────────────────────────────────────────────────
  router.get('/admin/contractors', A, (ctx) => {
    const rows = app.projects.contractors().map((c) => ({
      ...c, open_tasks: n("SELECT COUNT(*) AS n FROM tasks WHERE contractor_id = ? AND status IN ('todo','doing','review')", c.id),
    }));
    ctx.html(views.contractors(ctx, { rows }));
  });
  router.post('/admin/contractors', A, (ctx) => {
    app.projects.addContractor(ctx.body, ctx.body.rate ? parseMoney(ctx.body.rate) : 0, actor(ctx));
    ctx.redirect('/admin/contractors', 'Contractor added.');
  });
  router.post('/admin/contractors/:id/active', A, (ctx) => {
    app.projects.setContractorActive(int(ctx.params.id), ctx.body.active === '1');
    ctx.redirect('/admin/contractors');
  });
}

// Fixed scrypt hash of a random string, used only to equalise login timing.
const DUMMY_HASH = require('../lib/crypto').hashPassword(require('node:crypto').randomBytes(16).toString('hex'));

module.exports = { register };
