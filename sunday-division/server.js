'use strict';
const { createConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = createConfig();
const app = createApp(config);

app.server.listen(config.port, config.host, () => {
  console.log(`Sunday Division listening on ${config.baseUrl} (${config.mode})`);
  console.log(`  payments: ${app.billing.providerName} · drafting: ${app.automation.mode()}`);
  if (config.isProd && !config.trustProxy) console.log('  note: behind a reverse proxy or load balancer, set TRUST_PROXY=1 so rate limits see real client addresses');
  if (!app.db.get('SELECT 1 FROM users LIMIT 1')) console.log('  no admin user yet — run: npm run create-admin -- you@example.com "Your Name"');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { app.close().then(() => process.exit(0)); });
}
