# Changelog

## 0.2.0 — 2026-10-27

### Changed
- **Redesigned the interface after Apple's Human Interface Guidelines**, for phones first (see [DESIGN.md](DESIGN.md)): system font on Apple's type scale with 17 px body text on phones; grouped rounded sections on a gray background; capsule buttons and 44 px touch targets; filled form fields and iOS-style switches; large titles and an iOS-style back link.
- **Phone navigation:** a floating, translucent bottom tab bar (Home, Trips, Giving, People, Settings); a sidebar on wide screens. The top bar is translucent and sticky and respects the notch and home indicator.
- **Tables become list rows on phones**, so nothing needs sideways scrolling (verified on 21 pages at 390 px).
- **Dark mode** following the device setting, with contrast-checked colors for text and charts.
- Donation filters are a segmented control; Settings links to Payments, Activity log and My profile.

### Fixed
- Progress bar tracks were invisible on the gray background; ledger amounts could wrap; requirement and pledge rows were cramped on phones.


## 0.1.0 — 2026-10-26 (session 1)

First working version of the platform, built from an empty project.

### Added
- **Foundation:** email/password accounts with hashed session tokens, email verification, password reset, login rate limiting; church workspaces with admin approval by the platform team; invitations; role-based permissions in one tested module; church data isolation enforced in code and by database constraints.
- **Trips:** create/edit, draft → open → underway → completed/cancelled, participant limits, applications with approve/waitlist/decline, leader assignment, itinerary, shared documents.
- **Fundraising:** team fund, per-participant support pages (created on approval), project campaigns; public giving pages; Stripe Checkout with idempotent session creation; signed, de-duplicated webhook processing for payments, bank-debit delays, failures, abandonment, fees, refunds and disputes; hourly reconciliation for missed webhooks; check/cash gifts; pledges kept separate from received money; sequential receipts with private links.
- **Financial accountability:** append-only ledger (database-enforced), money constraints, expenses (committed/paid/void) with receipt uploads, category budgets with budget-vs-actual chart, restricted/unrestricted balances, donor reports published as totals-only snapshots, public trip page.
- **Operations:** requirements (upload, waiver signing, configurable forms, tasks) with leader review, readiness matrix, automatic deadline reminders, team announcements, donor updates with admin approval, notifications with email preferences.
- **Privacy:** encrypted medical details, restricted profile access, logging of every view of someone else's profile or file, private file storage with content-type checking.
- **Dashboards** for church admins, leaders, participants, applicants, donors and platform admins; responsive down to phone width.
- **Tests:** 75 integration/unit tests (real Postgres), 12 end-to-end browser tests.
- **Docs:** README, PRD, architecture, status, tasks, risks, deployment guide.

### Fixed during verification
- Negative zero in ledger totals would have displayed as "-$0.00".
- Forms lost everything the user had typed when the server reported a validation error (React 19 form reset).
- Reminder job could create duplicate in-app notifications on repeated runs.
- Several layouts overflowed horizontally on phones.
