'use strict';

/**
 * Compatibility facade over src/ai/providers for code and tests written against the
 * single-provider agent model. use(fn) installs an Anthropic-format test double; every run
 * it makes is recorded with provider "simulated" so it is never mistaken for real output.
 */
function createAgentModel(app) {
  return {
    enabled: () => Boolean(app.providers.selected()),
    provider: () => { const a = app.providers.selected(); return a ? a.recordAs() : 'rules'; },
    describe: () => app.providers.describe(),
    use(fn, { simulated = true } = {}) { app.providers.adapters.anthropic.useTransport(fn, { simulated }); },
  };
}

module.exports = { createAgentModel };
