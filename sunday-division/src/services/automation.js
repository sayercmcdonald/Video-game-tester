'use strict';
const rules = require('../ai/rules');
const { safeJson, HttpError } = require('../lib/util');

/**
 * AI automation. Every function here produces a DRAFT or internal note:
 *   triage → internal notes on the lead          brief → draft, staff approve
 *   quote → draft, staff approve & send          tasks → "proposed", staff accept
 *   status update → draft, staff publish         files → internal labels only
 * Nothing in this module can send a quote, raise a payable invoice, publish to the client
 * portal or release a file. Those gates live in quotes/billing/projects and need a signed-in person.
 */
function createAutomation(app) {
  const { config } = app;

  function claudeEnabled() {
    if (config.ai.provider === 'rules') return false;
    if (config.ai.provider === 'claude') return true;
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  /** Try the model, fall back to rules. Returns { data, source }. */
  async function draft(task, context, fallback) {
    if (claudeEnabled()) {
      try {
        const { draftWithClaude } = require('../ai/claude');
        return { data: await draftWithClaude(config, task, context), source: 'claude' };
      } catch (err) {
        console.error(`[automation] ${task}: model call failed, using rules —`, err.message);
      }
    }
    return { data: fallback(), source: 'rules' };
  }

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

  return {
    mode: () => (claudeEnabled() ? `Claude (${config.ai.model})` : 'Rules-based drafting'),

    async triageInquiry(inquiry) {
      const { refs, text } = submissionContext(inquiry);
      const { data, source } = await draft('triage', text, () => rules.triage(inquiry, { referenceCount: refs }));
      app.intake.saveTriage(inquiry.id, data, source);
      return data;
    },

    async draftBrief(project, actor) {
      const inquiry = inquiryFor(project);
      const { refs, text } = submissionContext(inquiry, { studio_notes: inquiry.internal_notes || null, selected_package: project.package || null });
      const { data, source } = await draft('brief', text, () => rules.brief(inquiry, { referenceCount: refs, project }));
      app.projects.saveBrief(project.id, data.brief, { source, actor });
    },

    async draftQuote(project, actor) {
      const inquiry = inquiryFor(project);
      const { text } = submissionContext(inquiry, { selected_package: project.package || null, approved_brief: project.brief_status === 'approved' ? project.brief : null });
      const { data, source } = await draft('quote', text, () => rules.quote(inquiry, { project }));
      const assumptions = (data.assumptions || []).length ? `\n\nAssumptions to confirm:\n${data.assumptions.map((a) => `- ${a}`).join('\n')}` : '';
      return app.quotes.saveDraft(project.id, {
        scope: data.scope + assumptions,
        line_items: (data.line_items || []).map((i) => ({ description: i.description, quantity: i.quantity, unit_cents: Math.round(Number(i.unit_price_usd) * 100) })),
        deposit_percent: data.deposit_percent,
      }, { source, actor });
    },

    async proposeTasks(project, actor) {
      const inquiry = inquiryFor(project);
      const { text } = submissionContext(inquiry, { selected_package: project.package || null, brief: project.brief || null });
      const { data, source } = await draft('tasks', text, () => rules.tasks(inquiry, { project }));
      const start = project.started_at ? new Date(project.started_at) : new Date();
      app.db.tx(() => {
        app.projects.resolveProposedTasks(project.id, false, actor);
        for (const t of (data.tasks || []).slice(0, 24)) {
          const due = new Date(start.getTime() + Math.max(0, Math.min(365, Number(t.due_in_days) || 0)) * 86400e3);
          app.projects.addTask(project.id, { title: t.title, milestone: t.milestone, due_date: due.toISOString().slice(0, 10) }, { source, status: 'proposed' });
        }
      });
      app.audit.log(actor, 'tasks.proposed', { entity: 'project', entityId: project.id, projectId: project.id, detail: source });
    },

    async draftStatusUpdate(project, actor) {
      const state = {
        project: { name: project.name, status: project.status, due_date: project.due_date },
        tasks: app.projects.tasks(project.id).filter((t) => t.status !== 'proposed').map((t) => ({ title: t.title, milestone: t.milestone, status: t.status, due_date: t.due_date })),
        deliverables: app.projects.deliverables(project.id).map((d) => ({ title: d.title, status: d.status, version: d.version })),
        openRevisions: app.projects.revisions(project.id).filter((r) => r.status === 'open').length,
        openInvoices: app.billing.forProject(project.id).filter((i) => i.status === 'open').length,
        balanceDueCents: app.billing.balanceDue(project.id),
      };
      const { data, source } = await draft('status_update', `<project>\n${JSON.stringify(state, null, 2)}\n</project>`, () => rules.statusUpdate(state));
      return app.projects.saveStatusDraft(project.id, data.update, { source, actor });
    },

    organizeFiles(project, actor) {
      const changed = app.files.organize(project);
      app.audit.log(actor, 'files.organized', { entity: 'project', entityId: project.id, projectId: project.id, detail: `${changed} relabelled` });
      return changed;
    },
  };
}

module.exports = { createAutomation, safeJson };
