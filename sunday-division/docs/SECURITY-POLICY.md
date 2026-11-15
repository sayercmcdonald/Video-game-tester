# Security policy — who may do what

Approved by the founder on 15 Nov 2026. It is enforced on the server inside the service functions themselves (`src/lib/permissions.js`), so the studio dashboard, the inbox and Command all pass through the same check. Hiding a button is only a courtesy.

## Roles

| Role | How it is granted |
|---|---|
| **Founder** | Only on the server: `FOUNDER_EMAIL` or `npm run founder`. Never from the web. |
| **Studio manager** | By the founder, in Command → Settings → Team and roles. The change is previewed, then confirmed with a recent password, and audited. |
| **Technical reviewer** | Same as studio manager. |
| **Staff** | Any signed-in account. Staff can prepare every kind of draft. |
| **Agents** | No account and no role, so they pass no check below. |

New staff accounts (`npm run create-admin`) start with no special roles. The first account created from `ADMIN_EMAIL` at boot keeps technical-reviewer status, so a founder working alone can sign off technical files.

Roles are re-read from the database on every check. A role that is removed stops working on the person's next request, even within the same signed-in session.

## Actions

| Action | Who | Confirmation | Audit entry |
|---|---|---|---|
| Record a payment made outside checkout | Founder | prompt | `invoice.paid` |
| Payment override: release final files with a balance unpaid, void an **issued** invoice, close a payment exception | Founder | prompt / Command confirm | `deliverable.released (balance override)`, `invoice.voided`, `payment_exception.reviewed` |
| Release **final** files to the client | Founder | prompt / Command confirm | `deliverable.released` |
| Change roles; change agent modes, the model provider, autonomous production; resume automation | Founder | Command preview + password | `user.roles_changed`, `ops.setting_changed` |
| Change agent spending limits | Founder | Command preview + password, or prompt in the studio | `ops.setting_changed` |
| Send a quote, issue an invoice, approve or mark sent a message, publish a client update, release a **preview** file, offer work to a contractor, issue a portal key | Founder or studio manager | prompt / Command confirm | `quote.approved_and_sent`, `invoice.approved`, `message.approved` / `message.sent_manually`, `status_update.published`, `deliverable.released`, `assignment.approved`, `client.portal_key_issued` / `contractor.portal_key_issued` |
| Close a project (commercial completion) | Founder or studio manager | prompt | `project.status` |
| Sign off technical files (flats, tech pack, 3D) | Technical reviewer | prompt / Command confirm | `deliverable.approved` |
| Approve any other file | Any member of staff (a real account) | prompt | `deliverable.approved` |
| Pause all automation | Any member of staff | prompt | `ops.setting_changed` |
| Draft quotes, invoices, messages, updates; void a **draft** invoice | Any member of staff | — | the draft's own entry |

**Refusals.** Every refused attempt is written as `permission.denied`, with the permission and the record involved. The person sees why, for example: "Only the founder can record a payment made outside checkout."

**Agents.** Agents cannot approve their own outputs, override payment gates, change permissions or release final deliverables:
- They have no tools for any of these (enforced by a test).
- They have no account that could pass a check (also tested).
- Their drafts reach a client only after a person with the right role approves them.

Tests: `tests/permissions.test.js` (each rule, over HTTP and at the service), together with the existing workflow, agent-safety and Command tests.
