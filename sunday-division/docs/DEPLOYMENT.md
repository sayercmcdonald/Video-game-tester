# Deployment plan

Nothing here has been deployed. Each step that touches money, clients or contractors needs your go-ahead.

## 1. Infrastructure

* One instance of the app (Node.js 22.13+) or the included `Dockerfile`, behind HTTPS.
* A persistent, encrypted, backed-up volume for `DATA_DIR` (SQLite database + uploads). Daily backups; test a restore before launch.
* `TRUST_PROXY=1` behind the host's proxy. Health check: `GET /healthz`.
* Run exactly one instance: the job queue, sessions and rate limits live in that process and its database.

## 2. Configuration

| Variable | Value for launch | Notes |
|---|---|---|
| `NODE_ENV` | `production` | refuses simulated payments and simulated messaging |
| `BASE_URL` | `https://…` | used in portal links in messages |
| `DATA_DIR` | volume path | |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first admin | or `npm run create-admin` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **test** keys first | live keys only after step 4 |
| `ANTHROPIC_API_KEY` | studio's own key | without it every agent runs on rules |
| `AI_MODEL` | `claude-opus-5-5` | |
| `AI_AGENT_EFFORT` | `medium` | `low` to cut cost, `high` for harder drafting |
| `AI_MONTHLY_BUDGET_USD`, `AI_PROJECT_BUDGET_USD` | e.g. `50`, `5` | starting values; then managed in Operations → Controls |
| `MESSAGING_PROVIDER` | `manual` | the default in production |
| `ORCHESTRATOR_POLL_MS` | `2000` | |
| `INDEX_V3_API_URL/KEY`, `FORM_API_URL/KEY` | unset | until each integration is verified |
| `NOTIFY_WEBHOOK_URL` | optional | Slack ping on new inquiries |
| `FOUNDER_EMAIL` | the founder's staff email | who may use Sunday Division Command (or `npm run founder -- grant`) |
| `COMPANY_TIMEZONE` | e.g. `America/New_York` | Morning Brief time and local periods |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | generated once, kept in the secret store | Web Push; if unset a key pair is created in `DATA_DIR/vapid.json` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_PRICE_*_PER_MTOK` | only to use OpenAI | prices are required so budgets can be enforced |

Keep keys in the host's secret store, not in files.

## 3. Staging rehearsal (test keys, no real people)

1. Deploy to a staging URL with Stripe **test** keys and a low AI budget (e.g. `$5` monthly).
2. Add yourself as a client (a test inquiry) and a colleague as an approved test contractor with a staff-controlled email address.
3. Walk the whole workflow: inquiry → agent drafts → approve quote → approve the quote message and send it by hand → accept in the client portal → pay with card `4242 4242 4242 4242` → watch the plan, briefs and recommendation appear → approve the assignment → sign in to the contractor portal → accept → submit a real tech pack PDF → read the QA report → sign off → final invoice → pay → release.
4. On **Operations → Agent tasks**, read every transcript. Check drafted quotes and briefs against what a senior designer would write; adjust prompts in `src/agents/definitions.js` if needed.
5. Check costs per task and per project against the budget; set the real budgets.
6. Restart the server mid-task once and confirm the task resumes.

7. Install Command on your iPhone (Safari → Share → Add to Home Screen), enable push in Settings, and check: a deposit payment produces a "New paid project" push; an approval confirmed from the phone; the step-up password prompt after 12 hours (or after "Sign out all devices"); the Morning Brief against the records it cites. See [COMMAND.md](COMMAND.md).

## 4. Go-live gates (each needs your explicit approval)

* [ ] Staging rehearsal passed and transcripts reviewed.
* [ ] Stripe live keys and live webhook configured; one real low-value test payment refunded.
* [ ] Privacy notice and quote terms reviewed by a lawyer (they mention AI-assisted drafting and contractor access to project files).
* [ ] Each contractor reviewed and approved by a person, with portal keys sent securely and an agreement covering fees, confidentiality and payment terms.
* [ ] Backups running and a restore tested.
* [ ] Founder access set (`FOUNDER_EMAIL`), Command installed on the founder's phone, a real push received.

## 5. Operating it

* Daily: Operations → Human queue and Approvals; Messages outbox (manual sends).
* Weekly: Agent tasks → Failed; spend vs budget; profitability.
* Pause everything instantly from Operations → Controls if anything looks wrong; individual workflows can be paused too.
* Autonomous production stays off until INDEX V3 / FORM outputs have been compared against human work on real projects.

## 6. Rollback

* Code: redeploy the previous image; the database migrates forward only, so restore the pre-deploy backup if a rollback must cross a migration (v3 → v4 in this release: founder flag, founder sessions, notifications, briefs, Command actions; existing sessions are kept).
* Agents misbehaving: pause automation (no restart needed), fix the prompt or policy, redeploy, resume. Failed jobs can be retried or handed to a person per job.

## Not in this release

* Automatic email delivery (messages are sent by staff).
* Paying contractors (fees are recorded as costs only).
* Multi-instance hosting.
