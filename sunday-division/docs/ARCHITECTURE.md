# Architecture

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22, CommonJS, no framework | Small surface; nothing to keep patched beyond Node |
| Storage | SQLite via built-in `node:sqlite` (WAL) | Zero-ops, transactional, one file to back up; ample for a studio |
| Rendering | Server-rendered HTML from template literals that escape by default | No build step, fast pages, XSS-safe by construction |
| Front end | One stylesheet per surface, ~100 lines of vanilla JS | Works without JavaScript; strict CSP |
| Payments | Stripe Checkout over the REST API with `fetch` | Hosted page keeps card data off our systems; no SDK needed |
| AI | `@anthropic-ai/sdk` (the only dependency), with a rules-based fallback | Drafting works with or without a key |

## Layout

```
server.js                 entry point
src/config.js             environment → validated config (refuses unsafe production settings)
src/db.js                 schema migrations + thin query helpers
src/app.js                composition root: builds `app` (config, db, services, router, server)
src/http/                 router, request pipeline, body + multipart parsing, sessions, rate limits
src/lib/                  escaping/templating, money, crypto helpers
src/services/             business rules — intake, projects, quotes, billing, files, automation, audit
src/orchestrator/         durable jobs, events, workflow state machine, budgets, settings, human queue, metrics
src/agents/               agent contracts, scoped tools with effect ledger, handlers
src/sandbox/              isolated inspection of untrusted files
src/payments/             stripe + simulated providers behind one interface
src/ai/                   prompts + schemas, Claude call, deterministic rules
src/integrations/         INDEX V3 / FORM adapter (manual or API mode)
src/routes/               public, portal, admin, webhooks — thin; they call services
src/views/                HTML for each surface + SVG technical flats
public/                   CSS, JS, self-hosted fonts
tests/                    end-to-end workflow, integration contract, unit tests
```

Routes never contain business rules. Every rule that protects money, client data or an approval gate lives in a service, so it holds no matter which route (or future API) calls it.

## State machines

```
inquiry      new → reviewing → quoted → won | lost | archived
project      scoping → awaiting_deposit → active → delivered → closed      (scoping/awaiting_deposit → cancelled)
quote        draft → sent → accepted | declined | superseded
invoice      draft → open → paid | void
deliverable  in_progress → in_review → approved → released    (new file version → back to in_review)
task         proposed → todo → doing → review → done
```

Key transitions and where they are enforced:

- `quote draft → sent` — `quotes.approveAndSend(quoteId, user)`; requires a signed-in user.
- `quote sent → accepted` — `quotes.respond`; client-owned, opens the deposit invoice in the same transaction.
- `project awaiting_deposit → active` — **only** inside `billing.settle`, reached from a verified webhook or a recorded manual payment.
- Starting tasks, creating deliverables and production requests call `projects.requireWorkUnlocked`.
- `deliverable approved → released` — `projects.releaseDeliverable`; final-stage files are refused while a balance is due unless staff explicitly override (logged).

## Payments

1. Client clicks **Pay** in the portal → `billing.startCheckout` creates (or reuses) a Checkout Session for the exact invoice amount and redirects to Stripe.
2. Stripe calls `POST /webhooks/stripe`. The raw body's signature and timestamp are verified, the event id is de-duplicated, and the paid amount and currency are compared with the invoice before it is settled — all in one transaction, so a failure is retried by Stripe.
3. Mismatched or duplicate payments are recorded and surfaced on the Approvals page instead of being silently accepted.

The success redirect is cosmetic; the webhook is the source of truth.

## Automation

`services/automation.js` is the only module that calls a model. It can write: triage notes on a lead, a `draft` brief, a `draft` quote, `proposed` tasks, a `draft` status update, and internal file labels. It holds no reference to any function that sends, publishes, charges or releases. Model output is constrained to a JSON schema, client-supplied text is passed as delimited data, and any model failure falls back to deterministic rules.

## Data

Money is integer cents. Timestamps are ISO-8601 UTC. See `src/db.js` for the schema: `users`, `sessions`, `inquiries`, `clients`, `projects`, `quotes`, `tasks`, `contractors`, `costs`, `files`, `deliverables`, `revisions`, `invoices`, `checkout_sessions`, `payments`, `webhook_events`, `status_updates`, `integration_jobs`, `audit_log`.

Profitability per project = accepted quote value − logged costs (projected), and collected − costs (cash position). Costs are logged as contractor hours × rate or flat amounts.

## Orchestration

Agents run on a durable SQLite job queue and a deterministic workflow state machine, layered on top of the services above without bypassing any of their gates. See [ORCHESTRATION.md](ORCHESTRATION.md).

## Growing past the first project

- More than one app instance, or heavy traffic: move to Postgres and object storage; the service layer is the only code that touches `db` and the uploads directory.
- Transactional email: add a `notify` provider and call it from the existing approval points (quote sent, invoice issued, file released).
- Roles: add a `role` column to `users` and check it in the admin router options.
