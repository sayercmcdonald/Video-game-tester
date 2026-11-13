'use strict';
const { now, str, HttpError } = require('../lib/util');
const { createPaymentProvider } = require('../payments');

function createBilling(app) {
  const { db, config } = app;
  const provider = createPaymentProvider(config);

  const get = (id) => db.get('SELECT * FROM invoices WHERE id = ?', id);
  function mustGet(id) {
    const inv = get(id);
    if (!inv) throw new HttpError(404, 'Invoice not found.');
    return inv;
  }

  /** Mark an invoice paid and apply the consequences. Always called inside a transaction. */
  function settle(invoice, { paymentProvider, ref, note = '', actor }) {
    db.update('invoices', invoice.id, { status: 'paid', paid_at: now() });
    db.insert('payments', {
      invoice_id: invoice.id, provider: paymentProvider, provider_ref: ref || '',
      amount_cents: invoice.amount_cents, status: 'succeeded', note, received_at: now(),
    });
    app.audit.log(actor, 'invoice.paid', { entity: 'invoice', entityId: invoice.id, projectId: invoice.project_id, detail: `${invoice.number} via ${paymentProvider}` });
    const project = app.projects.mustGet(invoice.project_id);
    if (invoice.kind === 'deposit' && project.status === 'awaiting_deposit') {
      // The deposit rule: this is the only place a project becomes active.
      db.update('projects', project.id, { status: 'active', started_at: now(), updated_at: now() });
      app.audit.log('system', 'project.work_unlocked', { entity: 'project', entityId: project.id, projectId: project.id, detail: `deposit ${invoice.number} received` });
    }
  }

  function onCheckoutPaid(session) {
    const record = db.get('SELECT * FROM checkout_sessions WHERE session_id = ?', session.id);
    if (!record) {
      console.warn('[billing] paid checkout session not issued by this system:', session.id);
      return 'unknown_session';
    }
    const invoice = mustGet(record.invoice_id);
    db.update('checkout_sessions', record.id, { status: 'completed' });
    const ref = String(session.payment_intent || session.id);
    const flag = (status, note) => {
      db.insert('payments', {
        invoice_id: invoice.id, provider: record.provider, provider_ref: ref,
        amount_cents: Number(session.amount_total) || 0, status, note, received_at: now(),
      });
      app.audit.log('system', `payment.${status}`, { entity: 'invoice', entityId: invoice.id, projectId: invoice.project_id, detail: note });
      return status;
    };
    if (Number(session.amount_total) !== invoice.amount_cents || String(session.currency).toLowerCase() !== invoice.currency) {
      return flag('mismatch', `Paid amount does not match ${invoice.number}; review in the payment provider dashboard.`);
    }
    if (invoice.status === 'paid') return flag('duplicate', `${invoice.number} was already paid; this payment needs a refund.`);
    if (invoice.status === 'void') return flag('mismatch', `${invoice.number} was void when paid; this payment needs a refund.`);
    settle(invoice, { paymentProvider: record.provider, ref, actor: 'system:webhook' });
    return 'settled';
  }

  return {
    providerName: provider ? provider.name : 'none',
    provider,
    get, mustGet,
    forProject: (projectId) => db.all('SELECT * FROM invoices WHERE project_id = ? ORDER BY id', projectId),
    clientVisible: (projectId) => db.all("SELECT * FROM invoices WHERE project_id = ? AND status IN ('open','paid') ORDER BY id", projectId),
    all: () => db.all(
      `SELECT i.*, p.name AS project_name, p.code AS project_code FROM invoices i JOIN projects p ON p.id = i.project_id ORDER BY i.id DESC`),
    payments: (projectId) => db.all(
      `SELECT pay.*, i.number FROM payments pay JOIN invoices i ON i.id = pay.invoice_id WHERE i.project_id = ? ORDER BY pay.id`, projectId),
    paymentsNeedingReview: () => db.all(
      `SELECT pay.*, i.number, i.project_id FROM payments pay JOIN invoices i ON i.id = pay.invoice_id WHERE pay.status != 'succeeded' ORDER BY pay.id DESC`),

    createInvoice({ projectId, quoteId = null, kind, amountCents, description, status = 'draft', approvedBy = null, actor }) {
      if (!(amountCents > 0)) throw new HttpError(400, 'An invoice needs an amount greater than zero.');
      const seq = db.get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM invoices').n;
      const id = db.insert('invoices', {
        number: `SD-INV-${String(seq).padStart(4, '0')}`, project_id: projectId, quote_id: quoteId, kind,
        description: str(description, 200), amount_cents: amountCents, currency: config.payments.currency, status,
        approved_by: status === 'open' ? approvedBy : null, approved_at: status === 'open' ? now() : null, created_at: now(),
      });
      app.audit.log(actor, 'invoice.created', { entity: 'invoice', entityId: id, projectId, detail: `${kind} (${status})` });
      return id;
    },
    /** What remains to invoice against the accepted quote. */
    remainingToInvoice(projectId) {
      const quote = app.quotes.accepted(projectId);
      if (!quote) return 0;
      const billed = db.get("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE project_id = ? AND status != 'void' AND kind IN ('deposit','final')", projectId).n;
      return Math.max(0, quote.total_cents - billed);
    },
    /** What the client still owes: unpaid part of the accepted quote plus any other open invoices. */
    balanceDue(projectId) {
      const quote = app.quotes.accepted(projectId);
      const paid = db.get("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE project_id = ? AND status = 'paid' AND kind IN ('deposit','final')", projectId).n;
      const otherOpen = db.get("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM invoices WHERE project_id = ? AND status = 'open' AND kind = 'other'", projectId).n;
      return Math.max(0, (quote ? quote.total_cents : 0) - paid) + otherOpen;
    },
    /** Human approval gate: a draft invoice is not payable or visible until a person opens it. */
    approve(invoiceId, user) {
      const invoice = mustGet(invoiceId);
      if (invoice.status !== 'draft') throw new HttpError(409, 'Only draft invoices can be approved.');
      db.update('invoices', invoiceId, { status: 'open', approved_by: user.id, approved_at: now() });
      app.audit.log(`staff:${user.email}`, 'invoice.approved', { entity: 'invoice', entityId: invoiceId, projectId: invoice.project_id, detail: invoice.number });
      return invoice.project_id;
    },
    void(invoiceId, user) {
      const invoice = mustGet(invoiceId);
      if (!['draft', 'open'].includes(invoice.status)) throw new HttpError(409, 'Paid invoices cannot be voided; refund through the payment provider.');
      db.tx(() => {
        db.update('invoices', invoiceId, { status: 'void' });
        db.run("UPDATE checkout_sessions SET status = 'expired' WHERE invoice_id = ? AND status = 'open'", invoiceId);
      });
      app.audit.log(`staff:${user.email}`, 'invoice.voided', { entity: 'invoice', entityId: invoiceId, projectId: invoice.project_id, detail: invoice.number });
      return invoice.project_id;
    },
    /** Payment received outside checkout (e.g. bank transfer), recorded by a named member of staff. */
    recordManualPayment(invoiceId, reference, user) {
      const invoice = mustGet(invoiceId);
      if (invoice.status !== 'open') throw new HttpError(409, 'Only open invoices can be marked as paid.');
      const ref = str(reference, 120);
      if (!ref) throw new HttpError(400, 'Enter the transfer reference so the payment can be traced.');
      db.tx(() => settle(invoice, { paymentProvider: 'manual', ref, note: `Recorded by ${user.email}`, actor: `staff:${user.email}` }));
      return invoice.project_id;
    },

    /** Start (or resume) hosted checkout for an open invoice that belongs to this client. */
    async startCheckout(invoiceId, client) {
      const invoice = mustGet(invoiceId);
      const project = app.projects.mustGet(invoice.project_id);
      if (project.client_id !== client.id) throw new HttpError(404, 'Invoice not found.');
      if (invoice.status !== 'open') throw new HttpError(409, 'This invoice is not awaiting payment.');
      if (!provider) throw new HttpError(503, 'Online payment is not available yet. Please contact the studio for payment details.');
      const soon = new Date(Date.now() + 10 * 60e3).toISOString();
      const open = db.get("SELECT * FROM checkout_sessions WHERE invoice_id = ? AND status = 'open' AND expires_at > ? ORDER BY id DESC", invoice.id, soon);
      if (open) return open.url;
      const attempt = db.get('SELECT COUNT(*) AS n FROM checkout_sessions WHERE invoice_id = ?', invoice.id).n + 1;
      const created = await provider.createCheckoutSession({
        invoice, project, client, attempt,
        successUrl: `${config.baseUrl}/portal/home?paid=${encodeURIComponent(invoice.number)}`,
        cancelUrl: `${config.baseUrl}/portal/home?cancelled=${encodeURIComponent(invoice.number)}`,
      });
      db.tx(() => {
        db.run("UPDATE checkout_sessions SET status = 'expired' WHERE invoice_id = ? AND status = 'open'", invoice.id);
        db.insert('checkout_sessions', {
          invoice_id: invoice.id, provider: provider.name, session_id: created.sessionId, url: created.url,
          amount_cents: invoice.amount_cents, created_at: now(), expires_at: created.expiresAt,
        });
      });
      app.audit.log(`client:${client.id}`, 'checkout.started', { entity: 'invoice', entityId: invoice.id, projectId: project.id, detail: invoice.number });
      return created.url;
    },
    checkoutSession: (sessionId) => db.get('SELECT * FROM checkout_sessions WHERE session_id = ?', sessionId),

    /**
     * Webhook entry point. The signature is verified against the raw body, events are
     * de-duplicated by id, and a failure rolls everything back so the provider retries.
     */
    handleWebhook(rawBody, signatureHeader) {
      if (!provider) throw new HttpError(503, 'Payments are not configured.');
      const event = provider.verifyWebhook(rawBody, signatureHeader);
      return db.tx(() => {
        if (db.get('SELECT 1 FROM webhook_events WHERE id = ?', String(event.id))) return { received: true, duplicate: true };
        db.insert('webhook_events', { id: String(event.id), type: String(event.type), received_at: now() });
        const object = (event.data && event.data.object) || {};
        let outcome = 'ignored';
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
          // Delayed payment methods complete first and are paid later; only act on money received.
          outcome = object.payment_status === 'paid' ? onCheckoutPaid(object) : 'awaiting_funds';
        } else if (event.type === 'checkout.session.expired') {
          db.run("UPDATE checkout_sessions SET status = 'expired' WHERE session_id = ? AND status = 'open'", String(object.id));
          outcome = 'expired';
        }
        return { received: true, outcome };
      });
    },
  };
}

module.exports = { createBilling };
