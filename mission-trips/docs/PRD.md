# Product Requirements — Mission Trips

_Last updated: 2026-10-26_

## Problem

Churches run mission trips with spreadsheets, email threads, group chats, paper waivers and a separate donation tool. As a result:

- Participants lose track of fundraising goals, forms, deadlines and travel details.
- Church administrators have no single view of money raised, money spent, and who is ready to travel.
- Donors rarely learn how their gifts were actually used.
- Leaders struggle to communicate with the team and to know who still owes what.

## Goal

One place where a church can run every trip from first interest meeting to final financial report — with each person seeing what they need and nothing they shouldn't.

**Success for a pilot:** one church runs at least one real trip through the platform: every participant approved in-app, every required document collected in-app, real gifts processed through Stripe, expenses recorded with receipts, and a final report published to donors — with no data exposed across roles or churches.

## Users and what they can do

| Role | Who | Can |
| --- | --- | --- |
| **Platform administrator** | The team operating the service | Approve, suspend and reinstate churches; monitor payment-event and email health. **Cannot** read churches' private records through the platform UI. |
| **Church administrator** | Missions pastor, church office | Everything in their church: trips, people, roles, all finances, refunds, offline gifts, donor reports, private profiles, activity log. |
| **Trip leader** | Assigned per trip by an admin | Manage their trip: approve applicants, invite participants, requirements and reviews, itinerary, announcements, shared documents; see private profiles of their team; see trip finances and record expenses **if the church allows** (on by default). Public donor updates need admin approval. |
| **Participant** | Approved team member | Personal dashboard: their fundraising page and supporters, pledges, requirements checklist (upload, sign, answer, mark done), itinerary, team updates, their own private profile. |
| **Applicant / waitlisted** | Applied but not approved | See the trip and their application status only. |
| **Donor** | Anyone; account optional | Give through a public page and Stripe Checkout; receive an emailed receipt; with a verified account, see giving history, receipts, campaign progress and public updates. |

Church data is isolated: no user can reach another church's records by changing a URL or request.

## Functional requirements (MVP)

**Trips** — create multiple trips with destination, dates, summary, budget, team fundraising goal, default per-participant goal, participant limit; statuses Draft → Open → Underway → Completed (or Cancelled); itinerary; shared documents.

**Team** — invitations by email (single-use, expiring, bound to the invited address); open applications with approve / waitlist / decline; participant limit enforced; leaders assigned by admins.

**Fundraising** — one team fund per trip, one support page per approved participant, optional project campaigns. Goals, amount received, remaining. Pledges tracked separately and never counted as received. Online gifts via Stripe Checkout only; received only on Stripe's signed confirmation. Check/cash gifts recorded by admins and clearly marked. Refunds (admin only), disputes, failed and abandoned payments handled. Sequential receipt numbers per church; receipts by email link, donor account, or admin.

**Financial transparency** — append-only ledger of every money movement; gross gifts, fees, refunds, disputes, expenses, available balance and balance after commitments; restricted vs unrestricted; budget by category vs committed vs paid; expense receipts; donor reports published as reviewed snapshots containing totals only.

**Requirements** — upload, signed waiver (typed full-name signature with timestamp), configurable questions, and tasks; optional leader review; due dates; readiness matrix; automatic deadline reminders at 7 days, 2 days and due date.

**Communication** — team announcements; donor-facing updates (leader posts require admin approval); in-app notifications; email with per-category opt-out (account/receipt emails always sent).

**Privacy** — emergency contacts and medical details visible only to the person, their trip leaders and church admins; medical details encrypted at rest; every view of someone else's profile or private file is logged.

## Explicit non-goals for the MVP

- Recurring gifts, text-to-give, donor-covers-fees, peer-to-peer team challenges.
- Accounting-system export (QuickBooks), payouts management (handled in each church's Stripe dashboard).
- Travel booking, group flights, visa processing.
- Native mobile apps (the web app is responsive).
- Photo galleries / media hosting.

## Policy constraints

- The platform **never** states that a gift is tax-deductible. Receipts show only the church's own statement, entered in Settings.
- Restriction wording ("designated for this trip") is set per campaign by the church and must match the church's real policy.
- No payment success is ever shown or recorded without confirmation from Stripe.

## Open questions for the product owner

See "Decisions needed" in [RISKS.md](RISKS.md): Stripe Connect vs. single account, minors and guardian consent, waiver legal review, hosting choice, and moving the project to its own repository.
