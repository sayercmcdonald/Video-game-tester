'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Minimal .env loader: KEY=VALUE per line, never overrides real environment. */
function loadEnvFile(file, env) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (env[m[1]] === undefined) env[m[1]] = value;
  }
}

function createConfig(env = process.env) {
  if (env === process.env) loadEnvFile(path.join(ROOT, '.env'), env);
  const mode = env.NODE_ENV || 'development';
  const isProd = mode === 'production';
  const port = Number(env.PORT || 3000);
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  const stripeSecretKey = env.STRIPE_SECRET_KEY || '';
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET || '';
  let provider = (env.PAYMENTS_PROVIDER || '').toLowerCase();
  if (!provider) provider = stripeSecretKey ? 'stripe' : (isProd ? 'none' : 'simulated');

  const problems = [];
  if (!['stripe', 'simulated', 'none'].includes(provider)) problems.push(`Unknown PAYMENTS_PROVIDER "${provider}".`);
  if (isProd && provider === 'simulated') problems.push('PAYMENTS_PROVIDER=simulated is refused in production.');
  if (provider === 'stripe' && (!stripeSecretKey || !stripeWebhookSecret)) {
    problems.push('Stripe needs both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
  }
  if (isProd && !/^https:\/\//.test(baseUrl)) problems.push('BASE_URL must be an https:// URL in production.');
  // Outbound messages: 'simulated' records delivery without sending anything (development and
  // tests only); 'manual' hands approved messages to staff to send themselves.
  const messagingProvider = (env.MESSAGING_PROVIDER || (isProd ? 'manual' : 'simulated')).toLowerCase();
  if (!['simulated', 'manual'].includes(messagingProvider)) problems.push(`Unknown MESSAGING_PROVIDER "${messagingProvider}".`);
  if (isProd && messagingProvider === 'simulated') problems.push('MESSAGING_PROVIDER=simulated is refused in production.');
  if (problems.length) throw new Error('Configuration error:\n - ' + problems.join('\n - '));

  return {
    root: ROOT,
    mode,
    isProd,
    port,
    host: env.HOST || '0.0.0.0',
    baseUrl,
    secureCookies: baseUrl.startsWith('https://'),
    trustProxy: env.TRUST_PROXY === '1',
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
    studioEmail: env.STUDIO_EMAIL || '',
    notifyWebhookUrl: env.NOTIFY_WEBHOOK_URL || '',
    bootstrapAdmin: { email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '', name: env.ADMIN_NAME || 'Studio Admin' },
    payments: {
      provider,
      currency: 'usd',
      stripeSecretKey,
      // The simulated provider signs its own events with this dev-only secret so the
      // real signature-verification path is exercised end to end.
      stripeWebhookSecret: stripeWebhookSecret || (provider === 'simulated' ? 'whsec_simulated_dev_only' : ''),
      stripeApiBase: env.STRIPE_API_BASE || 'https://api.stripe.com',
    },
    ai: {
      // auto: Claude when credentials are available, rules-based drafting otherwise.
      provider: (env.AI_PROVIDER || 'auto').toLowerCase(),
      model: env.AI_MODEL || 'claude-opus-5-5',
      agentEffort: env.AI_AGENT_EFFORT || 'medium',
    },
    integrations: {
      index_v3: { baseUrl: (env.INDEX_V3_API_URL || '').replace(/\/+$/, ''), apiKey: env.INDEX_V3_API_KEY || '' },
      form: { baseUrl: (env.FORM_API_URL || '').replace(/\/+$/, ''), apiKey: env.FORM_API_KEY || '' },
    },
    messaging: { provider: messagingProvider },
    orchestrator: {
      // How often the in-process worker looks for work; 0 disables the timer (tests drive it).
      pollMs: env.ORCHESTRATOR_POLL_MS === undefined ? 2000 : Number(env.ORCHESTRATOR_POLL_MS),
      sweepMs: Number(env.ORCHESTRATOR_SWEEP_MS || 5 * 60e3),
      concurrency: Math.max(1, Number(env.ORCHESTRATOR_CONCURRENCY || 2)),
      leaseMs: Number(env.ORCHESTRATOR_LEASE_MS || 10 * 60e3),
    },
    budgets: {
      aiMonthlyUsd: Number(env.AI_MONTHLY_BUDGET_USD || 25),
      aiProjectUsd: Number(env.AI_PROJECT_BUDGET_USD || 3),
      externalProjectUsd: Number(env.EXTERNAL_PROJECT_BUDGET_USD || 50),
      externalJobEstimateUsd: Number(env.EXTERNAL_JOB_ESTIMATE_USD || 5),
    },
    limits: {
      intakeFiles: 6,
      intakeFileBytes: 8 * 1024 * 1024,
      adminFileBytes: 50 * 1024 * 1024,
    },
  };
}

module.exports = { createConfig, ROOT };
