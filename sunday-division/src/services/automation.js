'use strict';
const rules = require('../ai/rules');
const { HttpError } = require('../lib/util');

/**
 * Drafting engine, shared by the dashboard's "with automation" buttons and by the agents.
 *
 * generate*  — produce content (model via the AI gateway, or rules). No side effects
 *              beyond recording the run for cost and version tracking.
 * draft* / propose* — staff-triggered helpers that generate and then save as DRAFTS.
 *
 * Nothing here can send a quote, raise a payable invoice, publish to the client portal or
 * release a file. Those gates live in quotes/billing/projects and need a signed-in person.
 */
function createAutomation(app) {
  function submissionContext(inquiry, extra = {}) {
    const refs = app.files.forInquiry(inquiry.id).length;
    const payload = {
      brand_name: inquiry.brand_name, garment_category: inquiry.garment_category,
      package_interest: inquiry.package_interest || null, description: inquiry.description,
      target_measurements_and_sizing: inquiry.measurements || null,
      fabric_preferences: inquiry.fabric_preferences || null, budget: inquiry.budget, timeline: inquiry.timeline,
      requested_deliverables: inquiry.deliverables, reference_files_supplied: refs, ...extra,
    };
    // Contact details are deliberately left out: the model does not need them to draft.
    return { refs, text: `<submission>\n${JSON.stringify(payload, null, 2)}\n</submission>` };
  }

  function inquiryFor(project) {
    const inquiry = project.inquiry_id ? app.intake.get(project.inquiry_id) : null;
    if (!inquiry) throw new HttpError(400, 'This project has no intake submission to draft from.');
    return inquiry;
  }

  function projectState(project) {
    return {
      project: { name: project.name, status: project.status, due_date: project.due_date },
      tasks: app.projects.tasks(project.id).filter((t) => t.status !== 'proposed').map((t) => ({ title: t.title, milestone: t.milestone, status: t.status, due_date: t.due_date })),
      deliverables: app.projects.deliverables(project.id).map((d) => ({ title: d.title, status: d.status, version: d.version })),
      openRevisions: app.projects.revisions(project.id).filter((r) => r.status === 'open').length,
      openInvoices: app.billing.forProject(project.id).filter((i) => i.status === 'open').length,
      balanceDueCents: app.billing.balanceDue(project.id),
    };
  }

  const gen = {
    async triage(inquiry, meta = {}) {
      const { refs, text } = submissionContext(inquiry);
      return app.ai.draft('triage', text, () => rules.triage(inquiry, { referenceCount: refs }), meta);
    },
    async brief(project, meta = {}) {
      const inquiry = inquiryFor(project);
      const { refs, text } = submissionContext(inquiry, { studio_notes: inquiry.internal_notes || null, selected_package: project.package || null });
      const r = await app.ai.draft('brief', text, () => rules.brief(inquiry, { referenceCount: refs, project }), { ...meta, projectId: project.id });
      return { text: r.data.brief, source: r.source };
    },
    async quote(project, meta = {}) {
      const inquiry = inquiryFor(project);
      const { text } = submissionContext(inquiry, { selected_package: project.package || null, approved_brief: project.brief_status === 'approved' ? project.brief : null });
      const r = await app.ai.draft('quote', text, () => rules.quote(inquiry, { project }), { ...meta, projectId: project.id });
      const data = r.data;
      const assumptions = (data.assumptions || []).length ? `\n\nAssumptions to confirm:\n${data.assumptions.map((a) => `- ${a}`).join('\n')}` : '';
      return {
        source: r.source,
        input: {
          scope: data.scope + assumptions,
          line_items: (data.line_items || []).map((i) => ({ description: i.description, quantity: i.quantity, unit_cents: Math.round(Number(i.unit_price_usd) * 100) })),
          deposit_percent: data.deposit_percent,
        },
      };
    },
    async tasks(project, meta = {}) {
      const inquiry = inquiryFor(project);
      const { text } = submissionContext(inquiry, { selected_package: project.package || null, brief: project.brief || null });
      const r = await app.ai.draft('tasks', text, () => rules.tasks(inquiry, { project }), { ...meta, projectId: project.id });
      const start = project.started_at ? new Date(project.started_at) : new Date();
      const tasks = (r.data.tasks || []).slice(0, 24).map((t) => ({
        title: t.title, milestone: t.milestone,
        due_date: new Date(start.getTime() + Math.max(0, Math.min(365, Number(t.due_in_days) || 0)) * 86400e3).toISOString().slice(0, 10),
      }));
      return { tasks, source: r.source };
    },
    async statusUpdate(project, meta = {}, extraFacts = {}) {
      const state = { ...projectState(project), ...extraFacts };
      const r = await app.ai.draft('status_update', `<project>\n${JSON.stringify(state, null, 2)}\n</project>`, () => rules.statusUpdate(state), { ...meta, projectId: project.id });
      return { text: r.data.update, source: r.source };
    },
  };

  return {
    mode: () => app.ai.mode(),
    generate: gen,
    submissionContext,

    async triageInquiry(inquiry, meta) {
      const r = await gen.triage(inquiry, meta);
      app.intake.saveTriage(inquiry.id, r.data, r.source);
      return r.data;
    },
    async draftBrief(project, actor) {
      const r = await gen.brief(project);
      app.projects.saveBrief(project.id, r.text, { source: r.source, actor });
    },
    async draftQuote(project, actor) {
      const r = await gen.quote(project);
      return app.quotes.saveDraft(project.id, r.input, { source: r.source, actor });
    },
    async proposeTasks(project, actor) {
      const r = await gen.tasks(project);
      app.db.tx(() => {
        app.projects.resolveProposedTasks(project.id, false, actor);
        for (const t of r.tasks) app.projects.addTask(project.id, t, { source: r.source, status: 'proposed' });
      });
      app.audit.log(actor, 'tasks.proposed', { entity: 'project', entityId: project.id, projectId: project.id, detail: r.source });
    },
    async draftStatusUpdate(project, actor) {
      const r = await gen.statusUpdate(project);
      return app.projects.saveStatusDraft(project.id, r.text, { source: r.source, actor });
    },
    organizeFiles(project, actor) {
      const changed = app.files.organize(project);
      app.audit.log(actor, 'files.organized', { entity: 'project', entityId: project.id, projectId: project.id, detail: `${changed} relabelled` });
      return changed;
    },
  };
}

module.exports = { createAutomation };
