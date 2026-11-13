'use strict';
/**
 * Development only: fill an empty data directory with clearly labelled SAMPLE records, so
 * Sunday Division Command can be reviewed with something on screen.
 *
 *   DATA_DIR=./data-sample ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... FOUNDER_EMAIL=you@example.com \
 *     npm run seed:sample
 *
 * Everything goes through the application's own routes and services (simulated payments,
 * simulated messaging, the agents' rules brain). Brand names end in "(sample)" and Command
 * shows a "Sample data" banner for this data directory. Refused in production.
 */
const { createConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { Browser, PNG, INQUIRY } = require('../tests/helpers');

(async () => {
  const env = { ...process.env, ORCHESTRATOR_POLL_MS: '0', AI_PROVIDER: process.env.AI_PROVIDER || 'rules', PAYMENTS_PROVIDER: 'simulated', MESSAGING_PROVIDER: 'simulated' };
  if ((env.NODE_ENV || 'development') === 'production') throw new Error('seed:sample is for development only.');
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (the sample admin account).');
  const config = createConfig(env);
  const app = createApp(config);
  if (app.db.get('SELECT 1 FROM inquiries LIMIT 1')) throw new Error(`${config.dataDir} already has records. Use an empty DATA_DIR for sample data.`);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  config.baseUrl = base;
  const drain = () => app.orchestrator.drain();
  const ok = (res, what) => { if (res.status >= 400) throw new Error(`${what}: HTTP ${res.status}`); return res; };

  const admin = new Browser(base);
  await admin.get('/admin/login');
  ok(await admin.post('/admin/login', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }), 'sign in');
  await admin.open('/admin/contractors');
  const contractors = [
    { name: 'Sam Okafor (sample)', email: 'sam@contractor.test', discipline: 'Technical designer', rate: '60', capacity: '3', skills: ['technical_flats', 'tech_pack'], categories: ['Outerwear', 'Shirting'], status: 'approved' },
    { name: 'Ines Duarte (sample)', email: 'ines@contractor.test', discipline: '3D garment artist', rate: '70', capacity: '2', skills: ['garment_3d'], categories: ['Outerwear', 'Knitwear'], status: 'approved' },
    { name: 'Robin Vale (sample)', email: 'robin@contractor.test', discipline: 'Technical designer', rate: '45', capacity: '2', skills: ['tech_pack'] },
  ];
  for (const c of contractors) ok(await admin.post('/admin/contractors', c), 'contractor');

  const inquire = async (fields) => ok(await new Browser(base).upload('/start', { ...INQUIRY, ...fields }, [{ field: 'references', name: 'reference.png', data: PNG, type: 'image/png' }]), 'inquiry');

  // 1. A paid project in production, with a contractor's submission waiting for sign-off.
  await inquire({ brand_name: 'Northfield Atelier (sample)', email: 'studio@northfield.test' });
  await drain();
  const page = await admin.open('/admin/projects/1');
  const qid = /name="quote_id" value="(\d+)"/.exec(page.text)[1];
  ok(await admin.post('/admin/projects/1/quote', { quote_id: qid, action: 'send', scope: 'Field jacket: technical flats, a full tech pack and a 3D visualisation, from the client’s sketches.', item_description: ['Technical flats', 'Tech pack', '3D visualisation'], item_quantity: ['1', '1', '1'], item_unit: ['600', '900', '700'], deposit_percent: '50', terms: '' }), 'send quote');
  await drain();
  const msg = /\/admin\/messages\/(\d+)\/approve/.exec((await admin.open('/admin/messages')).text);
  if (msg) ok(await admin.post(`/admin/messages/${msg[1]}/approve`, {}), 'approve message');
  await admin.open('/admin/projects/1');
  await admin.post('/admin/projects/1/portal-key');
  const key = /data-select>([^<]+)</.exec((await admin.open('/admin/projects/1')).text)[1];
  const client = new Browser(base);
  await client.post('/portal/access', { key });
  await client.open('/portal/home');
  ok(await client.post(`/portal/quotes/${qid}/respond`, { decision: 'accept', agree: 'yes', signed_name: 'Jordan Reyes' }), 'accept quote');
  await drain();
  const inv = /portal\/invoices\/(\d+)\/pay/.exec((await client.open('/portal/home')).text)[1];
  const pay = await client.post(`/portal/invoices/${inv}/pay`);
  await client.post(new URL(pay.location).pathname, { outcome: 'pay' }, { csrf: false });
  await drain();
  const proj = await admin.open('/admin/projects/1');
  const firstA = /\/admin\/assignments\/(\d+)\/approve/.exec(proj.text)[1];
  ok(await admin.post(`/admin/assignments/${firstA}/approve`, {}), 'approve assignment');
  await admin.open('/admin/contractors');
  await admin.post('/admin/contractors/1/portal-key');
  const ckey = /data-select>([^<]+)</.exec((await admin.open('/admin/contractors')).text)[1];
  const sam = new Browser(base);
  await sam.post('/contractor/access', { key: ckey });
  await sam.open('/contractor/home');
  ok(await sam.post(`/contractor/assignments/${firstA}/respond`, { decision: 'accept', agree: 'yes', note: 'Happy to take this.' }), 'contractor accepts');
  await sam.open('/contractor/home');
  ok(await sam.upload(`/contractor/assignments/${firstA}/submit`, { note: 'Front, back and construction details.' }, [{ field: 'file', name: 'SD-P0001-technical-flats.pdf', data: Buffer.from('%PDF-1.7\n1 0 obj <</Type /Page>> endobj 2 0 obj <</Type /Page>> endobj sample technical flats'), type: 'application/pdf' }]), 'submit work');
  await drain();
  ok(await admin.post('/admin/projects/1/costs', { description: 'Sample: courier for fabric swatches and trims', amount: '640' }), 'cost');

  // 2. A new lead whose drafted quote waits for the founder.
  await inquire({ brand_name: 'Lumen Knit Studio (sample)', email: 'hello@lumen.test', garment_category: 'Knitwear', description: 'A merino polo with a knitted collar, in four colourways. We need design development and technical flats.', deliverables: ['design', 'flats'], budget: '$2,000 – $5,000' });
  // 3. A smaller lead still being qualified.
  await inquire({ brand_name: 'Hollow Pine (sample)', email: 'team@hollowpine.test', garment_category: 'Shirting', package_interest: 'concept', description: 'An overshirt concept for a small capsule.', deliverables: ['design'], budget: 'Under $750', timeline: 'Flexible' });
  await drain();

  app.db.run("INSERT INTO ops_settings (key, value, updated_by, updated_at) VALUES ('sample_data', 'true', 'system:seed', ?) ON CONFLICT(key) DO UPDATE SET value = 'true'", new Date().toISOString());
  app.command.notifications.sweep();
  app.command.brief.request({ manual: true, by: 'system:seed' });
  await drain();
  await app.command.notifications.settled();
  console.log(`Sample data written to ${config.dataDir}.`);
  console.log(`Client portal key: ${key}\nContractor portal key (Sam): ${ckey}`);
  await app.close();
})().catch((err) => { console.error(err.message || err); process.exit(1); });
