# Sent

_Mission management. Transparent giving. Greater impact._ (Codebase folder: `mission-trips`.)

A platform for churches to run mission trips end to end: recruit and approve a team, collect required documents and waivers, raise support through Stripe, track expenses against a budget, and publish honest financial reports to donors.

> **Status:** early-stage, pilot-ready foundation. See [docs/STATUS.md](docs/STATUS.md) for exactly what is implemented, tested, and still missing before a real church pilot.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | Product requirements: who it's for, what it must do, what's out of scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is built and why, in plain English |
| [docs/AUDIT-2026-10-27.md](docs/AUDIT-2026-10-27.md) | Current-state audit against the Sent vision |
| [docs/COMPETITIVE.md](docs/COMPETITIVE.md) | Competitor research with sources |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Riskiest business assumptions, interview guide, pilot design |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | What connects to what, verified, and how the integration layer works |
| [docs/DESIGN.md](docs/DESIGN.md) | The design system, based on Apple's Human Interface Guidelines |
| [docs/STATUS.md](docs/STATUS.md) | What's implemented, what's tested, what's incomplete |
| [docs/TASKS.md](docs/TASKS.md) | Prioritized task list |
| [docs/RISKS.md](docs/RISKS.md) | Known bugs, technical risks, and open decisions |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to staging and production, Stripe and email setup, backups |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Meaningful changes over time |

## Run it locally

**You need:** Node.js 20.19+ (22 recommended) and PostgreSQL 14+.

```bash
cd mission-trips
npm install                       # also generates the database client
cp .env.example .env              # then edit .env (see below)
```

In `.env`, set at minimum:

- `DATABASE_URL` — a local Postgres database, e.g. `postgresql://mission:password@localhost:5432/mission_dev`
- `DATA_ENCRYPTION_KEY` — run `openssl rand -base64 32` and paste the result. This encrypts medical notes; **keep it safe** — if it's lost, encrypted fields can't be read.

Then:

```bash
npx prisma migrate deploy         # create the tables
npm run db:seed                   # optional: clearly-labeled demo data
npm run dev                       # http://localhost:3000
```

Demo sign-ins (password `demo-password-123`): `admin@demo.test` (church admin), `leader@demo.test` (trip leader), `hannah@demo.test` (participant), `eli@demo.test` (applicant), `platform@demo.test` (platform admin). The demo church's gifts are check gifts recorded by an admin; the seed never creates online payments.

Emails are not sent in development: they're written to the `EmailOutbox` table and printed in the terminal, so you can click invitation and password-reset links from there.

## Online giving (Stripe) in development

Leave the Stripe variables blank and the app works normally, with giving pages showing "not accepting online gifts". To test real checkout with Stripe **test mode**:

1. Put your test secret key (`sk_test_…`) in `STRIPE_SECRET_KEY`.
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run
   `stripe listen --forward-to localhost:3000/api/stripe/webhook --forward-connect-to localhost:3000/api/stripe/webhook`
   Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`.
3. For one church, `STRIPE_MODE=platform` is simplest. For several churches, `STRIPE_MODE=connect` and use **Settings → Payments → Connect with Stripe** in each church.
4. A platform admin must approve the church (`/admin`) before its giving pages go live. Grant yourself that role with `npm run make-admin -- you@example.org`.
5. Use Stripe's test card `4242 4242 4242 4242`. The gift is marked received only when the webhook arrives.

## Tests

```bash
npm test             # 98 unit + integration tests against a real Postgres test database
npm run build && npm run test:e2e   # 15 browser tests of complete workflows
npm run lint && npm run typecheck
```

- Integration tests use the database in `TEST_DATABASE_URL` (default `postgresql://mission:mission_dev_pw@localhost:5432/mission_test`); it is emptied between tests. **Never point it at real data.**
- End-to-end tests use `E2E_DATABASE_URL` (default `…/mission_e2e`), which is emptied at the start of each run. If Playwright's browser isn't installed, run `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_PATH` to an existing Chromium.

## Common tasks

| Task | Command |
| --- | --- |
| Create a migration after editing `prisma/schema.prisma` | `npm run db:migrate -- --name what_changed` (interactive), or `scripts/new-migration.sh what_changed` |
| Apply migrations (staging/production) | `npm run db:deploy` |
| Make someone a platform admin | `npm run make-admin -- someone@example.org` |
| Run scheduled jobs once (reminders, reconciliation, email retries) | `npm run jobs:run` |

## Project layout

```
prisma/schema.prisma     the data model (start here)
prisma/migrations/       database changes, applied in order
src/server/              everything that runs only on the server
  permissions.ts         who may do what (pure rules, fully unit-tested)
  context.ts             loads "who is asking, for which church" on every request
  services/              business logic: trips, donations, ledger, requirements…
  payments/              Stripe gateway and webhook processing
src/app/                 pages and server actions (Next.js App Router)
src/components/          shared UI
tests/                   integration tests; tests/e2e/ browser tests
docs/                    product and engineering documentation
```
