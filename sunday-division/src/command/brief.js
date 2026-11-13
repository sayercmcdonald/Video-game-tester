'use strict';
const { localDate, localHour } = require('./time');

const TARGET_REF = { send_quote: 'quote', approve_assignment: 'assignment', send_message: 'message', issue_invoice: 'invoice', sign_off_deliverable: 'deliverable', release_deliverable: 'deliverable', retry_task: 'job', draft_quote: 'project' };
const MONEY = /\$\d[\d,]*(?:\.\d{2})?/g;
const CODES = /\bSD-[A-Z]?\d{2,}\b/g;

/**
 * The Morning Brief — the founder app's AI workflow.
 *
 *   1. The application collects verified facts for the window since the last brief and
 *      stores them with the brief (so what the model saw is kept with what it wrote).
 *   2. A durable job runs the Command Agent (model or rules) with one read-only tool.
 *   3. Its output is checked against the facts: every item must cite existing fact ids,
 *      and any amount or project code it mentions must appear in a cited fact. Anything
 *      that fails is removed and counted. Suggested actions keep their target only if a
 *      cited fact refers to that record.
 *   4. The founder is notified; suggested actions open as ordinary previews to confirm.
 */
function createBrief(app) {
  const { db } = app;
  const nowMs = () => app.orchestrator.clock();
  const tz = () => app.settings.get('timezone');
  const hydrate = (b) => (b ? { ...b, facts: JSON.parse(b.facts), content: b.content ? JSON.parse(b.content) : null } : null);

  function request({ manual = false, by = 'system:schedule' } = {}) {
    const t = nowMs();
    const date = localDate(t, tz());
    // The daily brief covers the time since the previous daily brief; "generate now" covers
    // the time since the most recent brief of either kind.
    const last = manual
      ? db.get("SELECT window_end FROM briefs WHERE status != 'failed' ORDER BY id DESC LIMIT 1")
      : db.get("SELECT window_end FROM briefs WHERE status != 'failed' AND idempotency_key NOT LIKE '%:manual:%' ORDER BY id DESC LIMIT 1");
    const from = last ? last.window_end : new Date(t - 24 * 3600e3).toISOString();
    const to = new Date(t).toISOString();
    const key = manual ? `brief:${date}:manual:${db.get("SELECT COUNT(*) AS n FROM briefs WHERE brief_date = ?", date).n + 1}` : `brief:${date}`;
    const existing = db.get('SELECT * FROM briefs WHERE idempotency_key = ?', key);
    if (existing) return hydrate(existing);
    const facts = app.command.facts.collect(from, to);
    const id = db.insertIgnore('briefs', { brief_date: date, idempotency_key: key, window_start: from, window_end: to, facts: JSON.stringify(facts), requested_by: by, created_at: to });
    if (!id) return hydrate(db.get('SELECT * FROM briefs WHERE idempotency_key = ?', key));
    const job = app.orchestrator.queue.ensure({ key: `command:${key}@${to}`, agent: 'command', action: 'morning_brief', input: { brief_id: id }, priority: 3 });
    db.run('UPDATE briefs SET job_id = ? WHERE id = ?', job.id, id);
    return get(id);
  }

  /** Scheduled once per local day at the founder's chosen hour. */
  function due() {
    const t = nowMs();
    const date = localDate(t, tz());
    if (localHour(t, tz()) < app.settings.get('brief_hour')) return null;
    if (db.get('SELECT 1 FROM briefs WHERE idempotency_key = ?', `brief:${date}`)) return null;
    return request();
  }

  function verify(output, facts) {
    const byId = new Map(facts.map((f) => [f.id, f]));
    let dropped = 0;
    const ok = (item) => {
      const ids = Array.isArray(item.fact_ids) ? item.fact_ids : [];
      if (!ids.length || !ids.every((id) => byId.has(id))) return false;
      const source = ids.map((id) => byId.get(id).text).join(' \n ');
      const claims = [...(item.text.match(MONEY) || []), ...(item.text.match(CODES) || [])];
      return claims.every((c) => source.includes(c));
    };
    const keep = (item) => { if (ok(item)) return true; dropped += 1; return false; };
    const headline = output.headline && keep(output.headline) ? output.headline : { text: 'Your brief', fact_ids: [] };
    const sections = (output.sections || []).map((s) => ({ title: s.title, items: s.items.filter(keep) })).filter((s) => s.items.length);
    const actions = (output.actions || []).filter(keep).map((a) => {
      if (!a.action_type) return { ...a, action_type: null, target_id: null };
      const prefix = TARGET_REF[a.action_type];
      const refs = a.fact_ids.map((id) => byId.get(id).ref || '');
      const backed = prefix && a.target_id && refs.some((r) => r === `${prefix}:${a.target_id}` || r.startsWith(`${prefix}:${a.target_id}:`));
      return backed ? a : { ...a, action_type: null, target_id: null };
    });
    return { content: { headline, sections, actions }, dropped };
  }

  function finalize(job) {
    const b = db.get('SELECT * FROM briefs WHERE job_id = ?', job.id);
    if (!b || b.status !== 'pending') return;
    if (job.status === 'failed' || job.status === 'cancelled') {
      db.run("UPDATE briefs SET status = 'failed' WHERE id = ?", b.id);
      return;
    }
    if (job.status !== 'succeeded') return;
    const { content, dropped } = verify(job.output || {}, JSON.parse(b.facts));
    const session = app.agentRuntime.session(job.id);
    const simulated = db.get("SELECT 1 FROM agent_runs WHERE job_id = ? AND provider = 'simulated'", job.id);
    const brain = !session || session.brain === 'rules' ? 'rules' : simulated ? 'simulated' : session.provider || 'anthropic';
    db.run("UPDATE briefs SET status = 'ready', content = ?, brain = ?, dropped = ?, ready_at = ? WHERE id = ?", JSON.stringify(content), brain, dropped, new Date(nowMs()).toISOString(), b.id);
    app.command.notifications.create({ kind: 'brief', title: 'Your Morning Brief is ready', body: content.headline.text, link: `/command/brief/${b.id}`, key: `brief:${b.id}` });
  }

  function get(id) { return hydrate(db.get('SELECT * FROM briefs WHERE id = ?', id)); }

  return {
    request, due, finalize, verify, get,
    latest: () => hydrate(db.get("SELECT * FROM briefs WHERE status = 'ready' ORDER BY id DESC LIMIT 1")),
    pending: () => hydrate(db.get("SELECT * FROM briefs WHERE status = 'pending' ORDER BY id DESC LIMIT 1")),
    list: (limit = 14) => db.all('SELECT id, brief_date, status, brain, dropped, created_at, ready_at FROM briefs ORDER BY id DESC LIMIT ?', limit),
  };
}

module.exports = { createBrief };
