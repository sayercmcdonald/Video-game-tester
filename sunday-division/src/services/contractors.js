'use strict';
const { token, sha256 } = require('../lib/crypto');
const { now, str, isEmail, safeJson, HttpError } = require('../lib/util');
const catalog = require('./catalog');

const ACTIVE_ASSIGNMENT = "('recommended','offered','accepted','submitted','changes_requested')";

/**
 * The contractor roster. Only contractors a member of staff has approved can be recommended,
 * offered work or sign in to the contractor portal. Contact details never leave this module
 * except to the messaging service and staff views.
 */
function createContractors(app) {
  const { db } = app;
  const hydrate = (c) => (c ? { ...c, skills: safeJson(c.skills, []), categories: safeJson(c.categories, []) } : null);
  const get = (id) => hydrate(db.get('SELECT * FROM contractors WHERE id = ?', id));
  const load = (id) => db.get(`SELECT COUNT(*) AS n FROM assignments WHERE contractor_id = ? AND status IN ${ACTIVE_ASSIGNMENT}`, id).n;
  const signedOff = (id) => db.get("SELECT COUNT(*) AS n FROM assignments WHERE contractor_id = ? AND status = 'signed_off'", id).n;
  const cleanList = (values, allowed) => [...new Set([].concat(values || []).map((v) => str(v, 40)).filter((v) => allowed.includes(v)))];

  function fields(body, rateCents) {
    const name = str(body.name, 120);
    const email = str(body.email, 254).toLowerCase();
    if (!name) throw new HttpError(400, 'A contractor needs a name.');
    if (email && !isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    const capacity = Math.max(1, Math.min(10, Number(body.capacity) || 2));
    return {
      name, email, discipline: str(body.discipline, 120), notes: str(body.notes, 1000), portfolio_url: str(body.portfolio_url, 300),
      hourly_rate_cents: rateCents || 0, capacity,
      skills: JSON.stringify(cleanList(body.skills, Object.keys(catalog.JOB_TYPES))),
      categories: JSON.stringify(cleanList(body.categories, catalog.GARMENT_CATEGORIES)),
    };
  }

  return {
    get, load,
    list: () => db.all("SELECT * FROM contractors ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, name").map((c) => ({ ...hydrate(c), load: load(c.id), signed_off: signedOff(c.id) })),
    create(body, rateCents, user) {
      const status = body.status === 'approved' ? 'approved' : 'candidate';
      const id = db.insert('contractors', { ...fields(body, rateCents), status, active: 1, created_at: now(), ...(status === 'approved' ? { approved_by: user.id, approved_at: now() } : {}) });
      app.audit.log(`staff:${user.email}`, 'contractor.created', { entity: 'contractor', entityId: id, detail: status });
      return id;
    },
    update(id, body, rateCents, user) {
      if (!get(id)) throw new HttpError(404, 'Contractor not found.');
      db.update('contractors', id, fields(body, rateCents));
      app.audit.log(`staff:${user.email}`, 'contractor.updated', { entity: 'contractor', entityId: id });
    },
    /** Staff decision: only approved contractors can be recommended or offered work. */
    setStatus(id, status, user) {
      const c = get(id);
      if (!c) throw new HttpError(404, 'Contractor not found.');
      if (!['approved', 'candidate', 'suspended'].includes(status)) throw new HttpError(400, 'Unknown status.');
      if (status === 'approved' && (!c.skills.length || !isEmail(c.email))) throw new HttpError(400, 'Add an email address and at least one skill before approving.');
      db.update('contractors', id, { status, active: status === 'suspended' ? 0 : 1, ...(status === 'approved' ? { approved_by: user.id, approved_at: now() } : {}) });
      if (status !== 'approved') app.sessions.endAllFor('contractor', id);
      app.audit.log(`staff:${user.email}`, `contractor.${status}`, { entity: 'contractor', entityId: id, detail: c.name });
    },
    issuePortalKey(id, user) {
      const c = get(id);
      if (!c || c.status !== 'approved') throw new HttpError(409, 'Approve the contractor before issuing portal access.');
      const key = token(24);
      db.update('contractors', id, { portal_key_hash: sha256(key), portal_key_issued_at: now() });
      app.sessions.endAllFor('contractor', id);
      app.audit.log(`staff:${user.email}`, 'contractor.portal_key_issued', { entity: 'contractor', entityId: id });
      return key;
    },
    byPortalKey: (key) => (key ? hydrate(db.get("SELECT * FROM contractors WHERE portal_key_hash = ? AND status = 'approved'", sha256(key))) : null),

    /**
     * Approved contractors able to take a job type, best first. The profile returned is what an
     * agent may see: no email address or other contact details.
     */
    search({ jobType, category = '', excludeIds = [] }) {
      const exclude = new Set(excludeIds.map(Number));
      return db.all("SELECT * FROM contractors WHERE status = 'approved' ORDER BY id").map(hydrate)
        .filter((c) => c.skills.includes(jobType) && !exclude.has(c.id))
        .map((c) => ({
          contractor_id: c.id, name: c.name, discipline: c.discipline, skills: c.skills, categories: c.categories,
          hourly_rate_cents: c.hourly_rate_cents, capacity: c.capacity, active_assignments: load(c.id), completed_assignments: signedOff(c.id),
          available: load(c.id) < c.capacity, category_match: Boolean(category && c.categories.includes(category)), notes: c.notes.slice(0, 300),
        }))
        .sort((a, b) => (b.available - a.available) || (b.category_match - a.category_match) || (b.completed_assignments - a.completed_assignments) || (a.hourly_rate_cents - b.hourly_rate_cents));
    },
  };
}

module.exports = { createContractors, ACTIVE_ASSIGNMENT };
