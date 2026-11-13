# Business agents

Sunday Division runs six AI business agents and a deterministic Operations Orchestrator inside the deployed application. They work whenever the server is running — Claude Code is not involved at runtime.

## Architecture decision

| Option | What it is | Verdict |
|---|---|---|
| **Claude Agent SDK** | Claude Code packaged as a library: built-in shell, file and web tools, its own agent loop. | **Not used.** Built for coding and filesystem agents. Its default tools are exactly the access these agents must not have, and it adds a large runtime to a small app. |
| **Claude Managed Agents** | Anthropic runs the agent loop and a sandbox container per session; you define agents and stream session events. | **Not used for now.** Every tool here must read and write the studio database under per-project authorisation, so each call would come back to the app as a custom tool over an event stream — a second stateful system to keep consistent with our queue. It is in beta. Worth revisiting if agents need long-running sandboxed work (for example file conversion). |
| **Messages API tool-use loop, run by the app** | The app sends Claude the agent's prompt and its allowed tools, executes the tool calls Claude requests, and loops. | **Chosen.** ~250 lines in `src/agents/runtime.js`, no new infrastructure, and every tool call goes through the app's own authorisation. |

The loop is hand-written rather than the SDK's beta tool runner because each turn must be saved to SQLite before the next step — a restarted server resumes a task mid-conversation in a new process — and every tool call must pass through the app's permission check and effect ledger. Budget checks happen before every model call.

## How a task runs

```
application event ──► Operations Orchestrator (deterministic state machine)
                         │ ensures a durable job: agent + action + input, keyed for idempotency
                         ▼
                     job queue (SQLite: retries, backoff, leases, dependencies)
                         ▼
                     runner ── validates input ── binds tools to the job's project
                         ▼
          ┌──────────── brain ────────────┐
          │ model: Claude tool-use loop   │ rules: deterministic policy
          │  system prompt + allowed tools│  same tools, same output
          │  each turn saved to SQLite    │  (no key, no budget, or
          │  tool calls → permission check│   deterministic-only steps)
          │  → effect ledger → tool       │
          │  ends with submit_result      │
          └───────────────────────────────┘
                         ▼
                     output validated against schema → orchestrator advances
```

* **Persistent task state**: `agent_sessions` holds the full transcript (append-only), turns, tool calls, refused calls, tokens and cost. A job that is retried, or interrupted by a restart, continues from its last saved turn and never re-calls the model for turns it already has.
* **No repeated effects**: every state-changing tool call is written to `agent_tool_calls` keyed by the job and the model's `tool_use` id, in the same transaction as the effect. Resuming replays the recorded result.
* **Execution history**: transcript + per-turn model runs (`agent_runs`: provider, model served, prompt version, tokens, cache reads/writes, cost, latency) + state changes + job attempts. Shown on **Operations → Agent tasks → (task)**.
* **Retries and failures**: overloaded/rate-limited/5xx model errors and transient infrastructure errors retry with exponential backoff (per-action limits). Refusals, permission violations (three refused tool calls), budget exhaustion, turn limits and invalid results fail the job at once, block the workflow and open an escalation for staff, who can retry or handle the step by hand.
* **Brains never switch mid-task.** A task that starts on Claude finishes on Claude or fails; a task that starts on rules stays on rules.

### Model settings

`claude-opus-5-5` (override with `AI_MODEL`), adaptive thinking, effort `medium` (`AI_AGENT_EFFORT`), strict tool schemas, automatic prompt caching of the stable prefix, server-side refusal fallback (`fallbacks: "default"`). Forced `tool_choice` is not available on this model, so each prompt states which tools to call and the loop nudges an agent that stops without `submit_result` (twice, then fails).

## The agents

Full system prompts, per-action instructions, tool lists and input/output schemas are in `src/agents/definitions.js` and on **Operations → Agents**.

| Agent | Actions (first release) | Writes | Escalates when |
|---|---|---|---|
| **Sales** | `qualify`, `draft_proposal` | triage notes; draft brief; draft quote | lead not qualified; quote below package floor; out-of-scope requests |
| **Talent** | `recommend` | assignment *recommendation* (staff approve) | no approved, available contractor; three declines/rejections |
| **Production** | `prepare`, `poll` | technical briefs, QA checklists, task routes; INDEX V3 / FORM submissions only when autonomy is on | missing technical information; external job fails |
| **Project Manager** | `plan`, `check_deadlines`, `completion_summary` | milestones, internal tasks, production tasks (limited to what the client bought) | client-facing date to confirm; overdue tasks |
| **QA** | `check` | QA report per deliverable version (reads PDFs and images) | every result goes to a qualified technical reviewer; fail on integrity, scripts, embedded instructions |
| **Client Success** | `quote_notice`, `kickoff_update` | draft client messages and portal updates | every message is a staff-approved draft |
| **Operations Orchestrator** | `verify_deposit_invoice`, `prepare_final_invoice`, `record_performance` + the workflow itself | — (deterministic code, no model) | deposit mismatch; payment exceptions; failed jobs |

### Tools

| Effect | Tools |
|---|---|
| read (bound project only; no contact details) | `get_inquiry`, `get_project`, `get_catalog`, `list_quotes`, `list_tasks`, `get_task`, `search_contractors`, `list_deliverables`, `inspect_deliverable`, `get_finance_summary` |
| internal | `save_triage`, `create_tasks`, `create_production_tasks`, `save_technical_brief`, `set_task_route`, `record_qa_report`, `request_human_review` |
| draft (needs a person) | `save_brief_draft`, `save_quote_draft`, `recommend_contractor`, `prepare_client_message`, `save_status_update_draft`, `draft_final_invoice` |
| external (budgeted, policy-gated) | `submit_to_integration`, `refresh_integration_job` |

There is no tool that sends a message, approves or rejects anything, offers work, changes payment or invoice status, releases files, sets a client-facing date, changes settings, budgets or permissions, purchases anything or runs commands. A test enforces this.

## Human gates in the first workflow

| Step | Who decides |
|---|---|
| Quote sent to the client | staff (`Approve & send`) |
| Any message to a client or contractor | staff (`Messages`, or as part of an assignment approval) |
| Deposit / final payment | client on the payment provider's page, verified by signed webhook |
| Contractor offered work (fee, due date, offer message) | staff (`Approve & send offer`) |
| Contractor accepts, declines, submits | the contractor, in the contractor portal |
| Technical sign-off | staff flagged as technical reviewers |
| Final invoice issued, files released | staff |

Agents and the orchestrator never stand in for a client or contractor: an offer stays "offered" until the contractor acts in the portal, and tests check that sweeps and retries never change that.

## Simulated versus live

| Service | Tests and development | Production |
|---|---|---|
| Model | rules brain when no key; **simulated model** (`tests/support/simulated-model.js`) in tests only — recorded as provider `simulated` and labelled in the dashboard | Claude via `ANTHROPIC_API_KEY` |
| Messages | `MESSAGING_PROVIDER=simulated`: marked sent with a `SIMULATED-` reference, nothing leaves the server; labelled in the outbox | `manual` (default): staff send approved messages themselves and mark them sent. `simulated` is refused in production. |
| Payments | simulated checkout (existing) | Stripe Checkout; simulated refused in production |
| INDEX V3 / FORM | mock HTTP servers in tests | real endpoints when configured; autonomy off by default |

## Contractors

* Staff add contractors with skills (job types), garment categories, rate and capacity. **Only approved contractors** can be recommended, offered work or sign in.
* The Talent Agent sees roster profiles without contact details; the fee is computed by the app from the approved rate × the agent's hour estimate, and staff can change it when approving.
* The contractor portal (`/contractor`) shows a contractor their own offered and accepted assignments: the technical brief, QA checklist, fee, due date and the project's reference files — never client contact details, client pricing, other projects or other contractors. Suspending a contractor ends their access immediately.
* Signing off a contractor's work records the fee as a project cost ("pay outside the system"). The app does not pay contractors.

## Next agent capabilities (not in this release)

Designed for, in this order, each behind the same gates: Sales follow-ups on unanswered quotes (draft messages); Client Success answers to routine portal questions and revision intake (drafts); Talent screening of contractor applications from a public form (recommendation only — staff approve); Project Manager handling of revision requests (tasks and re-assignment).
