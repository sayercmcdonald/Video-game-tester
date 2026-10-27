# Prioritized Task List

_Last updated: 2026-10-27_

## Next three (recommended)

1. **Run the real Stripe flow in test mode** (checkout, webhook, receipt, refund, dispute, reconciliation, Connect onboarding). Needs Stripe test keys.
2. **Deploy staging** (managed Postgres with point-in-time recovery, persistent disk or S3 driver, error monitoring, hourly jobs) and run the browser tests against it.
3. **Start church interviews** (VALIDATION.md) and line up one pilot church; decide on minors/guardian consent before recruiting a youth trip.

## Added in session 3 (backlog)

- Planning Center Giving sync (first live integration; needs a Planning Center account).
- Trip cloning (competitors offer it; saves setup time for repeat trips).
- SMS reminders (competitors offer it; needs a provider and consent handling).
- Background-check integration (Go Method offers it; youth trips often require it).
- Platform admin view of failed syncs alongside failed Stripe events.
- Make the fundraising deadline (currently 14 days before departure) a per-trip setting.

## P0 — Before a real church pilot

1. **Run the full Stripe flow in test mode** with the Stripe CLI: checkout, webhook, receipt, refund, dispute (test cards), reconciliation job. Confirm fee amounts and Connect onboarding (`controller` settings) end to end. _Needs Stripe test keys._
2. **Decide the payment model** (Connect vs. single account) — see RISKS.md "Decisions needed".
3. **Minors and guardians**: if participants can be under 18, add guardian contact, guardian consent/waiver signature, and remove participant names from public URLs/pages for minors.
4. **Legal review** of waiver signing (typed-name e-signature + consent wording), receipt wording, and privacy policy/terms pages (not yet present).
5. **Cloud file storage driver** (S3-compatible, private bucket, server-side encryption) unless hosting on a single server with a persistent, backed-up disk.
6. **Error monitoring** (Sentry or similar) and uptime monitoring of `/api/health`.
7. **Backups**: enable managed Postgres point-in-time recovery; back up the file store; do one restore drill.
8. **Deploy staging** with its own database and Stripe test keys; run the e2e suite against it.

## P1 — Shortly after pilot start

9. Postgres row-level security policies keyed on `orgId` as a third isolation layer.
10. Move rate limiting to Postgres/Redis (current limiter is per-server, in memory).
11. Edit expenses (currently void + re-enter), edit and reorder requirements, edit itinerary items.
12. Email donors when a public update or report is published (with opt-in and unsubscribe).
13. CSV export of donations, expenses and ledger for the church's bookkeeper.
14. Account self-service: change email/password in-app, delete account / data export requests.
15. Two-factor authentication for church and platform admins.
16. Automated accessibility audit (axe) in the e2e suite; fix findings.
17. Return proper HTTP 404 status for forbidden pages (currently 200 with the not-found page; content is correctly hidden).

## P2 — Later

18. Transfers between restricted and unrestricted funds (with admin approval and memo).
19. Recurring gifts; donor-covers-fees option.
20. Photo updates with consent tracking.
21. Per-church custom domains and branding on giving pages.
22. Multi-currency.
23. Accounting integrations (QuickBooks).

## Done (session 1)

See [STATUS.md](STATUS.md) and [CHANGELOG.md](CHANGELOG.md).
