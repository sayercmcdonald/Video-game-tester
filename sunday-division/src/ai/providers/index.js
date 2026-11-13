'use strict';
const { createAnthropicAdapter } = require('./anthropic');
const { createOpenAIAdapter } = require('./openai');

/**
 * Provider-independent access to language models. Agents, the Morning Brief and Command
 * Chat ask for "the model for this purpose" and talk to it through one adapter interface
 * (turn / callsOf / toolResults / expand). Which provider that is comes from the founder's
 * setting (Command → Settings), falling back to AI_PROVIDER.
 */
function createProviders(app) {
  const adapters = { anthropic: createAnthropicAdapter(app), openai: createOpenAIAdapter(app) };
  const ORDER = ['anthropic', 'openai'];

  function choice() {
    let c = app.config.ai.provider;
    try { c = app.settings.get('ai_provider'); } catch { /* settings not ready */ }
    return c === 'default' ? app.config.ai.provider : c;
  }

  const providers = {
    adapters,
    get: (id) => adapters[id] || null,
    /** The adapter to use now, or null for rules. A test double always wins. */
    selected() {
      const overridden = ORDER.find((id) => adapters[id].overridden);
      if (overridden) return adapters[overridden];
      const c = choice();
      if (c === 'rules') return null;
      if (c === 'auto') {
        const first = ORDER.find((id) => adapters[id].configured());
        return first ? adapters[first] : null;
      }
      return adapters[c] && adapters[c].configured() ? adapters[c] : null;
    },
    /** Per-agent mode (Settings → Agent permissions): 'rules' never uses a model. */
    forAgent(agentId) {
      if (app.settings.agentMode && app.settings.agentMode(agentId) === 'rules') return null;
      return providers.selected();
    },
    list: () => ORDER.map((id) => ({ id, label: adapters[id].label, model: adapters[id].model(), configured: adapters[id].configured(), missing: adapters[id].missing(), simulated: adapters[id].simulated })),
    describe() {
      const a = providers.selected();
      if (!a) return 'Rules only — no model provider selected or configured';
      return a.simulated ? `Simulated model (${a.label} format, tests only)` : `${a.label} (${a.model()})`;
    },
    /** Provider label for a stored agent_runs.provider value. */
    labelFor: (recorded) => ({ claude: 'Anthropic Claude', openai: 'OpenAI', simulated: 'Simulated (test)', rules: 'Rules', integration: 'Integration', system: 'System' })[recorded] || recorded,
  };
  return providers;
}

module.exports = { createProviders };
