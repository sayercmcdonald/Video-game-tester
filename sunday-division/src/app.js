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
  app.events = require('./orchestrator/events').createEvents(app);
  app.rateLimit = createRateLimiter();
  app.audit = require('./services/audit').createAudit(app);
  app.settings = require('./orchestrator/settings').createSettings(app);
  app.humanTasks = require('./orchestrator/humanTasks').createHumanTasks(app);
  app.sandbox = require('./sandbox').createSandbox();
  app.files = require('./services/files').createFiles(app);
  app.notify = require('./services/notify').createNotify(app);
  app.projects = require('./services/projects').createProjects(app);
  app.contractors = require('./services/contractors').createContractors(app);
  app.assignments = require('./services/assignments').createAssignments(app);
  app.messaging = require('./services/messaging').createMessaging(app);
  app.quotes = require('./services/quotes').createQuotes(app);
  app.billing = require('./services/billing').createBilling(app);
  app.intake = require('./services/intake').createIntake(app);
  app.automation = require('./services/automation').createAutomation(app);
  app.providers = require('./ai/providers').createProviders(app);
  app.ai = require('./ai/gateway').createAiGateway(app);
  app.agentModel = require('./agents/model').createAgentModel(app);
  app.agentRuntime = require('./agents/runtime').createRuntime(app);
  app.integrations = require('./integrations').createIntegrations(app);
  app.orchestrator = require('./orchestrator').createOrchestrator(app);
  app.budget = require('./orchestrator/budget').createBudget({ db: app.db, settings: app.settings, clock: app.orchestrator.clock, config });
  app.command = require('./command').createCommand(app);

  // First-run convenience for container deploys: create the first admin from the environment.
  const { email, password, name } = config.bootstrapAdmin;
  if (email && password && !app.db.get('SELECT 1 FROM users LIMIT 1')) {
    if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    app.db.insert('users', { email: email.toLowerCase(), name, password_hash: hashPassword(password), created_at: now() });
    console.log(`[setup] created admin user ${email}`);
  }
  app.command.syncFounders();

  const router = new Router();
  require('./routes/public').register(router, app);
  require('./routes/portal').register(router, app);
  require('./routes/admin').register(router, app);
  require('./routes/ops').register(router, app);
  require('./routes/contractor').register(router, app);
  require('./routes/webhooks').register(router, app);
  require('./routes/command').register(router, app);

  app.server = createServer(app, router, layout);
  const janitor = setInterval(() => app.sessions.purgeExpired(), 3600e3);
  janitor.unref();
  app.close = async () => {
    clearInterval(janitor);
    await app.orchestrator.stop();
    await new Promise((resolve) => {
      app.server.close(() => { app.db.close(); resolve(); });
      app.server.closeAllConnections();
    });
  };
  return app;
}

module.exports = { createApp };
