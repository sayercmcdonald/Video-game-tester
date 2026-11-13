# Agent orchestration

> Updated for v3: the agents are now Claude tool-calling agents with a rules fallback — see [AGENTS.md](AGENTS.md) for the agents themselves, their prompts and tools. This document covers the orchestration layer underneath them.

How Sunday Division runs routine operations with agents while every money movement, approval and client commitment stays under deterministic code and human control.

## Plan in one page

**Reused unchanged** — quotes, billing, Stripe webhooks, deposit unlock, deliverable approval and release, portal, files, audit log. Every existing gate still lives in these services, and the orchestration layer can only reach them through the same functions staff use.

**Reused with small changes**

| Module | Change |
|---|---|
| `services/*` | Emit an event (in the same transaction) at each state change: inquiry received, quote sent/accepted/declined, invoice issued/paid, payment exception, deliverable uploaded/approved/released, revisions, status updates, project status. |
| `services/automation.js` | Split into `generate*` (content only) and the existing staff "draft with automation" helpers, so agents and buttons share one drafting engine. |
| `ai/claude.js` | Returns token usage and the served model so cost can be recorded. |
| `integrations/index.js` | Explicit `mode` (`auto` / `manual` / `api`), caller-supplied idempotency key, service version captured from `X-Service-Version`. |
| `services/billing.js` | `depositVerified()` and `finalPaymentVerified()` — the deterministic checks the workflow uses. |

**New**

| Module | Purpose |
|---|---|
| `orchestrator/queue.js` | Durable job queue on SQLite: idempotency keys, dependencies, leases, retries with backoff. |
| `orchestrator/events.js` | Transactional outbox; every event has a dedupe key. |
| `orchestrator/workflow.js` | The project lifecycle state machine. |
| `orchestrator/runner.js` | Executes one job: schema-checks input and output, binds tools, applies the timeout, classifies errors. |
| `orchestrator/index.js` | In-process worker loop, boot-time crash recovery, periodic sweep, `drain()` for tests. |
| `orchestrator/budget.js`, `settings.js` | AI and external-service budgets; admin-only operating controls. |
| `orchestrator/humanTasks.js` | The human intervention queue. |
| `orchestrator/metrics.js` | Queries behind the Operations dashboard. |
| `agents/definitions.js` | The agent contracts (frozen). |
| `agents/tools.js` | Every capability an agent can have, bound to the job's subject, with an effect ledger. |
| `agents/handlers/` | What each agent does. |
| `ai/gateway.js` | Single path for model calls: budget check, schema validation, cost and version recording, rules fallback. |
| `sandbox/` | Inspects untrusted files in a permission-restricted child process. |
| `routes/ops.js`, `views/ops.js` | The Operations section of the dashboard. |

No new infrastructure: still one Node process and one SQLite file.

## How it fits together

```
 service change ──(same transaction)──► events ──► worker ──► workflow.advance()
                                                              │  reads the database,
                                                              │  decides the next state,
                                                              ▼  ensures jobs exist (by key)
                                                            jobs ──► runner ──► agent handler
                                                                                  │
                                                     tools (policy-checked, scoped, ledgered)
                                                                                  │
                                       drafts · internal records · human tasks · budgeted external calls
```

* **advance() is the only thing that moves a workflow**, and it is deterministic. It reads the system of record (quotes, invoices, payments, deliverables), never an agent's claim. Duplicate or out-of-order events cannot double-act: they just cause another evaluation. A five-minute sweep re-evaluates everything as a safety net.
* **Jobs are idempotent by key** (`wf12:project_manager.plan`). Ensuring a job that exists returns it.
* **Effects are idempotent by ledger.** Every state-changing tool call is recorded with the job id and an effect key, in the same transaction as the effect. If a job is retried after doing some of its work, those calls are replayed from the ledger instead of repeated. External submissions carry a stable `Idempotency-Key`.
* **Crash recovery.** Running jobs hold a lease. At boot every running job is re-queued (single instance); during operation, expired leases are. Unprocessed events wait in the table.

## Workflow states

| State | Exits when | Agents | Human gate |
|---|---|---|---|
| Triage | qualify job done | Sales: qualify | — |
| Needs review | staff choose "Pursue" or mark the lead lost | — | yes |
| Scoping | draft quote saved (project created deterministically) | Sales: draft brief + quote | — |
| Quote approval | a quote has status `sent` | — | **staff approve & send** |
| Client decision | quote accepted (or declined → Quote declined) | Client Success: quote message (draft) | **staff approve message**; client |
| Deposit | `billing.depositVerified()` | Orchestrator: deposit invoice check | client pays; webhook verifies |
| Project setup | plan, briefs/routing and kickoff draft done | Project Manager, Production, Client Success | — |
| Production | every production task signed off, nothing open | Talent per contractor task; QA per uploaded version; Production polls; PM deadlines | **staff approve assignments**; contractor accepts/submits; **technical reviewer signs off** |
| Final payment | `billing.finalPaymentVerified()` | Orchestrator: drafts final invoice | **staff issue invoice**; client pays |
| Ready for release | all final files released | — | **staff release** |
| Completing | summary + performance recorded | Project Manager, Orchestrator | — |
| Completed / Cancelled / Lost | — | — | — |

A failed job (after its retries) marks the workflow **blocked** and opens an escalation task. Staff can retry it, or cancel it to say "handled by hand", which lets the workflow continue.

## Agents

Six business agents (Sales, Talent, Production, Project Manager, QA, Client Success) and the deterministic Operations Orchestrator. Their prompts, tools, schemas and escalation rules are documented in [AGENTS.md](AGENTS.md) and shown on **Operations → Agents**.

## Safety controls, mapped to the brief

| Requirement | Control |
|---|---|
| LLM never overrides payment, authorization or approvals | Model output is JSON data validated against a schema (extra fields rejected), handed back to code. No tool exists for those actions. Workflow gates read payments and approvals from the database. |
| Don't mark unpaid invoices paid | Only `billing.settle()` marks paid, reached from a signature-verified webhook or a named staff member. `depositVerified()` also requires a matching successful payment row. |
| Don't release unapproved technical files | Release stays a staff action; QA agents can only record reports; generated files enter "in review". |
| No unapproved delivery dates | PM proposes a date as a staff task; nothing writes `projects.due_date` except the staff form. Kickoff drafts are told not to state dates and are published by staff. |
| No unrelated client data | Tools take no client/project ids; ids they accept are checked against the job's subject; job input must match the bound subject. Contact details are stripped before any model call. |
| No arbitrary shell from customer input | No `exec`/`spawn`/`eval` in `src`; only the sandbox forks a fixed script with an argument vector. Enforced by test. |
| Agents can't change their own permissions | Policies are deep-frozen; settings are writable only by admin routes; every change is audited. |
| Least privilege, isolated execution for untrusted files | QA inspection runs in a child Node process with `--permission` (read only that file), empty environment, memory cap and timeout; it parses bytes and executes nothing. |
| Budget limits | Monthly and per-project AI caps (checked before each call against a worst-case estimate; over budget → rules drafting, no call made). Per-project external cap (over budget → human queue + escalation). |
| No unauthorized purchases | No purchasing tool. External jobs are the only spend and are capped. |
| No invented completion or deliverables | Completion requires released files; summaries are built from recorded facts only; QA reports cannot change deliverable status. |

## Operations dashboard

`/admin/ops` — active, paused and blocked workflows, the human queue, failed jobs (retry / handle by hand), agent jobs, AI and external spend against budget, automation rate, turnaround times and per-project profitability including automation costs. Each workflow has an inspect page with its state history, jobs (input, output, attempts, errors, dependencies), model runs (model, prompt version, tokens, cost), tool calls (executed, replayed, denied) and events. **Agents** shows each contract and its performance; **Controls & budgets** holds the pause switch, autonomy switch and budgets.

### Metric definitions

* **Automation rate** = agent steps completed ÷ (agent steps + routine human steps). Routine human steps are human tasks of kind production, escalation or communication. Approvals and reviews are excluded: they are required by policy, not gaps in automation. This is the number to move toward 80–90% as integrations are verified.
* **Turnaround** = average time from inquiry (workflow creation) to reaching a state, or between two states, from the transition log.
* **Costs** = model spend (tokens × published price, recorded per call) + external jobs (service-reported or the configured estimate) + manually logged costs.

## What is deliberately off

| Capability | State | To enable |
|---|---|---|
| Autonomous production (INDEX V3 / FORM) | Off. All production goes to the human queue. | Connect the service, run it against real projects in manual mode and compare outputs, then switch on in Controls (refused unless a service is connected). |
| Live client communication | Not available: no email provider. | Add a delivery provider, then have Client Success draft messages into an outbox that staff approve before sending. Not built. |
| Automatic release of files | Not built by design. | Release remains a staff decision. |

## Running it

* The worker runs inside the web process (`ORCHESTRATOR_POLL_MS`, default 2 s; `0` disables it). **Run pending work now** on the Operations page drains the queue on demand.
* Restarting is safe at any time. Deploy as a single instance with `DATA_DIR` on a persistent volume, as before.
* Inquiries received before this release do not get a workflow; handle them as before.

## Tests

`npm test` — 110 tests (Command and provider tests are described in [COMMAND.md](COMMAND.md#11-tests)). The orchestration-specific ones:

* `tests/orchestration.test.js` — the full lifecycle through real routes: inquiry → triage → draft quote → staff approval → client acceptance → verified deposit → setup → production routing → QA → final invoice → final payment → release → completion; plus duplicate events, webhook replays, sweeps.
* `tests/agent-safety.test.js` — policy shape and immutability; no shell execution; denied and cross-client tool calls; forged job input; malicious and prompt-injected model output; cost and version recording; AI and external budgets; retries with backoff, retry limits, permanent failures, staff retry; crash recovery with effect replay; forged payment events and underpayment; global and per-workflow pause; autonomous production against a mock INDEX V3 (idempotent submission, polling, review-gated import).

## Next milestones

1. Connect INDEX V3 in manual comparison mode; verify outputs on real projects; then enable autonomous production for one job type at a time.
2. Transactional email with a staff-approved outbox, to remove the "send the client their portal link" hand-offs.
3. Integration webhooks instead of polling (`docs/INTEGRATIONS.md`).
4. Per-job-type autonomy switches and per-agent model selection, once there is enough run data to justify them.
