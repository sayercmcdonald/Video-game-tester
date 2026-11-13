'use strict';
const { createStripeProvider } = require('./stripe');
const { createSimulatedProvider } = require('./simulated');

function createPaymentProvider(config) {
  if (config.payments.provider === 'stripe') return createStripeProvider(config);
  if (config.payments.provider === 'simulated') return createSimulatedProvider(config);
  return null; // payments not configured: invoices can still be issued and settled manually
}

module.exports = { createPaymentProvider };
