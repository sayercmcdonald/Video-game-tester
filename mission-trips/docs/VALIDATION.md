# Business Validation Plan

_Last updated: 2026-10-27_

The product works end to end in testing. Whether churches will **adopt and pay** for it is unproven. Several established competitors already exist at low prices (see COMPETITIVE.md), so the riskiest assumptions are about demand, not code.

## Riskiest assumptions (most dangerous first)

| # | Assumption | Why it's risky | Cheapest test |
| --- | --- | --- | --- |
| 1 | Churches feel enough pain with current tools (spreadsheets, ChMS registrations, or an existing trip product) to adopt another one. | Many already use ManagedMissions, Go Method, ServiceReef or "good enough" spreadsheets. | 12–15 interviews; ask what they did last trip, step by step. |
| 2 | Financial accountability (ledger, approvals, donor reports) is a reason to choose Sent. | It may matter to finance staff but not to the trip leader who picks the tool. | In interviews, ask who has been asked "where did the money go?" and what they produced. Show a published report; ask if they'd send it. |
| 3 | The buyer is reachable and has budget. | Purchasing may sit with an executive pastor or finance committee, not the missions leader. | Ask "who approves software spending, and how did your current tools get bought?" |
| 4 | Churches will tolerate gifts living in Sent *and* their giving platform. | Double entry and split giving statements are a known adoption blocker. | Ask how year-end giving statements are produced today. Test whether CSV export is enough or a Planning Center sync is required. |
| 5 | Participants and donors will use it on phones without help. | Older donors, teenagers on church-managed devices. | Pilot: completion rate of requirements and gifts without staff assistance. |
| 6 | A price around $20–$60/month per church (or per active trip) is acceptable. | Competitor anchors are low; some charge per trip, some free. | Ask for a pilot commitment, then a price, before building billing. |

## Interview guide (45 minutes)

Target: missions pastors, church administrators/finance staff, and trip leaders at churches running 1–10 trips a year. Mix of churches already using a trip product and those that aren't.

1. Walk me through your last trip from first announcement to the final thank-you. Where did you keep each piece?
2. What took the most staff hours? What went wrong or almost went wrong?
3. How did you track who had paid, who had pledged, and who was behind? How did you know a participant was ready?
4. How were trip expenses approved and recorded? Who reconciled them, and when?
5. Have donors, elders, or a finance committee asked how funds were used? What did you give them?
6. How are gifts for trips handled for tax receipts / giving statements today?
7. What software do you use (ChMS, giving, accounting)? What would a new tool need to connect to?
8. If you've used a trip product: what made you choose it, what do you wish it did, what would make you switch?
9. Who decides on software purchases like this, and what does that process look like?
10. (Show Sent on a phone.) What would you use first? What's missing for your next trip?

Record answers in a simple table; look for repeated pains, not compliments.

## Pilot design (smallest credible pilot)

- **Scope:** 1 church, 1 upcoming trip (8–15 participants, 1–2 leaders, 1 administrator), 8–12 weeks before departure through the final report.
- **Setup:** Stripe test mode first, then live in `platform` mode (or the church's own Stripe account via Connect); the church's own waiver and receipt wording, reviewed by them; staging deployment with backups.
- **What's in:** applications/invitations, participant pages, online + check gifts, pledges, requirements (passport copy, waiver, health form, orientation), reminders, expense submissions with approval, budget, live donor summary (optional), final report, CSV export to their bookkeeper.
- **What's out:** integrations beyond CSV, minors (unless guardian consent is built first), multi-campus.

### Measures

| Measure | How | Target to continue |
| --- | --- | --- |
| Staff time per week on trip admin | Baseline interview vs. weekly 2-minute check-in | Clear reduction reported by staff |
| Requirements completed by deadline | Readiness data | ≥ 90% without manual chasing |
| Participants who share their page and receive a gift | Gifts per campaign | ≥ 80% |
| Expense records with receipts and approval | Expense data | 100% approved; ≥ 90% with receipts |
| Reconciliation effort | Ask the bookkeeper after month-end | "Easier than last time" |
| Satisfaction | Short survey: admins, leaders, participants, donors | Most would recommend |
| **Willingness to pay** | Ask for a paid commitment for the next trip at a stated price | A real yes (not "maybe") |

## Pricing (do not build yet)

Hypotheses to test in conversation only: (a) flat per church by trip volume, (b) per active trip like Go Method, (c) free for one trip with paid tiers. Stripe processing fees are paid by the church's own Stripe account; Sent takes no cut today. Don't build billing until at least two churches commit.
