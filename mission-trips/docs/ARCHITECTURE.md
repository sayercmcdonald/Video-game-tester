# Architecture

_Last updated: 2026-10-26. Written for a non-engineer owner; technical detail is in the code comments._

## The short version

Sent (codebase: `mission-trips`) is a single web application (Next.js) backed by one PostgreSQL database. Stripe handles all card data and money movement. Every request that touches church data passes through one permission layer that checks *who you are*, *which church you belong to*, and *what your role allows* — on the server, every time.

```
Browser ──► Next.js server ──► permission layer ──► services ──► PostgreSQL
                 │                                      │
                 │◄── Stripe webhooks (signed) ─────────┤
                 └──► Stripe Checkout (hosted page) ◄───┘
```

## Stack and why

| Piece | Choice | Why |
| --- | --- | --- |
| App framework | **Next.js 16** (React 19, TypeScript) | One codebase for pages and server logic; server actions keep data access on the server. |
| Database | **PostgreSQL 16** | Reliable, transactional, strong constraints; the industry default for money. |
| Database access | **Prisma 7** | A readable schema file (`prisma/schema.prisma`) that doubles as documentation, with versioned migrations. |
| Payments | **Stripe Checkout + Stripe Connect** | Card data never touches our servers. With Connect, each church's gifts land in the church's own Stripe account. |
| Validation | **Zod** | Every form input is checked on the server with plain-English error messages. |
| Styling | **Tailwind CSS 4** | Consistent design tokens; no heavy UI framework. |
| Tests | **Vitest** (integration, real Postgres) + **Playwright** (browser) | Business logic tested against a real database; full workflows tested through the real UI. |

## Multi-church isolation (the most important design rule)

1. **Every church-owned row has `orgId`.** Services always look records up by `id` **and** the current church's `orgId`. A trip ID from another church simply isn't found.
2. **The database enforces it too.** Child records reference parents with a *composite* foreign key (`tripId + orgId`). Postgres refuses to save, for example, a campaign that claims church A but points at church B's trip — even if application code had a bug. (Tested.)
3. **"Not found", never "forbidden".** Pages show the same "couldn't find that page" whether a record doesn't exist or belongs to someone else, so IDs can't be probed.
4. **Platform admins don't get a back door.** The platform admin page shows operational counts, not church records.

Postgres Row-Level Security (a third layer) is a planned hardening step — see TASKS.md.

## Permissions

All rules live in one file, `src/server/permissions.ts`, as small pure functions that are unit-tested. Example: `tripPermissions()` turns *(church role, trip status, the person's trip membership, church settings)* into answers like `manage`, `viewFinances`, `viewSensitive`, `administerFinances`.

`src/server/context.ts` loads the current user from their session cookie, then the church (only if they're a member), then the trip (only if they may see it). Every server action calls these loaders itself; IDs passed from the browser are treated as addresses, never as proof of access.

## Money

- **Integer cents everywhere.** No floating-point money.
- **Pledges ≠ donations.** Pledges are promises in their own table and are never added to "raised".
- **Donations have a lifecycle:** `PENDING` (checkout opened) → `SUCCEEDED` / `FAILED` / `CANCELED` (abandoned) → possibly `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`.
- **The ledger is the single source of truth.** Every movement (gift received, processing fee, refund, chargeback, chargeback won, expense paid, expense voided) is a `LedgerEntry`. Totals are computed from the ledger, never stored as running numbers that could drift.
- **The ledger can't be edited.** A database trigger rejects any update or delete. Corrections are new entries.
- **Database checks** forbid negative gifts, refunds larger than the gift, and similar impossibilities.

### How an online gift works

1. Donor fills in the giving page. The server validates, creates a `PENDING` donation, and asks Stripe for a hosted Checkout page (idempotency key = donation ID, so retries never create duplicates). The donor is redirected to Stripe.
2. Donor pays on Stripe's page. We never see the card.
3. Stripe sends a **signed webhook** to `/api/stripe/webhook`. We verify the signature, store the event ID (duplicates are ignored), fetch the payment and fee from Stripe, check the amount matches exactly, and in one transaction mark the donation `SUCCEEDED`, assign the next receipt number, and write ledger entries. Each ledger entry has a unique `sourceRef` so the same money can't be counted twice even if two copies of an event are processed at the same moment. (Tested.)
4. The thank-you page shows the status **from our database** — "confirming…" until the webhook lands — never assuming success because the browser was redirected.
5. **Safety net:** an hourly job asks Stripe about gifts still pending after 30 minutes, in case a webhook was missed.

Refunds requested by an admin are sent to Stripe with an idempotency key; the ledger changes only when Stripe confirms via webhook. Refund events carry the *cumulative* refunded amount, so repeated or out-of-order events can't double-count. Disputes withdraw funds in the ledger and are reversed if won.

### Stripe Connect

In `connect` mode each church connects its own Stripe account (Standard-style: the church owns the dashboard, payouts and compliance). Gifts are "direct charges" on that account. The platform takes no fee and never holds church money. In `platform` mode (single-church pilot), everything uses the server's one Stripe account.

## Private files

- Stored outside the public web folder under random names (`STORAGE_DIR`), never at a guessable URL.
- Served only by `/api/files/[id]`, which checks permissions on every request, sends `no-store` caching headers and a sandboxing content-security policy, and logs views of other people's files.
- Uploads are limited to 10 MB and to PDF, images, Word and text; the file's actual bytes are checked against its claimed type, so a renamed executable is rejected.
- The current driver is local disk, suitable for a single server with a persistent volume. A cloud object-storage (S3-compatible) driver is on the task list for multi-server hosting.

## Sensitive personal data

Medical notes, allergies and medications are encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY` before they reach the database. Tampering is detected. Emergency contact details are stored in normal columns but shown only to authorized people. Viewing someone else's profile is written to the activity log.

## Authentication

Email + password (bcrypt, cost 12). Sessions are random 256-bit tokens stored only as SHA-256 hashes, in an `httpOnly`, `SameSite=Lax` cookie (and `Secure` in staging/production), sliding 30-day expiry. Login is rate-limited and gives the same message for "no such account" and "wrong password". Password reset and email verification use single-use, expiring, hashed tokens; a reset signs the user out everywhere. Server actions get Next.js's built-in origin checks against cross-site request forgery.

## Email and notifications

Every notification is an in-app record plus, if the person's preferences allow, an email. Emails go to an outbox table first and are delivered from there (Resend in production; logged to the console in development). Failed sends are retried by the job runner. Reminders are de-duplicated with unique keys so running the job often never double-sends.

## Scheduled jobs

`npm run jobs:run` (or `POST /api/cron/all` with `Authorization: Bearer $CRON_SECRET`) runs: deadline reminders, Stripe reconciliation, email retries, expired-session cleanup. Run it hourly.

## Environments

`APP_ENV` is `development`, `test`, `staging` or `production`, each with its own database, Stripe keys, encryption key and email settings. On startup, production refuses to run with a Stripe **test** key, without a real email provider, or without a cron secret. Secrets come only from environment variables; `.env` is git-ignored.

## Audit trail

`AuditLog` records who did what: role changes, approvals, gifts recorded, refunds, expense changes, report publishing, waiver signatures, and every view of private profiles and files. A database trigger prevents edits. Church admins can read it under **Activity log**.

## Spending controls (added 0.3.0)

Expenses have a lifecycle: `PENDING_APPROVAL` → `COMMITTED` or `PAID` (approved) or `REJECTED`; approved ones can later become `VOID`. A trip leader's expense always starts as `PENDING_APPROVAL` and counts toward nothing (budget, spending, ledger, donor figures) until a church administrator approves it. Only administrators mark expenses paid or void approved ones; a leader may withdraw their own pending submission. Approval uses a guarded update so two simultaneous approvals apply once. Paid expenses create a ledger entry; voiding a paid expense creates an offsetting entry. Every step is audit-logged.

## "Needs attention" (`src/server/services/insights.ts`)

Alerts are computed on demand from records; nothing is stored or changed. Rules and thresholds (in `RULES`, unit-tested):

| Alert | Trigger |
| --- | --- |
| Overdue | A required item with a due date in the past that some approved participants haven't completed |
| Due soon | Due within 7 days and not completed by everyone |
| Reviews / applications | Submissions awaiting review; applications awaiting a decision |
| Departure risk | Departure within 30 days and anyone not 100% ready |
| Fundraising behind pace | Fundraising is due 14 days before departure. Between a participant's approval and that date, the expected amount grows evenly. Flagged when received is more than 15 points of the goal behind the even pace, once 25% of the window has passed; "short" once the deadline passes |
| Budget over | A category's paid + committed exceeds its budget line |
| Shortfall | Available funds minus committed (unpaid) costs is below zero; open pledges are mentioned but not counted |
| Expense approvals | Any expense awaiting approval (admins only) |
| Disputes / refunds | Gifts under dispute (urgent); refunds in the last 30 days (FYI) |

Who sees what: management alerts go to admins and leaders; financial alerts follow "leaders can see finances"; approvals and disputes go to admins only. Severity is shown with a shape and a word, never color alone.

Reminders a leader sends are previewed first (who, and which items) and limited to one per person per day.

## Donor transparency (`src/server/services/transparency.ts`)

- **Live summary** (opt-in per trip, admin-only setting): given (after refunds), fees, spent by category vs. budget, committed, remaining, last-updated time. Aggregates only; pending expenses and pledges are excluded; hidden if the church is suspended.
- **Report drafts**: `composeReportDraft` writes plain sentences using only figures from the ledger and trip records; an admin edits before publishing. Published reports remain snapshots.
- Every donor-facing figure carries the note that gifts are pooled and not matched to specific expenses.

## Integrations

See [INTEGRATIONS.md](INTEGRATIONS.md). Tables: `Integration` (per church/provider, encrypted credentials, status), `ExternalLink` (record mapping with owner, unique to prevent duplicates), `SyncRun` (history). CSV exports run through `runExport`, which is admin-only, church-scoped, logged, and protects against spreadsheet formula injection.
