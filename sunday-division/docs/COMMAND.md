# Sunday Division Command

The founder's private, mobile-first app for running Sunday Division. It lives at `/command` in the same Node process and SQLite database as everything else, and is installable on an iPhone as a Progressive Web App. Staff keep using `/admin`, clients `/portal`, contractors `/contractor`.

[Screens](#3-screens) · [Security](#4-security) · [AI workflow](#6-the-ai-workflow-morning-brief) · [Chat](#7-command-chat) · [Providers](#8-model-providers) · [Deployment](#12-deployment-requirements)

## 1. Audit: what Command reuses

| Existing module | Reused for | Change made |
|---|---|---|
| `services/*` (quotes, billing, assignments, messaging, projects) | Every action Command takes calls these same functions as the founder | none |
| `billing.depositVerified`, signed webhooks | "New paid project" notifications, revenue figures | none |
| `orchestrator/*` (queue, events, workflow, human tasks) | Morning Brief job, notifications from events and new human tasks, agent pausing | `queue.claim` skips agents the founder paused; hooks for Command |
| `agents/*` (definitions, tools, runtime, policies) | The Command Agent (brief) runs on the same runtime, tools and ledger | runtime now talks to models through `ai/providers` |
| `orchestrator/budget.js`, `settings.js` | Budgets, agent permissions, provider choice | OpenAI prices from config; new settings types |
| `http/*` (sessions, CSRF, rate limits) | Founder sessions and API | `founder` session kind, JSON bodies on declared routes |
| `orchestrator/metrics.js` | Turnaround, automation rate, agent stats | none |
| `audit_log` | Every Command action, sign-in and step-up failure | none |

## 2. Architecture

```
 iPhone (PWA, /command)                        Server (one Node process, one SQLite file)
 ─────────────────────                         ───────────────────────────────────────────
 server-rendered pages + small JS ── HTTPS ──► routes/command.js  (auth: 'founder' on every route)
 service worker: static assets only              │
   push (no payload) → fetch latest ─────────────┤ command/metrics   read-only numbers from the records
                                                 │ command/facts     verified facts, each with an id + source
                                                 │ command/actions   propose → preview → confirm → service call
                                                 │ command/brief     Morning Brief (durable job, Command Agent)
                                                 │ command/chat      Command Chat (read-only tools + propose_action)
                                                 │ command/notifications + webpush (VAPID)
                                                 ▼
                         existing services ◄─ orchestrator ◄─ agents ◄─ ai/providers (Anthropic | OpenAI)
```

* **Pages are server-rendered** and work without JavaScript; JS adds the live chat, push registration and double-tap protection. Cross-document **view transitions** give native-feeling navigation (off with reduced motion). No front-end framework, no new dependencies.
* **Nothing financial is stored on the phone.** Pages and API responses are `no-store`; the service worker caches only CSS, JS, fonts, icons and an offline page.

## 3. Screens

| Screen | What it shows | Data source |
|---|---|---|
| Overview | Health (6 checks), revenue / profit / booked this month, active projects, urgent issues, approvals | payments, costs, model runs, workflows, human tasks |
| Morning Brief | AI summary of verified events since the last brief, recommended actions, every line cited | `briefs` (facts stored with the brief) |
| Projects | Every project, stage, production progress, attention flags; detail with stages, tasks, assignments, deliverables + QA, invoices, money, timeline | projects, workflows, tasks, assignments, deliverables, invoices |
| Approvals | Draft quotes, contractor recommendations, draft invoices, payment exceptions, deliverables to sign off / release, draft messages | the records themselves (not a cached list) |
| Agent Studio | Each agent's state, mode, counts, cost this month; failures with retry; recent tasks; full execution log per task | jobs, agent_sessions, agent_runs |
| Command Chat | Questions answered from the records; proposals become action cards | read-only tools |
| Performance | Revenue / expenses / profit / margin by period; 12-week chart; monthly table; turnaround; QA first-pass, revisions, on-time, offer response, automation rate (with sample sizes) | payments, costs, model runs, transitions, QA, events |
| Settings | Push on this device, what to push, brief time and time zone; agent permissions; model provider; budgets; sign out (all devices) | settings |

Figures are cash basis: verified payments received minus recorded costs (contractor fees signed off, other costs, AI and external services). Simulated payments (development) are labelled wherever they are counted. Metrics without enough data say so instead of showing zero.

## 4. Security

| Control | How |
|---|---|
| Founder-only, on the server | Every `/command` route except sign-in, manifest, service worker and offline page declares `auth: 'founder'`. The HTTP layer checks, per request, a valid **founder session** *and* `users.founder = 1`. Revoking the flag cuts access immediately. Hidden navigation is not a control: a test enumerates every route and calls it without a session, with a non-founder staff session and with the founder's `/admin` session. |
| Who is a founder | Set on the server only: `FOUNDER_EMAIL` (authoritative at every start) or `npm run founder -- grant/revoke/list`. No web route can change it. |
| Sessions | Separate `founder` session kind, cookie `sd_command`, `Path=/command`, HttpOnly, SameSite=Lax, Secure on HTTPS, 30 days on the founder's own phone. Only a hash of the token is stored. "Sign out all devices" ends every founder session and push subscription. |
| Step-up for high impact | Confirming anything that commits money, sends a message, changes permissions or signs off / releases files needs the password again if the last password entry was over 12 hours ago (rate-limited, failures audited). |
| CSRF / origin | Form posts carry the session's CSRF token; the JSON API requires `X-CSRF-Token`; cross-site posts are refused; JSON bodies are accepted only on routes that declare them. |
| Actions bound to their preview | Previews are built by code from the records. Confirming sends the preview's digest; the records are re-read and if anything changed the proposal expires instead of running. A proposal can execute once. |
| Agents and the model cannot act | Chat's tools are read-only plus `propose_action`, which only creates a proposal. The brief's only tool reads its own stored facts. No model output reaches a service function without the founder confirming a code-built preview. |
| Push | No payload: no business data passes through Apple/Google/Mozilla. Endpoints must be HTTPS on a known push service (no SSRF to internal hosts); redirects refused; gone subscriptions removed. |
| On the device | `no-store` pages and API; service worker never caches them; offline page contains no data. |
| Preserved | Payment verification, the existing approval gates, the audit log and the studio dashboard are unchanged; Command calls the same functions. |

## 5. Actions (one registry)

`src/command/actions.js`. Used by Approvals, Chat, Brief recommendations and Settings.

| Action | Impact | Effect (through the existing service) |
|---|---|---|
| `send_quote` | high | `quotes.approveAndSend` |
| `approve_assignment` / `reject_assignment` | high / low | `assignments.approve` (offer + message) / `reject` |
| `send_message` / `discard_message` | high / low | `messaging.approveAndSend` / `discard` |
| `issue_invoice` | high | `billing.approve` |
| `sign_off_deliverable` | high | `projects.approveDeliverable` (technical reviewer rule applies) |
| `release_deliverable` | high | `projects.releaseDeliverable` (final files still held until paid) |
| `resolve_exception` | low | closes a payment exception with the founder's note; moves no money |
| `draft_quote` | low | queues the Sales Agent to draft (nothing is sent) |
| `retry_task` | low | `orchestrator.retryJob` |
| `generate_brief` | low | queues a Morning Brief |
| `update_settings` | high if it touches permissions, providers, budgets or automation | `settings.set` per key |

## 6. The AI workflow: Morning Brief

1. **Collect.** At the founder's hour (local time zone) the app collects **verified facts** for the window since the previous daily brief: verified payments and exceptions, inquiries, quotes sent / accepted / declined, contractor activity, QA results, sign-offs and releases, stage changes, failed agent tasks, costs, messages — plus the state now (approvals waiting, health checks that need attention, project counts). Each fact is a sentence built by code with an id (`F7`) and a link to its record. The facts are stored with the brief.
2. **Write.** A durable job runs the **Command Agent** on the agent runtime (retries, budgets, transcript, cost). Its only tool reads that brief's facts. It returns a headline, sections and recommended actions, each citing fact ids. Without a model (or over budget) the same output is compiled by rules and labelled "Compiled from records without AI".
3. **Check.** Every item must cite existing facts, and any amount or project code it mentions must appear in a cited fact. Anything else is removed and the count is shown ("2 statements removed"). A recommended action keeps its target only if a cited fact refers to that record.
4. **Act.** The founder gets a notification; each recommendation opens as an ordinary preview to confirm.

## 7. Command Chat

* Read-only tools, executed automatically: `business_overview`, `list_projects`, `get_project`, `pending_approvals`, `recent_events`, `earnings`, `agent_status`, `find_contractors` (no contact details).
* `propose_action` creates a proposal and returns its preview title; the reply shows an action card that opens the preview. The model is told — and the code enforces — that nothing has happened until the founder confirms.
* Model calls are budgeted and recorded (agent `command`, task `command.chat#n`). If the budget is used up or the provider fails, the answer comes from rules and says so.
* Without a provider, a rules router answers the common questions (overnight, attention, earnings, blocked agents, find a designer, prepare a quote) from the same tools — labelled "Rules".

## 8. Model providers

`src/ai/providers/`: one adapter interface (`turn`, `callsOf`, `toolResults`, `expand`, `display`) with two implementations.

| | Anthropic | OpenAI |
|---|---|---|
| API | Messages API via `@anthropic-ai/sdk` (strict tools, adaptive thinking, effort, prompt caching, server-side refusal fallback) | Chat Completions via `fetch` (strict function calling, no parallel calls; one call per turn so tasks get twice the turn allowance) |
| Configure | `ANTHROPIC_API_KEY`, `AI_MODEL` | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_PRICE_INPUT_PER_MTOK`, `OPENAI_PRICE_OUTPUT_PER_MTOK` (+ optional `OPENAI_PRICE_CACHED_INPUT_PER_MTOK`, `OPENAI_BASE_URL`) |
| Files (QA) | PDF/image blocks inside tool results | attached in a user message after the tool result |
| Cost | built-in price table | the configured prices (dated model names map to the configured model) |

* Selection: Settings → Model provider (`auto` / `anthropic` / `openai` / `rules`), defaulting to `AI_PROVIDER`. A provider that is not configured cannot be selected. Per-agent mode: `auto`, `rules` (never a model) or `paused`.
* A task finishes on the provider it started on, even if the setting changes mid-task (tested).
* The structured drafting gateway (staff "draft with automation" buttons) uses the same selection.

## 9. Notifications

| Kind | Trigger (deterministic) |
|---|---|
| New paid project | `invoice.paid` on a deposit **and** `billing.depositVerified` |
| Pending approval | a new approval/review human task; payment exceptions and deposit mismatches (urgent) |
| Workflow failure | an agent task failed after retries; a workflow blocked |
| Contractor delay | offer unanswered for 48 h; accepted work past its due date |
| Project risk | due within 5 days with production open; QA fail; overdue tasks |
| Unusual expense | a cost above the founder's threshold (default $500); AI spend at 80% / 100% of the monthly budget; external services at 80% of a project budget |
| Morning Brief | brief ready |

Each is keyed (notifies once), always in the in-app centre, pushed if that kind is switched on. On iPhone, push needs iOS 16.4+ and Command added to the Home Screen.

## 10. Sample data

`npm run seed:sample` (development only; refuses production) fills an **empty** data directory through the app's own routes: one paid project in production with a contractor submission awaiting sign-off, two new leads with draft quotes, a cost above the flag, notifications and a brief. Brand and contractor names end in "(sample)", and Command shows a **Sample data** banner for that data directory. Simulated payments and messages are labelled throughout. Nothing in production is ever seeded.

## 11. Tests

`npm test` — 110 tests. Command-specific:

* `tests/command.test.js` — route enumeration for founder-only access (no session, non-founder staff, founder's admin session); generic sign-in failure; cookie scope; `no-store`; revocation; CSRF and JSON scoping; `FOUNDER_EMAIL` sync; service worker scope; approvals preview → confirm; stale preview expiry; digest mismatch; step-up password; single execution; low-impact actions; permission changes via preview; unconfigured provider refused; chat (rules answers, proposals not executed, simulated-model tool use, unknown tools, prompt injection, budget fallback, conversation ownership); Morning Brief (rules, citation checking with invented ids / amounts / codes, daily scheduling); notifications and Web Push (endpoint allow-list incl. metadata IP and look-alike hosts, VAPID signature, empty payload, preferences, contractor delay, 410 clean-up).
* `tests/providers.test.js` — OpenAI schema conversion; configuration rules; a full agent task on a local OpenAI-shaped mock (strict tools, no parallel calls, contact details withheld, transient error retried on the same provider after the setting changed, prices incl. cached input, transcript viewer); Command Chat on OpenAI.
* `tests/mobile.test.js` — real Chromium at iPhone 13 and desktop sizes: no horizontal scroll, one `h1`, labelled controls, named buttons, target sizes (24 px minimum, 44 px for primary controls), text contrast, the JS chat, the tab bar. Skipped where Playwright is not installed.

## 12. Deployment requirements

In addition to [DEPLOYMENT.md](DEPLOYMENT.md):

| Variable | Needed | Notes |
|---|---|---|
| `FOUNDER_EMAIL` | yes (or use `npm run founder`) | comma-separated; authoritative at start |
| `COMPANY_TIMEZONE` | recommended | IANA name, e.g. `America/New_York`; changeable in Settings |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | recommended | base64url raw P-256 keys; if unset, a key pair is generated once into `DATA_DIR/vapid.json` (0600) — back it up, or devices must re-subscribe |
| `OPENAI_*` | only to use OpenAI | see §8 |
| `PUSH_EXTRA_HOSTS` | never in production | test hook; refused when `NODE_ENV=production` |

* HTTPS is required for installation, service workers and push.
* Install on iPhone: open `https://<host>/command` in Safari → Share → Add to Home Screen → open it → Settings → Enable on this device.
* Go-live gates for Command: founder account set; step-up and sign-out-all tested on the real phone; a real push received on the phone; a real Morning Brief read against the records it cites.

## Not verified here

* No live model call was made (no API keys in this environment). Both providers were exercised against local mocks with the real request shapes; the Anthropic SDK path was verified earlier the same way.
* Push to a real Apple/Google push service and iOS Home Screen install were not tested (no device); the VAPID signing, request shape and service worker logic are covered by tests.
