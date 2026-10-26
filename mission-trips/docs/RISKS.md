# Known Bugs, Technical Risks and Open Decisions

_Last updated: 2026-10-26_

## Decisions needed from the product owner

| # | Decision | My recommendation | Why it matters |
| --- | --- | --- | --- |
| D1 | **Payment model:** each church connects its own Stripe account (Connect) vs. one platform Stripe account. | **Connect** (implemented as default). For a single-church pilot, `STRIPE_MODE=platform` also works. | With Connect the church receives and controls its money; the platform never holds church funds, which greatly reduces legal, tax and money-transmission exposure. A single platform account would make *you* responsible for holding and passing on donations. |
| D2 | **Will participants include minors?** | Assume yes for youth trips; build guardian consent before piloting with minors. | Child-privacy obligations, guardian signatures on waivers, and not exposing children's names publicly. Participant support pages currently use the participant's name in the page title and URL. |
| D3 | **Waiver signatures.** Typed-name signatures with timestamp and audit log are implemented. | Have the church's attorney approve the waiver text and the signing method. | Enforceability varies by jurisdiction; some churches will require wet signatures or a dedicated e-signature service. |
| D4 | **Hosting.** | A managed Node host with managed Postgres and a persistent disk (e.g. Render, Railway, Fly.io), or add the S3 driver first if using serverless hosting. | Uploaded files currently live on local disk. |
| D5 | **Repository.** This code lives in a repository named `video-game-tester` next to an unrelated project. | Move `mission-trips/` to its own repository before inviting collaborators. | Clarity, access control, and CI scope. |
| D6 | **Platform fee.** None is charged today. | Decide before pilot whether the platform takes an application fee via Connect. | Affects pricing, receipts and disclosures. |

## Known bugs / limitations

| Issue | Impact | Workaround / plan |
| --- | --- | --- |
| Forbidden and missing pages under the church workspace return HTTP **200** with the not-found page (Next.js 16 streams the layout before the page decides). | Cosmetic for users; monitoring tools may not see a 404. Content is correctly withheld (verified). | TASKS P1 #17. |
| Rate limiting is in memory, per server process. | With multiple servers, attackers get more attempts. | Run a single instance for the pilot, or move to Postgres/Redis (TASKS P1 #10). |
| File storage is local disk. | Files are lost if the server's disk is lost; can't run multiple servers. | Persistent volume + backups, or S3 driver (TASKS P0 #5). |
| Expenses can't be edited after creation (void and re-enter). Requirements can't be edited or reordered. Itinerary items can't be edited. | Minor friction. | TASKS P1 #11. |
| Trip "Total budget" field and per-category budget lines can disagree until category lines are saved (saving lines overwrites the total). | Possible confusion. | Make the total read-only once category lines exist. |
| Itinerary times are stored as "wall-clock" local times without a time zone. | Correct for display; not usable for cross-time-zone reminders. | Store a time zone per trip if itinerary reminders are added. |
| Large lists are capped (e.g. 200–300 donations per page) without pagination. | Fine for a pilot church. | Add pagination when needed. |
| Public updates are not emailed to donors. | Donors must visit the trip page or donor portal. | TASKS P1 #12. |
| No in-app password change or account deletion. | Users use password reset; deletions handled manually. | TASKS P1 #14. |

## Technical risks

| Risk | Likelihood | Mitigation in place | Further mitigation |
| --- | --- | --- | --- |
| Stripe integration behaves differently from the tested fake (API version `2026-09-30`). | Medium | Narrow gateway interface; signature verification uses the real SDK; amount-mismatch guard refuses to record unexpected amounts. | Full test-mode run before pilot (P0 #1). |
| Missed or delayed webhooks leave gifts "processing". | Medium | Hourly reconciliation job; platform admin sees stuck payments; Stripe retries for 3 days. | Alert on `stalePending > 0`. |
| Loss of `DATA_ENCRYPTION_KEY`. | Low | Documented prominently. | Store in a secrets manager with backup; plan key rotation. |
| A future code change forgets the `orgId` filter. | Medium over time | Composite foreign keys; isolation tests; "not found" pattern. | Row-level security (P1 #9); code review checklist. |
| Email deliverability (receipts in spam). | Medium | Outbox with retries. | Verified sending domain (SPF/DKIM/DMARC) in Resend. |
| Dependency vulnerabilities. | Ongoing | `npm audit` was clean at time of writing. | Dependabot / weekly audit in CI. |
