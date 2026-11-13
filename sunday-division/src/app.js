'use strict';
const { openDb } = require('./db');
const { Router, createServer } = require('./http/app');
const { createSessions, createRateLimiter } = require('./http/session');
const { hashPassword } = require('./lib/crypto');
const { now } = require('./lib/util');
const layout = require('./views/layout');

/**
 * Compose the application: one object carrying config, the database and every service.
 * Services reach each other through `app`, so there are no module-level singletons and
 * tests can run isolated instances side by side.
 */
function createApp(config) {
  const app = { config, db: openDb(config) };
  app.sessions = createSessions(app);
  app.rateLimit = createRateLimiter();
  app.audit = require('./services/audit').createAudit(app);
  app.files = require('./services/files').createFiles(app);
  app.notify = require('./services/notify').createNotify(app);
  app.projects = require('./services/projects').createProjects(app);
  app.quotes = require('./services/quotes').createQuotes(app);
  app.billing = require('./services/billing').createBilling(app);
  app.intake = require('./services/intake').createIntake(app);
  app.automation = require('./services/automation').createAutomation(app);
  app.integrations = require('./integrations').createIntegrations(app);

  // First-run convenience for container deploys: create the first admin from the environment.
  const { email, password, name } = config.bootstrapAdmin;
  if (email && password && !app.db.get('SELECT 1 FROM users LIMIT 1')) {
    if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    app.db.insert('users', { email: email.toLowerCase(), name, password_hash: hashPassword(password), created_at: now() });
    console.log(`[setup] created admin user ${email}`);
  }

  const router = new Router();
  require('./routes/public').register(router, app);
  require('./routes/portal').register(router, app);
  require('./routes/admin').register(router, app);
  require('./routes/webhooks').register(router, app);

  app.server = createServer(app, router, layout);
  const janitor = setInterval(() => app.sessions.purgeExpired(), 3600e3);
  janitor.unref();
  app.close = () => new Promise((resolve) => {
    clearInterval(janitor);
    app.server.close(() => { app.db.close(); resolve(); });
    app.server.closeAllConnections();
  });
  return app;
}

module.exports = { createApp };
