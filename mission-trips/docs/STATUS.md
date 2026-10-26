# Implementation Status

_Last updated: 2026-10-26 (session 1)_

Legend: ✅ implemented and tested · 🟡 implemented, partly tested or needs real-world verification · ⬜ not built

## Phase 1 — Foundation

| Capability | State | Tested by |
| --- | --- | --- |
| Sign up, sign in, sign out, sessions | ✅ | `tests/accounts.test.ts`, e2e |
| Email verification, password reset (single-use tokens) | ✅ | `accounts.test.ts` |
| Login rate limiting, identical errors for unknown email / wrong password | ✅ | `accounts.test.ts` |
| Role model (platform admin, church admin, leader, participant, applicant, donor) | ✅ | `permissions.test.ts` (pure rules), `tenant-isolation.test.ts` |
| Church isolation (app layer + composite foreign keys) | ✅ | `tenant-isolation.test.ts`, e2e "can't reach records" |
| Church self-signup → platform approval → active | ✅ | e2e |
| Invitations (church or trip, role, email-bound, single use, expiring, revocable) | ✅ | `tenant-isolation.test.ts`, e2e |
| Trips: create, edit, status flow, participant limit, applications | ✅ | integration + e2e |
| Apply → approve / waitlist / decline, with notifications | ✅ | integration |
| Itinerary | 🟡 | manual screenshots only |
| Dashboards: church admin, trip manager, participant, applicant, donor, platform | ✅ | e2e + manual review at desktop and phone widths |

## Phase 2 — Fundraising

| Capability | State | Tested by |
| --- | --- | --- |
| Team fund, participant pages (auto-created on approval), project campaigns | ✅ | integration |
| Public giving page, campaign progress, recent supporters (first names only) | ✅ | e2e (unavailable state), manual |
| Stripe Checkout session creation (idempotent) | 🟡 | `payments.test.ts` with a fake Stripe; **not yet run against real Stripe test mode** |
| Webhook signature verification, event de-duplication, concurrency safety | ✅ | `payments.test.ts` (real signatures) |
| Paid / bank-pending / failed / abandoned / amount-mismatch / wrong-account events | ✅ | `payments.test.ts` |
| Processing fees (immediate or settled later) | ✅ | `payments.test.ts` |
| Refunds (partial, full, repeated, out of order), admin-only, idempotent | ✅ | `payments.test.ts` |
| Disputes opened / won | ✅ | `payments.test.ts` |
| Missed-webhook reconciliation job | ✅ | `payments.test.ts` |
| Offline (check/cash) gifts with receipts | ✅ | integration + e2e |
| Pledges separate from received money | ✅ | integration + e2e |
| Sequential receipts; access by token link, verified donor, or admin | ✅ | `payments.test.ts`, e2e |
| Stripe Connect onboarding for churches | 🟡 | code complete; **needs a test-mode run** |
| Donor portal (history, receipts, campaign progress, public updates) | 🟡 | manual |

## Phase 3 — Operations

| Capability | State | Tested by |
| --- | --- | --- |
| Requirements: upload, waiver, configurable form, task; review; due dates | ✅ | `operations.test.ts`, e2e |
| Readiness matrix and percentages | ✅ | `operations.test.ts`, e2e |
| Private file storage and authorized download, view logging | ✅ | `operations.test.ts`, e2e |
| Upload validation (type, size, content sniffing, filename cleaning) | ✅ | `operations.test.ts`, e2e |
| Shared trip documents | 🟡 | manual |
| Team announcements; public updates with admin approval | ✅ | `operations.test.ts` |
| In-app notifications, email outbox, per-category preferences | ✅ | integration (indirect) |
| Deadline reminders (7d / 2d / due), de-duplicated | ✅ | `operations.test.ts` |

## Phase 4 — Financial accountability

| Capability | State | Tested by |
| --- | --- | --- |
| Append-only ledger (DB trigger), money constraints | ✅ | `payments.test.ts` |
| Expenses: committed / paid / void (with reversal), receipts | ✅ | `operations.test.ts`, e2e |
| Budget by category; budget vs. actual chart with table view | ✅ | `operations.test.ts`, manual |
| Restricted vs unrestricted balances | 🟡 | computed and shown; no transfer between funds yet |
| Published donor reports (snapshots, totals only), final report flag | ✅ | `operations.test.ts`, e2e |
| Public trip page | ✅ | e2e |
| Activity log | ✅ | e2e |
| Encrypted medical data; profile view permissions and logging | ✅ | `operations.test.ts`, e2e |

## Phase 5 — Production readiness

| Capability | State |
| --- | --- |
| Lint, typecheck, unit/integration and e2e suites | ✅ all passing |
| Security headers, file-serving CSP, secure cookies in staging/production | ✅ |
| Production config guards (no Stripe test key, real email, cron secret) | ✅ |
| Responsive layouts (verified at 390 px: no horizontal scroll on 12 key pages) | ✅ |
| Accessibility basics (labels, focus rings, skip link, ARIA on charts/progress, AA color tokens, chart table views) | 🟡 no automated axe audit yet |
| Health check endpoint | ✅ |
| Error monitoring service (e.g. Sentry) | ⬜ |
| Automated backups | ⬜ (use managed Postgres backups; see DEPLOYMENT.md) |
| Cloud object storage for files | ⬜ |
| Postgres row-level security | ⬜ |
| CI pipeline | 🟡 workflow file added; first run pending on GitHub |

## Verified this session

- 75 integration/unit tests pass (`npm test`), 12 end-to-end browser tests pass (`npm run test:e2e`), lint and typecheck clean, production build succeeds.
- Every main page rendered and reviewed as admin, leader, participant, applicant and platform admin; access denials confirmed for each role.

## Not verified

- Real Stripe test-mode checkout, webhooks via the Stripe CLI, and Connect onboarding (no Stripe keys in this environment).
- Real email delivery through Resend.
- Behavior under load or with many churches.
