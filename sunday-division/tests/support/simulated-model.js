'use strict';
/**
 * SIMULATED MODEL — for automated tests only.
 *
 * Stands in for Claude in the agent loop. It reads the request exactly as the real API would
 * receive it (system prompt, tool definitions, transcript), decides which tools to call from
 * the real tool results, and returns Messages-API-shaped responses. Every run it makes is
 * recorded with provider "simulated". It never fabricates application state: everything it
 * "does" goes through the application's tools, which can refuse.
 */
const { REGISTRY } = require('../../src/agents/definitions');

let seq = 0;
const id = (p) => `${p}_sim_${++seq}`;
const use = (name, input) => ({ type: 'tool_use', id: id('toolu'), name, input });
const say = (text) => ({ type: 'text', text });
const response = (content, { usage = { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop } = {}) => ({
  id: id('msg'), type: 'message', role: 'assistant', model: 'simulated-model',
  stop_reason: stop || (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'), content, usage,
});

/** Identify the agent action from the request, the way a person reading it would. */
function identify(req) {
  const first = req.messages[0].content[0].text;
  for (const agent of Object.values(REGISTRY)) {
    if (!req.system || req.system !== agent.systemPrompt) continue;
    for (const action of Object.values(agent.actions)) if (action.instruction && first.startsWith(action.instruction)) return { agent: agent.id, action: action.id };
  }
  throw new Error('simulated model: unknown agent action');
}

/** Parse the latest tool results by tool name. */
function results(req) {
  const out = {};
  const msgs = req.messages;
  const last = msgs[msgs.length - 1];
  const prev = msgs[msgs.length - 2];
  if (!last || last.role !== 'user' || !prev || prev.role !== 'assistant') return out;
  for (const r of last.content.filter((b) => b.type === 'tool_result')) {
    const call = prev.content.find((b) => b.type === 'tool_use' && b.id === r.tool_use_id);
    const text = Array.isArray(r.content) ? r.content.find((c) => c.type === 'text').text : r.content;
    let value; try { value = JSON.parse(text); } catch { value = text; }
    (out[call.name] = out[call.name] || []).push({ value, error: Boolean(r.is_error), attachments: Array.isArray(r.content) ? r.content.filter((c) => c.type !== 'text') : [], input: call.input });
  }
  return out;
}
const turnOf = (req) => req.messages.filter((m) => m.role === 'assistant').length;
const input = (req) => JSON.parse(/<task_input>\n([\s\S]*?)\n<\/task_input>/.exec(req.messages[0].content[0].text)[1]);
const one = (r, name) => (r[name] && r[name][0] ? r[name][0].value : null);

const SCRIPTS = {
  'sales.qualify': (req, t, r) => {
    if (t === 0) return [use('get_inquiry', {})];
    if (t === 1) {
      const q = one(r, 'get_inquiry');
      const map = { design: 'design', flats: 'technical', techpack: 'technical', '3d': '3d', imagery: 'imagery', campaign: 'imagery' };
      return [say('The inquiry is a genuine development request.'), use('save_triage', {
        summary: `${q.brand_name} wants ${q.requested_deliverables.join(', ')} for a ${q.garment_category.toLowerCase()} piece.`,
        services: [...new Set(q.requested_deliverables.map((d) => map[d]))], suggested_package: q.package_interest || 'development', priority: 'normal',
        qualified: true, qualification_note: 'Clear garment and deliverables.', missing_information: q.fabric_preferences ? [] : ['Fabric preferences'],
        clarifying_questions: ['Confirm the base size.'], risk_flags: [],
      })];
    }
    const q = r.save_triage ? null : null; // eslint-disable-line no-unused-vars
    return [use('submit_result', { qualified: true, suggested_package: 'development', services: ['technical', '3d'], priority: 'normal', missing_count: 0, risk_flags: [] })];
  },
  'sales.draft_proposal': (req, t, r) => {
    if (t === 0) return [use('get_project', {}), use('list_quotes', {})];
    if (t === 1) {
      const p = one(r, 'get_project');
      return [
        use('save_brief_draft', { brief: `OBJECTIVE\n${p.description}\n\nGARMENT\n${p.garment_category}\n\nDELIVERABLES\n${p.requested_deliverables.join(', ')}\n\nOPEN QUESTIONS\n- Confirm base size.` }),
        use('save_quote_draft', { scope: `Development of the ${p.garment_category.toLowerCase()} piece: design finalisation, technical flats, tech pack and a 3D visualisation.`, line_items: [{ description: 'Design finalisation', quantity: 1, unit_price_usd: 600 }, { description: 'Technical flats and tech pack', quantity: 1, unit_price_usd: 1400 }, { description: '3D visualisation', quantity: 1, unit_price_usd: 400 }], deposit_percent: 50, assumptions: ['One garment, two revision rounds.'] }),
      ];
    }
    const q = one(r, 'save_quote_draft');
    return [use('submit_result', { summary: `Quote drafted for $${q ? q.total_usd : 0}.`, flags: ['Confirm the base size before sending.'] })];
  },
  'client_success.quote_notice': (req, t) => {
    if (t === 0) return [use('get_project', {}), use('list_quotes', {})];
    if (t === 1) return [use('prepare_client_message', { purpose: 'quote_ready', subject: 'Your quote is ready', body: 'Hello,\n\nYour quote is ready to review in your client portal.\n\nSunday Division' })];
    return [use('submit_result', { message_id: 1 })];
  },
  'client_success.kickoff_update': (req, t, r) => {
    if (t === 0) return [use('get_project', {}), use('list_tasks', {})];
    if (t === 1) return [use('save_status_update_draft', { text: 'Your deposit has been received and work has started with a kickoff call.' })];
    return [use('submit_result', { update_id: (one(r, 'save_status_update_draft') || {}).update_id || null })];
  },
  'project_manager.plan': (req, t, r) => {
    if (t === 0) return [use('get_project', {}), use('list_tasks', {})];
    if (t === 1) {
      const p = one(r, 'get_project');
      return [
        use('create_tasks', { tasks: [{ title: 'Kickoff call', milestone: 'Kickoff', due_in_days: 2 }, { title: 'Internal technical review', milestone: 'Review', due_in_days: 18 }, { title: 'Release final files', milestone: 'Delivery', due_in_days: 24 }] }),
        use('create_production_tasks', { tasks: p.allowed_production_job_types.map((j, i) => ({ job_type: j, title: `${j.replace(/_/g, ' ')} for ${p.code}`, due_in_days: 8 + i * 3 })) }),
      ];
    }
    return [use('submit_result', { tasks_created: 3, production_tasks_created: (one(r, 'create_production_tasks') || { created: 0 }).created, proposed_due_date: '2027-01-15', notes: '' })];
  },
  'production.prepare': (req, t, r) => {
    if (t === 0) return [use('list_tasks', {})];
    if (t === 1) {
      const tasks = one(r, 'list_tasks').filter((x) => x.kind === 'production' && !x.route);
      return tasks.map((x) => use('save_technical_brief', { task_id: x.task_id, brief: `TASK\n${x.title}\n\nSIZING\nWork to base size M.\n\nOPEN QUESTIONS\n- None.`, checklist: ['Files named with the project code'] }));
    }
    if (t === 2) return (r.save_technical_brief || []).map((x) => use('set_task_route', { task_id: x.input.task_id, route: 'contractor' }));
    return [use('submit_result', { items: (r.set_task_route || []).map((x) => ({ task_id: x.input.task_id, route: 'contractor' })), open_questions: [] })];
  },
  'talent.recommend': (req, t, r) => {
    const task = input(req).task_id;
    if (t === 0) return [use('get_task', { task_id: task })];
    if (t === 1) return [use('search_contractors', { task_id: task })];
    if (t === 2) {
      const pick = (one(r, 'search_contractors') || []).find((c) => c.available);
      if (!pick) return [use('request_human_review', { kind: 'escalation', title: `Find a contractor for task ${task}`, detail: 'Nobody suitable is available.', ref: null })];
      return [use('recommend_contractor', { task_id: task, contractor_id: pick.contractor_id, estimated_hours: 7.5, rationale: `${pick.name} is approved for this job type and is available.` })];
    }
    const rec = one(r, 'recommend_contractor');
    return [use('submit_result', { recommended_contractor_id: rec && rec.assignment_id ? 1 : null, estimated_hours: rec ? 7.5 : null, escalated: !rec, notes: rec ? 'Recommended the first available approved contractor.' : 'Escalated.' })];
  },
  'qa.check': (req, t, r) => {
    const { deliverable_id: did, version } = input(req);
    if (t === 0) return [use('list_deliverables', {})];
    if (t === 1) {
      const d = one(r, 'list_deliverables').find((x) => x.deliverable_id === did);
      return [...(d.task_id ? [use('get_task', { task_id: d.task_id })] : []), use('inspect_deliverable', { deliverable_id: did })];
    }
    if (t === 2) {
      const insp = r.inspect_deliverable[0];
      const task = one(r, 'get_task');
      const read = insp.attachments.some((a) => a.type === 'document' && a.source && a.source.data);
      const checks = [
        { name: 'file_integrity', status: insp.value.integrity_ok ? 'pass' : 'fail', detail: '' },
        { name: 'read_contents', status: read ? 'pass' : 'warn', detail: read ? 'PDF contents attached and read.' : 'Contents not attached.' },
        ...((task && task.checklist) || []).map((c) => ({ name: c.slice(0, 120), status: 'pass', detail: 'Present in the file.' })),
      ];
      return [use('record_qa_report', { deliverable_id: did, version, result: 'pass', checks, missing_information: [] })];
    }
    const rec = one(r, 'record_qa_report');
    return [use('submit_result', { result: rec ? rec.result : 'warn', failed: 0, warnings: 0, missing_information: [] })];
  },
};

/**
 * Create a simulated transport. `overrides` maps "agent.action" to a script with the same
 * signature (req, turn, results) => content blocks, for tests that need misbehaviour.
 */
function simulatedModel(overrides = {}) {
  const calls = [];
  const transport = async (req) => {
    const { agent, action } = identify(req);
    const key = `${agent}.${action}`;
    calls.push({ key, req });
    const script = overrides[key] || SCRIPTS[key];
    if (!script) throw new Error(`simulated model: no script for ${key}`);
    const out = await script(req, turnOf(req), results(req));
    return out && out.type === 'message' ? out : response(out);
  };
  transport.calls = calls;
  return transport;
}

module.exports = { simulatedModel, response, use, say, results, input, turnOf };
