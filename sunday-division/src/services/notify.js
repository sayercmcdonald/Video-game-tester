'use strict';

/**
 * Optional heads-up for staff when a new inquiry lands (Slack-compatible webhook).
 * Deliberately carries no client contact details — only a reference and a link.
 */
function createNotify({ config }) {
  return {
    newInquiry(inquiry) {
      if (!config.notifyWebhookUrl) return;
      const text = `New ${inquiry.kind === 'contact' ? 'message' : 'project inquiry'} ${inquiry.ref}` +
        (inquiry.garment_category ? ` · ${inquiry.garment_category}` : '') +
        ` — ${config.baseUrl}/admin/leads/${inquiry.id}`;
      fetch(config.notifyWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      }).catch((err) => console.error('[notify] webhook failed:', err.message));
    },
  };
}

module.exports = { createNotify };
