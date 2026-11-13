'use strict';
const { refCode } = require('../lib/crypto');
const { now, str, list, isEmail, safeJson, HttpError } = require('../lib/util');
const catalog = require('./catalog');

function createIntake(app) {
  const { db, config } = app;

  function newRef() {
    for (;;) {
      const ref = `SD-${refCode(6)}`;
      if (!db.get('SELECT 1 FROM inquiries WHERE ref = ?', ref)) return ref;
    }
  }

  /** Validate untrusted form fields. Returns { values, errors }. */
  function validateProject(body, uploads) {
    const values = {
      brand_name: str(body.brand_name, 120),
      contact_name: str(body.contact_name, 120),
      email: str(body.email, 254).toLowerCase(),
      phone: str(body.phone, 40),
      website: str(body.website, 200),
      garment_category: str(body.garment_category, 60),
      package_interest: str(body.package_interest, 30),
      description: str(body.description, 5000),
      measurements: str(body.measurements, 3000),
      fabric_preferences: str(body.fabric_preferences, 2000),
      budget: str(body.budget, 40),
      timeline: str(body.timeline, 40),
      deliverables: list(body.deliverables).map((d) => str(d, 30)),
      consent: body.consent === 'yes',
    };
    const errors = {};
    if (!values.brand_name) errors.brand_name = 'Tell us the brand or working name.';
    if (!values.contact_name) errors.contact_name = 'Your name is required.';
    if (!isEmail(values.email)) errors.email = 'Enter a valid email address.';
    if (!catalog.GARMENT_CATEGORIES.includes(values.garment_category)) errors.garment_category = 'Choose a garment category.';
    if (values.description.length < 20) errors.description = 'Describe the project in a few sentences.';
    if (!catalog.BUDGET_OPTIONS.includes(values.budget)) errors.budget = 'Choose a budget range.';
    if (!catalog.TIMELINE_OPTIONS.includes(values.timeline)) errors.timeline = 'Choose a timeline.';
    if (values.package_interest && !catalog.packageById(values.package_interest)) values.package_interest = '';
    const known = new Set(catalog.DELIVERABLE_OPTIONS.map((d) => d.id));
    values.deliverables = [...new Set(values.deliverables.filter((d) => known.has(d)))];
    if (!values.deliverables.length) errors.deliverables = 'Select at least one deliverable.';
    if (!values.consent) errors.consent = 'Please confirm we may store these details to respond.';
    if (uploads.length > config.limits.intakeFiles) errors.references = `Attach up to ${config.limits.intakeFiles} files.`;
    for (const u of uploads) {
      if (u.data.length > config.limits.intakeFileBytes) errors.references = 'Each file must be 8 MB or smaller.';
      else if (!app.files.sniff(u.data)) errors.references = 'Reference files must be JPG, PNG, WebP or PDF.';
    }
    return { values, errors };
  }

  return {
    validateProject,
    /** Persist a validated project inquiry with its reference files (atomic). */
    createProjectInquiry(values, uploads) {
      const id = db.tx(() => {
        const inquiryId = db.insert('inquiries', {
          ref: newRef(), kind: 'project', status: 'new',
          brand_name: values.brand_name, contact_name: values.contact_name, email: values.email,
          phone: values.phone, website: values.website, garment_category: values.garment_category,
          package_interest: values.package_interest, description: values.description,
          measurements: values.measurements, fabric_preferences: values.fabric_preferences,
          budget: values.budget, timeline: values.timeline,
          deliverables: JSON.stringify(values.deliverables), consent_at: now(), created_at: now(),
        });
        for (const upload of uploads) {
          app.files.storeClientUpload(upload, { inquiryId, uploadedBy: 'client' });
        }
        return inquiryId;
      });
      const inquiry = this.get(id);
      app.audit.log('public', 'inquiry.received', { entity: 'inquiry', entityId: id, detail: inquiry.ref });
      // Internal automation only — organising the submission commits the studio to nothing.
      app.automation.triageInquiry(inquiry).catch((err) => console.error('[automation] triage failed', err.message));
      app.notify.newInquiry(inquiry);
      return inquiry;
    },
    createContactMessage(body) {
      const values = {
        contact_name: str(body.name, 120),
        email: str(body.email, 254).toLowerCase(),
        description: str(body.message, 4000),
      };
      const errors = {};
      if (!values.contact_name) errors.name = 'Your name is required.';
      if (!isEmail(values.email)) errors.email = 'Enter a valid email address.';
      if (values.description.length < 10) errors.message = 'Write a short message.';
      if (Object.keys(errors).length) return { errors, values };
      const id = db.insert('inquiries', {
        ref: newRef(), kind: 'contact', status: 'new', ...values, consent_at: now(), created_at: now(),
      });
      const inquiry = this.get(id);
      app.audit.log('public', 'contact.received', { entity: 'inquiry', entityId: id, detail: inquiry.ref });
      app.notify.newInquiry(inquiry);
      return { inquiry, errors: null };
    },
    get(id) {
      const row = db.get('SELECT * FROM inquiries WHERE id = ?', id);
      if (!row) return null;
      row.deliverables = safeJson(row.deliverables, []);
      row.triage = safeJson(row.triage, null);
      return row;
    },
    list: (status) => (status
      ? db.all('SELECT * FROM inquiries WHERE status = ? ORDER BY id DESC', status)
      : db.all("SELECT * FROM inquiries WHERE status != 'archived' ORDER BY id DESC")),
    setStatus(id, status, actor) {
      if (!['new', 'reviewing', 'quoted', 'won', 'lost', 'archived'].includes(status)) throw new HttpError(400, 'Unknown status.');
      db.update('inquiries', id, { status });
      app.audit.log(actor, 'inquiry.status', { entity: 'inquiry', entityId: id, detail: status });
    },
    setNotes: (id, notes) => db.update('inquiries', id, { internal_notes: str(notes, 5000) }),
    saveTriage: (id, triage, source) => db.update('inquiries', id, { triage: JSON.stringify(triage), triage_source: source }),
  };
}

module.exports = { createIntake };
