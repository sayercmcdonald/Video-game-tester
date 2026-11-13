'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startApp, Browser, INQUIRY, ADMIN } = require('./helpers');
const { createConfig } = require('../src/config');
const { toOpenAISchema, fromOpenAIArgs } = require('../src/ai/providers/schema');
const { S, validate } = require('../src/lib/schema');
const { signInFounder, json } = require('./support/command');

test('OpenAI strict schemas: optional fields become required-but-nullable, and nulls are removed again', () => {
  const schema = S.obj({ title: S.str(80), note: S.nullable(S.str(200)), extra: S.str(50), items: S.arr(S.obj({ a: S.int(0), b: S.str(10) }, ['b'])) }, ['extra']);
  const out = toOpenAISchema(schema);
  assert.deepEqual(out.required, ['title', 'note', 'extra', 'items']);
  assert.equal(out.additionalProperties, false);
  assert.deepEqual(out.properties.extra, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.equal(out.properties.title.maxLength, undefined, 'unsupported constraints are stripped; the app validates afterwards');
  assert.deepEqual(out.properties.items.items.required, ['a', 'b']);
  const back = fromOpenAIArgs(schema, { title: 'x', note: null, extra: null, items: [{ a: 1, b: null }] });
  assert.deepEqual(back, { title: 'x', note: null, items: [{ a: 1 }] });
  assert.deepEqual(validate(schema, back), []);
});

test('configuration: OpenAI needs a model and prices; Anthropic is the default', () => {
  assert.throws(() => createConfig({ NODE_ENV: 'test', AI_PROVIDER: 'openai' }), /OPENAI_MODEL/);
  assert.throws(() => createConfig({ NODE_ENV: 'test', AI_PROVIDER: 'openai', OPENAI_MODEL: 'm' }), /PRICE/);
  const c = createConfig({ NODE_ENV: 'test', AI_PROVIDER: 'openai', OPENAI_MODEL: 'm', OPENAI_PRICE_INPUT_PER_MTOK: '1', OPENAI_PRICE_OUTPUT_PER_MTOK: '2' });
  assert.deepEqual(c.ai.openai.prices, { input: 1, output: 2, cacheRead: 1 });
  assert.equal(createConfig({ NODE_ENV: 'test', AI_PROVIDER: 'claude' }).ai.provider, 'anthropic', 'old value still accepted');
  assert.throws(() => createConfig({ NODE_ENV: 'production', BASE_URL: 'https://x.test', PUSH_EXTRA_HOSTS: '127.0.0.1:1' }), /PUSH_EXTRA_HOSTS/);
});

/** A local stand-in for the OpenAI Chat Completions endpoint, scripted per test. */
async function mockOpenAI(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ url: req.url, auth: req.headers.authorization, body: parsed });
      const { status = 200, message, finish = 'tool_calls', usage = { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 200 } } } = script(parsed, requests.length);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { id: `c${requests.length}`, object: 'chat.completion', model: 'gpt-test-2026', choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason: finish }], usage } : { error: { message: 'temporarily overloaded' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { requests, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() };
}
const call = (id, name, args) => ({ tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const TRIAGE = { summary: 'Field jacket for cyclists.', services: ['technical'], suggested_package: 'development', priority: 'normal', qualified: true, qualification_note: 'Clear brief and budget.', missing_information: [], clarifying_questions: [], risk_flags: [] };
const RESULT = { qualified: true, suggested_package: 'development', services: ['technical'], priority: 'normal', missing_count: 0, risk_flags: [] };

test('an agent task runs end to end on OpenAI through the same tools, permissions and records', async (t) => {
  let failOnce = true;
  const api = await mockOpenAI((body, n) => {
    const last = body.messages[body.messages.length - 1];
    if (last.role === 'user') return { message: call('call_1', 'get_inquiry', {}) };
    if (last.tool_call_id === 'call_1') {
      if (failOnce) { failOnce = false; return { status: 503 }; }
      return { message: call('call_2', 'save_triage', TRIAGE) };
    }
    if (last.tool_call_id === 'call_2') return { message: call('call_3', 'submit_result', RESULT) };
    throw new Error(`unexpected turn ${n}`);
  });
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const { app, base, close } = await startApp({ AI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-test', OPENAI_PRICE_INPUT_PER_MTOK: '1', OPENAI_PRICE_OUTPUT_PER_MTOK: '4', OPENAI_PRICE_CACHED_INPUT_PER_MTOK: '0.5', OPENAI_BASE_URL: api.url });
  t.after(async () => { await close(); api.close(); delete process.env.OPENAI_API_KEY; });

  await new Browser(base).upload('/start', INQUIRY);
  app.orchestrator.processEvents();
  const job = app.db.get("SELECT * FROM jobs WHERE agent = 'sales' AND action = 'qualify'");
  await app.orchestrator.drain({ maxRounds: 3 });

  await t.test('a transient provider error is retried later, on the same provider', async () => {
    assert.equal(app.orchestrator.queue.get(job.id).status, 'queued');
    // The founder switches the provider to rules while the task waits: it still finishes on OpenAI.
    app.settings.set('ai_provider', 'rules', { email: 'founder@example.test' });
    app.orchestrator.clockState.offsetMs = 10 * 60e3;
    await app.orchestrator.drain({ maxRounds: 5 });
    const done = app.orchestrator.queue.get(job.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    assert.equal(app.agentRuntime.session(job.id).provider, 'openai');
  });

  await t.test('the request is a strict function-calling request with no parallel calls', () => {
    const first = api.requests[0];
    assert.equal(first.url, '/v1/chat/completions');
    assert.equal(first.auth, 'Bearer sk-test-not-real');
    assert.equal(first.body.model, 'gpt-test');
    assert.equal(first.body.parallel_tool_calls, false);
    assert.equal(first.body.messages[0].role, 'system');
    assert.match(first.body.messages[0].content, /Sales Agent/);
    const names = first.body.tools.map((x) => x.function.name).sort();
    assert.deepEqual(names, ['get_catalog', 'get_inquiry', 'save_triage', 'submit_result']);
    for (const tool of first.body.tools) {
      assert.equal(tool.type, 'function');
      assert.equal(tool.function.strict, true);
      assert.deepEqual(tool.function.parameters.required, Object.keys(tool.function.parameters.properties));
    }
    const later = api.requests[api.requests.length - 1].body.messages;
    const assistant = later.find((m) => m.role === 'assistant' && m.tool_calls);
    assert.equal(assistant.tool_calls[0].function.name, 'get_inquiry');
    const toolMsg = later.find((m) => m.role === 'tool');
    assert.equal(toolMsg.tool_call_id, 'call_1');
    assert.ok(!/jordan@northfield\.test/.test(toolMsg.content), 'client contact details are withheld from the model');
  });

  await t.test('cost uses the configured OpenAI prices, including cached input', () => {
    const runs = app.db.all("SELECT * FROM agent_runs WHERE job_id = ? AND status = 'ok'", job.id);
    assert.equal(runs.length, 3);
    for (const r of runs) {
      assert.equal(r.provider, 'openai');
      assert.equal(r.model_served, 'gpt-test-2026');
      assert.equal(r.input_tokens, 800);
      assert.equal(r.cache_read_tokens, 200);
      assert.equal(r.cost_micros, 800 * 1 + 50 * 4 + 200 * 0.5);
    }
    assert.ok(app.db.get("SELECT 1 FROM agent_runs WHERE job_id = ? AND status = 'error' AND provider = 'openai'", job.id), 'the failed call is recorded too');
    assert.equal(app.db.get('SELECT triage_source FROM inquiries WHERE id = ?', job.inquiry_id).triage_source !== undefined, true);
  });

  await t.test('the Agent tasks viewer renders an OpenAI transcript', async () => {
    const admin = new Browser(base);
    await admin.get('/admin/login');
    await admin.post('/admin/login', ADMIN);
    const page = await admin.get(`/admin/ops/tasks/${job.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /OpenAI/);
    assert.match(page.text, /→ save_triage/);
  });
});

test('Command Chat works through OpenAI with the same read-only tools', async (t) => {
  const api = await mockOpenAI((body) => {
    const last = body.messages[body.messages.length - 1];
    if (last.role === 'user') return { message: call('c1', 'earnings', { period: 'this_week' }) };
    const data = JSON.parse(last.content);
    return { message: { content: `This week you received ${data.revenue_received}.` }, finish: 'stop' };
  });
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const { app, base, close } = await startApp({ AI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-test', OPENAI_PRICE_INPUT_PER_MTOK: '1', OPENAI_PRICE_OUTPUT_PER_MTOK: '4', OPENAI_BASE_URL: api.url, FOUNDER_EMAIL: ADMIN.email });
  t.after(async () => { await close(); api.close(); delete process.env.OPENAI_API_KEY; });
  const b = await signInFounder(base);
  const res = await json(b, '/command/api/chat', { text: 'What did we earn this week?' });
  assert.equal(res.status, 200);
  assert.equal(res.data.brain, 'openai');
  assert.match(res.data.html, /This week you received \$0\.00/);
  assert.equal(api.requests[0].body.tools.find((x) => x.function.name === 'earnings').function.strict, true);
  assert.equal(app.db.get("SELECT COUNT(*) AS n FROM agent_runs WHERE agent = 'command' AND provider = 'openai'").n, 2);
});
