'use strict';
const { now, str, isDate, safeJson, HttpError } = require('../lib/util');
const catalog = require('./catalog');

/** Normalise line items and compute totals. All money in integer cents. */
function computeTotals(items, depositPercent) {
  const clean = items
    .map((i) => ({
      description: str(i.description, 200),
      quantity: Math.max(1, Math.min(999, Math.round(Number(i.quantity) || 1))),
      unit_cents: Math.max(0, Math.round(Number(i.unit_cents) || 0)),
    }))
    .filter((i) => i.description && i.unit_cents > 0);
  const total = clean.reduce((sum, i) => sum + i.quantity * i.unit_cents, 0);
  const percent = Math.max(10, Math.min(100, Math.round(Number(depositPercent) || 50)));
  return { items: clean, total, percent, deposit: Math.round((total * percent) / 100) };
}

function createQuotes(app) {
  const { db } = app;

  function hydrate(row) {
    if (row) row.line_items = safeJson(row.line_items, []);
    return row;
  }
  const get = (id) => hydrate(db.get('SELECT * FROM quotes WHERE id = ?', id));
  function mustGet(id) {
    const q = get(id);
    if (!q) throw new HttpError(404, 'Quote not found.');
    return q;
  }

  return {
    get, mustGet, computeTotals,
    forProject: (projectId) => db.all('SELECT * FROM quotes WHERE project_id = ? ORDER BY version DESC', projectId).map(hydrate),
    /** The quote a client may currently act on or has agreed to. */
    clientVisible: (projectId) => hydrate(db.get(
      "SELECT * FROM quotes WHERE project_id = ? AND status IN ('sent','accepted') ORDER BY version DESC", projectId)),
    accepted: (projectId) => hydrate(db.get("SELECT * FROM quotes WHERE project_id = ? AND status = 'accepted' ORDER BY version DESC", projectId)),

    /** Create or update a draft. Drafts are never visible to the client. */
    saveDraft(projectId, input, { source = 'manual', actor, quoteId = null }) {
      const { items, total, percent, deposit } = computeTotals(input.line_items || [], input.deposit_percent);
      const fields = {
        scope: str(input.scope, 6000), line_items: JSON.stringify(items), total_cents: total,
        deposit_percent: percent, deposit_cents: deposit,
        terms: str(input.terms, 4000) || catalog.DEFAULT_TERMS,
        valid_until: isDate(input.valid_until) ? input.valid_until : null,
      };
      if (quoteId) {
        const quote = mustGet(quoteId);
        if (quote.status !== 'draft') throw new HttpError(409, 'Only draft quotes can be edited. Create a new version instead.');
        db.update('quotes', quoteId, fields);
        return quoteId;
      }
      if (db.get("SELECT 1 FROM quotes WHERE project_id = ? AND status = 'accepted'", projectId)) {
        throw new HttpError(409, 'This project already has an accepted quote. Bill scope changes as a separate invoice.');
      }
      // One working draft per project keeps review simple.
      db.run("DELETE FROM quotes WHERE project_id = ? AND status = 'draft'", projectId);
      const version = db.get('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM quotes WHERE project_id = ?', projectId).n;
      const id = db.insert('quotes', { project_id: projectId, version, status: 'draft', source, created_at: now(), ...fields });
      app.audit.log(actor, 'quote.drafted', { entity: 'quote', entityId: id, projectId, detail: `v${version} (${source})` });
      return id;
    },

    /** Human approval gate: only now does the client see the quote. */
    approveAndSend(quoteId, user) {
      const quote = mustGet(quoteId);
      if (quote.status !== 'draft') throw new HttpError(409, 'This quote has already been sent.');
      if (!quote.line_items.length || quote.total_cents <= 0) throw new HttpError(400, 'Add at least one priced line item.');
      if (!quote.scope.trim()) throw new HttpError(400, 'Describe the scope before sending.');
      const project = app.projects.mustGet(quote.project_id);
      if (project.status !== 'scoping') throw new HttpError(409, 'Quotes can only be sent while a project is in scoping.');
      db.tx(() => {
        db.run("UPDATE quotes SET status = 'superseded' WHERE project_id = ? AND status = 'sent'", quote.project_id);
        db.update('quotes', quoteId, { status: 'sent', approved_by: user.id, approved_at: now() });
        if (project.inquiry_id) db.run("UPDATE inquiries SET status = 'quoted' WHERE id = ? AND status IN ('new','reviewing')", project.inquiry_id);
        app.projects.touch(project.id);
      });
      app.audit.log(`staff:${user.email}`, 'quote.approved_and_sent', { entity: 'quote', entityId: quoteId, projectId: project.id, detail: `v${quote.version}` });
    },

    /** Client decision, taken in the portal. Acceptance raises the deposit invoice the quote describes. */
    respond(quoteId, clientId, { accept, signedName }) {
      const quote = mustGet(quoteId);
      const project = app.projects.mustGet(quote.project_id);
      if (project.client_id !== clientId) throw new HttpError(404, 'Quote not found.');
      if (quote.status !== 'sent') throw new HttpError(409, 'This quote is no longer open for a response.');
      if (quote.valid_until && quote.valid_until < now().slice(0, 10)) throw new HttpError(409, 'This quote has expired. Please ask the studio for an updated quote.');
      const actor = `client:${clientId}`;
      if (!accept) {
        db.update('quotes', quoteId, { status: 'declined', responded_at: now() });
        app.audit.log(actor, 'quote.declined', { entity: 'quote', entityId: quoteId, projectId: project.id });
        return { accepted: false };
      }
      const name = str(signedName, 120);
      if (name.length < 2) throw new HttpError(400, 'Type your full name to accept the quote.');
      let invoiceId;
      db.tx(() => {
        db.update('quotes', quoteId, { status: 'accepted', responded_at: now(), accepted_name: name });
        db.update('projects', project.id, { status: 'awaiting_deposit', updated_at: now() });
        if (project.inquiry_id) db.update('inquiries', project.inquiry_id, { status: 'won' });
        // The deposit was approved by staff as part of the quote, so this invoice opens immediately.
        invoiceId = app.billing.createInvoice({
          projectId: project.id, quoteId, kind: 'deposit', amountCents: quote.deposit_cents,
          description: `Deposit (${quote.deposit_percent}%) — ${project.name}`, status: 'open',
          approvedBy: quote.approved_by, actor,
        });
      });
      app.audit.log(actor, 'quote.accepted', { entity: 'quote', entityId: quoteId, projectId: project.id, detail: `signed "${name}"` });
      return { accepted: true, invoiceId };
    },
  };
}

module.exports = { createQuotes, computeTotals };
