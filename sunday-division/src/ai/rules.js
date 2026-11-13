'use strict';
const catalog = require('../services/catalog');
const { money } = require('../lib/util');

/**
 * Deterministic drafting used when no AI credentials are configured (and as the fallback
 * if a model call fails). Same output shapes as the model, so everything downstream is identical.
 */

const BUDGET_FLOOR = { 'Under $750': 0, '$750 – $2,000': 750, '$2,000 – $5,000': 2000, '$5,000 – $10,000': 5000, '$10,000+': 10000 };
const labelFor = (id) => (catalog.DELIVERABLE_OPTIONS.find((d) => d.id === id) || { label: id }).label;

function suggestPackage(inq) {
  if (catalog.packageById(inq.package_interest)) return inq.package_interest;
  const wants = new Set(inq.deliverables || []);
  if (inq.garment_category === 'Full collection' || (BUDGET_FLOOR[inq.budget] || 0) >= 5000) return 'collection';
  if (wants.has('flats') || wants.has('techpack') || wants.has('3d')) return 'development';
  return 'concept';
}

/** Map requested deliverables onto the four studio services. */
function servicesFor(inq) {
  const map = { design: 'design', flats: 'technical', techpack: 'technical', '3d': '3d', imagery: 'imagery', campaign: 'imagery' };
  return [...new Set((inq.deliverables || []).map((d) => map[d]).filter(Boolean))];
}

function triage(inq, { referenceCount = 0 } = {}) {
  const pkg = catalog.packageById(suggestPackage(inq));
  const missing = [];
  const questions = [];
  const flags = [];
  if (!inq.measurements) { missing.push('Target measurements or size range'); questions.push('Which size range should we develop for, and do you have a base size or fit reference?'); }
  if (!inq.fabric_preferences) { missing.push('Fabric and material preferences'); questions.push('Do you have fabrics or a hand-feel in mind, or should we propose options?'); }
  if (!referenceCount) { missing.push('Reference images'); questions.push('Can you share reference images or links for silhouette, detail and mood?'); }
  if (inq.description.length < 160) { missing.push('A fuller description of the garment and its intended customer'); questions.push('Who is the garment for, and what should it do that existing options do not?'); }
  if (pkg.id === 'collection') questions.push('How many styles do you expect in the collection?');

  const floor = BUDGET_FLOOR[inq.budget];
  if (floor !== undefined && floor < pkg.fromCents / 100 && inq.budget !== 'Not sure yet') {
    flags.push(`Stated budget (${inq.budget}) may sit below the ${pkg.name} starting price of ${money(pkg.fromCents)}.`);
  }
  if (inq.timeline === 'Within 2 weeks' && pkg.id !== 'concept') flags.push(`Requested timeline (within 2 weeks) is shorter than the typical ${pkg.typicalTimeline} for ${pkg.name}.`);
  if (/\b(manufactur|production run|factory|sampling|samples?|sourcing|bulk order)/i.test(`${inq.description} ${inq.fabric_preferences}`)) {
    flags.push('Mentions manufacturing, sampling or sourcing — outside the current offer; set expectations early.');
  }
  let priority = 'normal';
  if ((floor || 0) >= 2000 && ['Within 2 weeks', '2–4 weeks'].includes(inq.timeline)) priority = 'high';
  if (inq.budget === 'Under $750') priority = 'low';

  const wants = (inq.deliverables || []).map(labelFor).join(', ').toLowerCase();
  return {
    services: servicesFor(inq),
    qualified: true,
    qualification_note: 'Valid submission through the intake form.',
    summary: `${inq.brand_name} is asking for ${wants || 'design support'} for a ${inq.garment_category.toLowerCase()} project. Budget: ${inq.budget}; timeline: ${inq.timeline}.`,
    suggested_package: pkg.id,
    priority,
    missing_information: missing,
    clarifying_questions: questions,
    risk_flags: flags,
  };
}

function brief(inq, { referenceCount = 0, project } = {}) {
  const t = inq.triage || triage(inq, { referenceCount });
  const pkg = catalog.packageById((project && project.package) || t.suggested_package);
  const lines = [
    'OBJECTIVE', inq.description, '',
    'GARMENT', `${inq.garment_category}${pkg ? ` — ${pkg.name} package` : ''}`, '',
    'DELIVERABLES', ...(inq.deliverables || []).map((d) => `- ${labelFor(d)}`), '',
    'SIZING & MEASUREMENTS', inq.measurements || 'Not provided — confirm with client.', '',
    'FABRIC & MATERIALS', inq.fabric_preferences || 'Not provided — confirm with client.', '',
    'BUDGET & TIMELINE', `Budget: ${inq.budget}`, `Timeline: ${inq.timeline}`, '',
    'REFERENCES', referenceCount ? `${referenceCount} reference file(s) supplied with the inquiry.` : 'None supplied.', '',
    'OPEN QUESTIONS', ...(t.clarifying_questions.length ? t.clarifying_questions.map((q) => `- ${q}`) : ['- None identified.']), '',
    'OUT OF SCOPE', 'Manufacturing, sampling, sourcing and physical production.',
  ];
  return { brief: lines.join('\n') };
}

function quote(inq, { project } = {}) {
  const pkgId = (project && project.package) || (inq.triage && inq.triage.suggested_package) || suggestPackage(inq);
  const wants = new Set(inq.deliverables || []);
  const items = [];
  const assumptions = [];
  const add = (description, unit, quantity = 1) => items.push({ description, quantity, unit_price_usd: unit });
  if (pkgId === 'concept') {
    add('Concept development — creative direction, design sketches, colour and fabric direction', 750);
    assumptions.push('One garment; one round of revisions.');
    if (wants.has('flats')) add('Technical flats — front and back', 400);
    if (wants.has('3d')) add('3D visualisation', 400);
  } else if (pkgId === 'development') {
    add('Design finalisation — one garment', 500);
    add('Technical flats — front, back and construction details', 400);
    add('Tech pack — construction notes, measurement spec, bill of materials', 700);
    add('3D visualisation', 400);
    assumptions.push('One garment; two rounds of revisions.');
  } else {
    const styles = 3;
    add('Range plan and collection direction', 800);
    add('Design development — per style', 500, styles);
    add('Technical flats and tech pack — per style', 500, styles);
    add('3D visualisation — per style', 200, styles);
    add('Product imagery and campaign image set', 600);
    assumptions.push(`Assumes ${styles} styles — confirm the style count with the client and adjust quantities.`);
  }
  if (pkgId !== 'collection') {
    if (wants.has('imagery')) add('Product imagery set', 600);
    if (wants.has('campaign')) add('Campaign assets', 900);
  }
  assumptions.push('Prices are the studio\'s introductory rates; adjust for complexity before sending.');
  const pkg = catalog.packageById(pkgId);
  return {
    scope: `${pkg.name} engagement for ${inq.brand_name}: ${inq.garment_category.toLowerCase()}. ${pkg.summary} Deliverables: ${items.map((i) => i.description.split(' — ')[0].toLowerCase()).join(', ')}. Manufacturing and physical production are not included.`,
    line_items: items,
    deposit_percent: 50,
    assumptions,
  };
}

function tasks(inq, { project } = {}) {
  const wants = new Set(inq.deliverables || []);
  const pkgId = (project && project.package) || suggestPackage(inq);
  const out = [];
  const add = (title, milestone, due) => out.push({ title, milestone, due_in_days: due });
  add('Kickoff call — confirm brief, sizing and references', 'Kickoff', 2);
  add('Collect outstanding information from client', 'Kickoff', 3);
  if (pkgId === 'collection') add('Range plan and collection direction', 'Design', 7);
  add('Design sketches and options', 'Design', pkgId === 'collection' ? 14 : 6);
  add('Client design review and sign-off', 'Design', pkgId === 'collection' ? 17 : 8);
  if (pkgId !== 'concept' || wants.has('flats')) add('Technical flats — front, back, details', 'Technical', pkgId === 'collection' ? 24 : 12);
  if (pkgId !== 'concept' || wants.has('techpack')) add('Tech pack — construction, measurement spec, BOM', 'Technical', pkgId === 'collection' ? 30 : 16);
  if (pkgId !== 'concept' || wants.has('3d')) add('3D garment visualisation', 'Visualisation', pkgId === 'collection' ? 34 : 19);
  if (pkgId === 'collection' || wants.has('imagery') || wants.has('campaign')) add('Product imagery and campaign assets', 'Imagery', pkgId === 'collection' ? 40 : 22);
  const end = out[out.length - 1].due_in_days;
  add('Internal technical review of all deliverables', 'Review', end + 2);
  add('Client review and revision round', 'Review', end + 5);
  add('Issue final invoice', 'Delivery', end + 6);
  add('Release final files and hand over', 'Delivery', end + 8);
  return { tasks: out };
}

function statusUpdate(state) {
  const done = state.tasks.filter((t) => t.status === 'done');
  const active = state.tasks.filter((t) => ['doing', 'review'].includes(t.status));
  const next = state.tasks.filter((t) => t.status === 'todo').slice(0, 2);
  const parts = [];
  parts.push(done.length ? `Completed so far: ${done.map((t) => t.title).join('; ')}.` : 'Work is under way; no milestones are complete yet.');
  if (active.length) parts.push(`In progress: ${active.map((t) => t.title).join('; ')}.`);
  if (next.length) parts.push(`Next: ${next.map((t) => t.title).join('; ')}.`);
  const released = state.deliverables.filter((d) => d.status === 'released');
  if (released.length) parts.push(`Available in your portal: ${released.map((d) => d.title).join('; ')}.`);
  if (state.openRevisions) parts.push(`We are working through ${state.openRevisions} open revision request(s).`);
  if (state.balanceDueCents > 0 && state.openInvoices) parts.push('An invoice is awaiting payment in your portal.');
  return { update: parts.join('\n\n') };
}

module.exports = { triage, brief, quote, tasks, statusUpdate, suggestPackage, servicesFor };
