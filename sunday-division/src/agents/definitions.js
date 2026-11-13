'use strict';
const { S } = require('../lib/schema');
const catalog = require('../services/catalog');

/**
 * Agent contracts. Each action declares the tools it may call (its whole permission set),
 * its input and output schemas, retry policy and timeout. The registry is deep-frozen at
 * load time and no tool can modify it: agents cannot change their own permissions.
 */
const PACKAGE_IDS = catalog.PACKAGES.map((p) => p.id);
const SERVICE_IDS = catalog.SERVICES.map((s) => s.id);
const projectInput = S.obj({ project_id: S.int(1) });
const RETRY_MODEL = { maxAttempts: 3, baseDelayMs: 30e3, maxDelayMs: 10 * 60e3 };
const RETRY_SYSTEM = { maxAttempts: 3, baseDelayMs: 10e3, maxDelayMs: 5 * 60e3 };
const RETRY_EXTERNAL = { maxAttempts: 5, baseDelayMs: 60e3, maxDelayMs: 30 * 60e3 };
const productionItem = S.obj({ product: S.nullable(S.enum(['index_v3', 'form'])), job_type: S.str(40), label: S.str(120) });

const AGENTS = [
  {
    id: 'sales_intake', name: 'Sales and Intake Agent', version: '1.0.0',
    purpose: 'Reads new inquiries, classifies the services requested, identifies missing information and drafts the brief and quote for staff approval.',
    escalation: [
      'Lead not qualified (spam, manufacturing-only request) → workflow pauses in "Needs review" with a human task.',
      'Draft quote below the package starting price, budget below package floor, or out-of-scope request → flagged on the approval task.',
      'Model unavailable, over budget or returning invalid output → deterministic rules draft instead; never blocks.',
      'A quote or brief already exists (written by a person) → skips drafting rather than overwrite it.',
    ],
    actions: {
      triage: {
        description: 'Analyse requirements, classify services, list missing information.',
        tools: ['inquiry.read', 'model.triage', 'inquiry.saveTriage'],
        input: S.obj({ inquiry_id: S.int(1) }),
        output: S.obj({ qualified: S.bool(), qualification_note: S.str(1000), suggested_package: S.enum(PACKAGE_IDS), services: S.arr(S.enum(SERVICE_IDS), 4), priority: S.enum(['high', 'normal', 'low']), missing_count: S.int(), risk_flags: S.arr(S.str(400), 20), source: S.enum(['claude', 'rules']) }),
        retry: RETRY_MODEL, timeoutMs: 180e3,
      },
      draft_proposal: {
        description: 'Draft the project brief and a priced quote, then ask staff to approve it.',
        tools: ['project.read', 'inquiry.read', 'quotes.read', 'catalog.read', 'model.brief', 'model.quote', 'brief.draft', 'quote.draft', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ quote_id: S.nullable(S.int(1)), skipped: S.bool(), total_cents: S.int(), below_floor: S.bool(), flags: S.arr(S.str(400), 20) }),
        retry: RETRY_MODEL, timeoutMs: 300e3,
      },
    },
  },
  {
    id: 'project_manager', name: 'Project Management Agent', version: '1.0.0',
    purpose: 'After the deposit is verified, builds the working plan and production plan, tracks deadlines and writes the completion summary.',
    escalation: [
      'Never sets the client-visible delivery date: proposes one as a human task for staff to confirm.',
      'Overdue tasks → one escalation task each.',
      'Refuses to plan work before the deposit is verified (enforced by the task tool).',
    ],
    actions: {
      plan: {
        description: 'Create the internal task plan and the production plan.',
        tools: ['project.read', 'inquiry.read', 'tasks.read', 'model.plan', 'tasks.createPlan', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ tasks_created: S.int(), production_plan: S.arr(productionItem, 20), proposed_due_date: S.nullable(S.str(10)) }),
        retry: RETRY_MODEL, timeoutMs: 300e3,
      },
      check_deadlines: {
        description: 'Flag overdue tasks to a person.',
        tools: ['tasks.read', 'humanQueue.create'],
        input: S.obj({ project_id: S.int(1), date: S.str(10) }),
        output: S.obj({ overdue: S.int() }),
        retry: RETRY_SYSTEM, timeoutMs: 30e3,
      },
      completion_summary: {
        description: 'Summarise the delivered project from recorded facts.',
        tools: ['project.read', 'tasks.read', 'deliverables.read', 'finance.read'],
        input: projectInput,
        output: S.obj({ summary: S.str(4000), tasks_done: S.int(), deliverables_released: S.int(), revisions: S.int() }),
        retry: RETRY_SYSTEM, timeoutMs: 30e3,
      },
    },
  },
  {
    id: 'index_coordinator', name: 'INDEX Production Coordinator', version: '1.0.0',
    purpose: 'Routes garment-engineering work (flats, tech packs, measurement specs, 3D) to INDEX V3 when allowed, otherwise to the human production queue.',
    escalation: [
      'Autonomous production off, INDEX V3 not connected, or external budget reached → human production queue.',
      'External job failed or never finishes → escalation task; outputs that do arrive go to review, never straight to the client.',
    ],
    actions: {
      route: {
        description: 'Submit or queue each INDEX item in the production plan.',
        tools: ['workflow.readPlan', 'integrations.status', 'production.submit', 'production.queueHuman', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ submitted: S.int(), routed_to_human: S.int(), items: S.arr(S.obj({ job_type: S.str(40), route: S.enum(['api', 'human']), reason: S.str(200) }), 20) }),
        retry: RETRY_EXTERNAL, timeoutMs: 300e3,
      },
      poll: {
        description: 'Follow an INDEX V3 job until it finishes.',
        tools: ['production.refresh', 'humanQueue.create'],
        input: S.obj({ project_id: S.int(1), integration_job_id: S.int(1) }),
        output: S.obj({ status: S.str(20) }),
        retry: RETRY_EXTERNAL, timeoutMs: 300e3, maxReschedules: 288,
      },
    },
  },
  {
    id: 'form_coordinator', name: 'FORM Creative Coordinator', version: '1.0.0',
    purpose: 'Routes creative production (product imagery, campaign assets) to FORM when allowed, otherwise to the human production queue.',
    escalation: [
      'Autonomous production off, FORM not connected, or external budget reached → human production queue.',
      'External job failed or never finishes → escalation task.',
    ],
    actions: {
      route: {
        description: 'Submit or queue each FORM item in the production plan.',
        tools: ['workflow.readPlan', 'integrations.status', 'production.submit', 'production.queueHuman', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ submitted: S.int(), routed_to_human: S.int(), items: S.arr(S.obj({ job_type: S.str(40), route: S.enum(['api', 'human']), reason: S.str(200) }), 20) }),
        retry: RETRY_EXTERNAL, timeoutMs: 300e3,
      },
      poll: {
        description: 'Follow a FORM job until it finishes.',
        tools: ['production.refresh', 'humanQueue.create'],
        input: S.obj({ project_id: S.int(1), integration_job_id: S.int(1) }),
        output: S.obj({ status: S.str(20) }),
        retry: RETRY_EXTERNAL, timeoutMs: 300e3, maxReschedules: 288,
      },
    },
  },
  {
    id: 'technical_qa', name: 'Technical QA Agent', version: '1.0.0',
    purpose: 'Checks each new version of a technical deliverable (flats, tech pack, 3D) in an isolated process and reports to the reviewer. Cannot approve.',
    escalation: [
      'Every check result — pass, warn or fail — becomes a review task for a person; QA never approves or releases.',
      'INDEX V3 output without a passing validation result → fail.',
      'Integrity mismatch, encrypted PDF or embedded scripts → fail.',
    ],
    actions: {
      check: {
        description: 'Inspect a deliverable version and record a QA report.',
        tools: ['deliverables.read', 'files.inspect', 'qa.record', 'humanQueue.create'],
        input: S.obj({ project_id: S.int(1), deliverable_id: S.int(1), version: S.int(1) }),
        output: S.obj({ result: S.enum(['pass', 'warn', 'fail', 'superseded']), failed: S.int(), warnings: S.int() }),
        retry: RETRY_SYSTEM, timeoutMs: 60e3,
      },
    },
  },
  {
    id: 'creative_qa', name: 'Creative QA Agent', version: '1.0.0',
    purpose: 'Checks each new version of a creative deliverable (design, imagery, campaign) and reports to the reviewer. Cannot approve.',
    escalation: [
      'Every result becomes a review task for a person; QA never approves or releases.',
      'Images below delivery resolution → warning; unreadable or mismatched files → fail.',
    ],
    actions: {
      check: {
        description: 'Inspect a deliverable version and record a QA report.',
        tools: ['deliverables.read', 'files.inspect', 'qa.record', 'humanQueue.create'],
        input: S.obj({ project_id: S.int(1), deliverable_id: S.int(1), version: S.int(1) }),
        output: S.obj({ result: S.enum(['pass', 'warn', 'fail', 'superseded']), failed: S.int(), warnings: S.int() }),
        retry: RETRY_SYSTEM, timeoutMs: 60e3,
      },
    },
  },
  {
    id: 'finance_ops', name: 'Finance Operations Agent', version: '1.0.0',
    purpose: 'Deterministic finance checks: deposit invoice consistency, drafting the final invoice for the exact balance, recording project performance. No model is used.',
    escalation: [
      'Deposit invoice missing or not equal to the accepted quote\'s deposit → escalation task.',
      'Payment mismatches and duplicates reported by the payment webhook → escalation task.',
      'Final invoice is created as a draft only; staff approve it before it can be paid.',
    ],
    actions: {
      verify_deposit_invoice: {
        description: 'Check the deposit invoice matches the accepted quote.',
        tools: ['finance.read', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ invoice_id: S.nullable(S.int(1)), amount_ok: S.bool(), status: S.str(20) }),
        retry: RETRY_SYSTEM, timeoutMs: 30e3,
      },
      prepare_final_invoice: {
        description: 'Draft the final invoice for the uninvoiced balance and ask staff to approve it.',
        tools: ['finance.read', 'invoice.draftFinal', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ invoice_id: S.nullable(S.int(1)), amount_cents: S.int() }),
        retry: RETRY_SYSTEM, timeoutMs: 30e3,
      },
      record_performance: {
        description: 'Snapshot revenue, costs and margin for the completed project.',
        tools: ['finance.read'],
        input: projectInput,
        output: S.obj({ quoted_cents: S.int(), collected_cents: S.int(), costs_cents: S.int(), profit_cents: { type: 'integer' }, margin: S.nullable({ type: 'number' }) }),
        retry: RETRY_SYSTEM, timeoutMs: 30e3,
      },
    },
  },
  {
    id: 'client_success', name: 'Client Success Agent', version: '1.0.0',
    purpose: 'Keeps the client informed through the approved channels: drafts portal updates and prepares hand-offs for staff to send.',
    escalation: [
      'Live client communication is not enabled: every message is a draft or a task for staff to send.',
      'Never states dates or commitments that are not already approved in the project record.',
    ],
    actions: {
      quote_notice: {
        description: 'Ask staff to tell the client their quote is ready in the portal.',
        tools: ['project.read', 'quotes.read', 'client.portalStatus', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ task_id: S.nullable(S.int(1)), needs_portal_key: S.bool() }),
        retry: RETRY_SYSTEM, timeoutMs: 30e3,
      },
      kickoff_update: {
        description: 'Draft the kickoff status update for staff to publish.',
        tools: ['project.read', 'model.statusUpdate', 'statusUpdate.draft', 'humanQueue.create'],
        input: projectInput,
        output: S.obj({ update_id: S.int(1) }),
        retry: RETRY_MODEL, timeoutMs: 180e3,
      },
    },
  },
];

function deepFreeze(o) {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); });
  return Object.freeze(o);
}

for (const agent of AGENTS) for (const [id, action] of Object.entries(agent.actions)) action.id = id;
const REGISTRY = deepFreeze(Object.fromEntries(AGENTS.map((a) => [a.id, a])));

function getAction(agentId, actionId) {
  const agent = REGISTRY[agentId];
  const action = agent && Object.prototype.hasOwnProperty.call(agent.actions, actionId) ? agent.actions[actionId] : null;
  if (!action) throw new Error(`Unknown agent action ${agentId}.${actionId}`);
  return { agent, action };
}

module.exports = { REGISTRY, getAction };
