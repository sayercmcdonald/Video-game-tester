# Sunday Division

The studio's website, client intake, client portal, internal operating dashboard, payments and the founder's own app — one small Node.js application.

- **Sunday Division Command** (`/command`) — the founder's private, installable mobile app: overview and company health, an AI Morning Brief built only from verified facts, projects, approvals with code-built previews, Agent Studio, Command Chat, performance, notifications with Web Push, and settings for agent permissions, model providers and budgets. Founder-only, enforced on the server. See [`docs/COMMAND.md`](docs/COMMAND.md).
- **Public site** — Home, Services, Portfolio (concept studies, labelled as such), About, Start a Project, Client Portal, Contact, Privacy.
- **Intake** — validated project form with reference-image upload, stored privately.
- **Dashboard** (`/admin`) — leads, quotes and scopes, projects, tasks and milestones, files, deliverables and revisions, contractors, invoices and payments, profitability, approvals queue, audit history.
- **Client portal** (`/portal`) — quote acceptance, secure payment, progress updates, released files, revision requests.
- **Payments** — Stripe Checkout (hosted). Deposit first, balance before final files.
- **Automation** — drafts triage notes, briefs, quotes, task lists and status updates. A person approves everything client-facing.
- **INDEX V3 / FORM** — adapter and API contract ready; manual (human) mode until they are connected.
- **Business agents** — six tool-calling agents (Anthropic Claude or OpenAI, through one provider interface) (Sales, Talent, Production, Project Manager, QA, Client Success) and a deterministic Operations Orchestrator run on a durable job queue inside the app, behind every human gate. See [`docs/AGENTS.md`](docs/AGENTS.md).
- **Contractors** — approved roster, assignments recommended by the Talent Agent and approved by staff, and a contractor portal (`/contractor`) for briefs, offers and submissions.
- **Message outbox** — every message to a client or contractor is approved by staff before it is sent.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env            # optional for local use
npm run create-admin -- you@example.com "Your Name"
npm run founder -- grant you@example.com   # founder access to Command (or set FOUNDER_EMAIL)
npm start                       # http://localhost:3000  ·  dashboard /admin  ·  founder app /command
npm test                        # 110 tests: Command security, approvals, chat, brief, push, providers, mobile, agents, payments
```

To look around with something on screen, fill an empty data directory with clearly labelled sample records (development only):

```bash
DATA_DIR=./data-sample ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=a-long-password FOUNDER_EMAIL=you@example.com npm run seed:sample
DATA_DIR=./data-sample ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=a-long-password FOUNDER_EMAIL=you@example.com npm start
```

With no Stripe keys in development, payments use a built-in **simulated checkout** so the whole flow can be exercised without real money. It is refused when `NODE_ENV=production`.

## The workflow, and who approves what

| Step | Who | Gate |
|---|---|---|
| Inquiry submitted | Visitor | Validated, files checked by content, stored privately |
| Inquiry organised (triage notes) | Automation | Internal only |
| Project created from lead | Staff | — |
| Brief drafted | Automation or staff | **Staff approve** before the client can see it |
| Quote drafted | Automation or staff | **Staff approve & send** before the client can see it |
| Quote accepted | Client, in portal | Typed name + confirmation; raises the deposit invoice the quote describes |
| Deposit paid | Client, on Stripe's page | Confirmed by signed webhook; **only this unlocks work** |
| Production tasks, briefs, routing | Project Manager and Production agents | Internal; client-facing delivery date is **proposed to staff** |
| Contractor recommended | Talent Agent (approved roster only) | **Staff approve** the assignment, fee and offer message |
| Offer accepted / work submitted | The contractor, in the contractor portal | — |
| Contractor work reviewed | QA Agent reads the file | **Technical reviewer signs off** |
| Deliverable uploaded / generated | Staff, INDEX V3 or FORM | Lands "in review"; **a reviewer approves**, then **staff release** |
| Final invoice | Staff draft | **Staff approve** before it is payable; final files are held until it is paid |
| Status update drafted | Automation or staff | **Staff publish** |

Staff cannot move a project to "active" by hand: the only path is a recorded deposit payment (Stripe webhook, or a bank transfer recorded with a reference by a named user). Every approval and payment is written to an audit log.

## Configuration

All settings are environment variables — see [`.env.example`](.env.example). The important ones for launch:

| Variable | Purpose |
|---|---|
| `BASE_URL` | Public https URL of the site |
| `DATA_DIR` | Persistent directory for the database and uploads |
| `TRUST_PROXY=1` | Required behind a reverse proxy so rate limits see real client IPs |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Creates the first admin on first start |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Enables live payments |
| `ANTHROPIC_API_KEY` | Enables Claude (otherwise rules-based drafting) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_PRICE_*_PER_MTOK` | Enables OpenAI as an alternative provider |
| `FOUNDER_EMAIL` | Who may use Sunday Division Command |
| `COMPANY_TIMEZONE` | Morning Brief time and local periods |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push keys (generated into `DATA_DIR` if unset) |
| `AI_MONTHLY_BUDGET_USD`, `AI_PROJECT_BUDGET_USD` | Starting AI spend limits (then editable in Operations → Controls) |
| `ORCHESTRATOR_POLL_MS` | How often the agent worker runs (default 2000; `0` disables) |
| `AI_MODEL`, `AI_AGENT_EFFORT` | Model and effort for the agents (`claude-opus-5-5`, `medium`) |
| `MESSAGING_PROVIDER` | `manual` (production default: staff send approved messages) or `simulated` (development only) |

### Stripe setup

1. In the Stripe dashboard, create a webhook endpoint at `{BASE_URL}/webhooks/stripe` subscribed to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`.
2. Set `STRIPE_SECRET_KEY` and the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`.
3. **Before taking real payments**, run one full deposit with Stripe *test* keys (`stripe listen --forward-to localhost:3000/webhooks/stripe`, card `4242 4242 4242 4242`) and confirm the invoice flips to paid and the project unlocks. The Stripe request and webhook code is covered by tests against Stripe-shaped signed events, but it has not been run against Stripe's live API from this repository.

## Deploy

The app is a single process with a SQLite database and an uploads folder, both under `DATA_DIR`.

- Any host that runs a container or Node 22 with a **persistent volume** works (Fly.io, Render, Railway, a VPS). A `Dockerfile` is included; mount the volume at `/data`.
- Run **one instance**. Sessions and data are local to the process and disk.
- Terminate TLS at the host's proxy and set `BASE_URL=https://…` and `TRUST_PROXY=1`.
- **Back up `DATA_DIR`** (database + uploads) on a schedule; use an encrypted volume.
- Health check: `GET /healthz`.

## Security and client data

- Card details never touch this system: payment happens on Stripe's hosted page; we store only session ids and outcomes.
- Passwords are hashed with scrypt; sessions are server-side, cookies `HttpOnly` + `SameSite=Lax` (+ `Secure` over https); every authenticated form carries a CSRF token; cross-site posts are refused.
- Uploads are verified by file signature (JPG/PNG/WebP/PDF for clients), stored under random names outside the web root, and served only through authenticated, per-client-authorised routes as downloads.
- Portal access keys are stored hashed and shown to staff once; issuing a new key revokes the old one and open sessions.
- Strict Content-Security-Policy (no inline scripts or styles, no third-party origins), HSTS over https, rate limits on sign-in, portal access and public forms.
- AI drafting receives the project details but not the client's contact details, and its output is only ever a draft.

## Known gaps before and after launch

- **Email is manual.** The app does not send email: approved messages wait in the outbox for staff to send. Staff email the client their portal link and key, and reply to inquiries from their own mailbox. `NOTIFY_WEBHOOK_URL` can ping Slack on new inquiries. Transactional email is the first thing to add.
- **Two staff levels.** Every admin user has full dashboard access; founder access (Command) is a separate server-side flag. Passkeys for Command are a natural next step.
- **Privacy notice and quote terms are plain-language drafts** and need legal review for your jurisdiction.
- **Portfolio shows studio concept studies only**, drawn as SVG in `src/views/flats.js`. Replace or extend with real work as clients give permission.
- **Not verified in this environment:** live Stripe API calls, live Claude and OpenAI calls, real push delivery to a phone and the Docker image build (see the notes above).

More detail: [`docs/COMMAND.md`](docs/COMMAND.md) · [`docs/AGENTS.md`](docs/AGENTS.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)
