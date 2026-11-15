# Production readiness — Sunday Division

Kept current on the review branch (PR #1). **Nothing has been merged or deployed.** Last full run: all automated checks below, on the latest commit of the branch.

## 1. Checklist

### Verified and working

Covered by automated tests (120, run locally and in CI on GitHub's runners) and checked in a real browser.

* **Public website:** every page; the project intake form, with server-side validation, reference uploads checked by file content, a spam honeypot and rate limits; the contact form.
* **Client portal:**
  * sign-in by portal key, scoped to the client's own projects;
  * quote acceptance with typed name, and decline;
  * invoices with payment buttons;
  * the "Next step" panel;
  * revision requests, reference uploads, and downloads of released files only.
* **Contractor portal:** sign-in by key; only the contractor's own offers and reference files; accept, decline and submit for review.
* **Studio dashboard:**
  * leads → projects; brief, quote and invoice approval;
  * tasks; deliverable review and release with the balance gate;
  * contractors and assignments; the message outbox;
  * Operations controls (pause and resume, budgets, retries);
  * the 22 confirmation prompts.
* **Command (founder):**
  * founder-only on every route;
  * every screen;
  * approvals with code-built previews, digest-bound confirmation, the password again after 12 hours, and press-and-hold or press-twice;
  * Morning Brief citation checks (rules mode);
  * in-app notifications;
  * installable app manifest;
  * service worker covering every Command page.
* **Agents and orchestrator** (rules provider): workflows, the human queue, budgets, escalation. Agents have no tool that sends, approves, pays, releases or changes controls.
* **Payment logic:** webhook signature, timestamp, replay and amount checks; work locked until the deposit is verified; final files held until the balance is paid. This is tested with signed events in Stripe's format, not against Stripe itself.
* **Security baseline:**
  * CSP without inline script or style; HSTS; `nosniff`; frame denial;
  * `no-store` pages; private file downloads (attachment, `no-store`);
  * CSRF tokens plus same-origin checks; HttpOnly SameSite cookies; scrypt passwords;
  * rate-limited sign-ins and forms.
* **Production mode:**
  * installs from the lockfile with 0 known vulnerabilities;
  * boots;
  * refuses simulated payments, simulated messaging, plain-http `BASE_URL` and sample-data seeding;
  * protected pages redirect to sign-in.
* **Accessibility:**
  * axe-core finds 0 WCAG 2.2 A/AA violations across 76 page views;
  * a keyboard walk finds 612 focus stops, all visible, with no traps;
  * text and field-outline contrast is checked by the tests;
  * one `h1` and a skip link per page; targets ≥ 24 px.
* **Responsive layout:** no horizontal scrolling on iPhone 13 or desktop on any product.
* **Cache busting:** content-hashed asset URLs. Verified in a browser: the first load after a change uses the new file, including under the Command service worker.
* **CI:** GitHub Actions runs install, audit, syntax check, the full suite with Chromium, and a production boot on every PR change.

### Working only with mock or simulated data

* **Payments end to end:** the simulated provider (development only) stands in for Stripe Checkout; Stripe's API is never called in tests.
* **Model-backed agents, Command Chat and the AI-written Morning Brief:** tested against mocked Claude and OpenAI responses and the rules provider. No live model call has been made.
* **INDEX V3 / FORM:** the job contract (`docs/INTEGRATIONS.md`) is tested against a mock server. Without credentials both run in manual mode, where a request becomes a task for a designer.
* **Web Push:** payload-free pushes are tested against a local mock push service.
* **Messaging:** "simulated" delivery in development. In production, approved messages are sent by staff.
* **Demo content:** `npm run seed:sample` data is labelled "(sample)" and refused in production. The portfolio shows concept studies, labelled as such.

### Requires production configuration

| Setting | Notes |
|---|---|
| `BASE_URL` (https), `TRUST_PROXY=1` behind the proxy | refused if not https in production |
| `DATA_DIR` on a persistent, encrypted, backed-up volume | SQLite database and uploads; test a restore |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` (or `npm run create-admin`), `FOUNDER_EMAIL` | founder access is server-side only |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, webhook endpoint `/webhooks/stripe` | test keys first, live only at go-live; without them clients see "Contact the studio to pay" |
| `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` + `OPENAI_MODEL` + prices), AI budgets | without a key, agents use the rules provider |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | otherwise generated into `DATA_DIR/vapid.json` |
| `INDEX_V3_API_URL` / `_KEY`, `FORM_API_URL` / `_KEY` | per environment, server-side only |
| `COMPANY_TIMEZONE`, `STUDIO_EMAIL`, optional `NOTIFY_WEBHOOK_URL` | |
| Legal review of the privacy notice and quote terms | drafts in plain language |

### Not yet tested

* Live Stripe Checkout and webhooks, in test mode and then live.
* Live Claude and OpenAI calls, and their real costs against budgets.
* INDEX V3 and FORM V2 against their real APIs. The contract may need changes once their actual APIs and FORM's V2 schema are known.
* Web Push delivered to a real iPhone (Home Screen app, iOS 16.4+).
* **Safari / WebKit and Firefox.** Browser tests run on Chromium only; the founder's iPhone uses Safari.
* Building and running the Docker image; deploying to the chosen host.
* Backup and restore of `DATA_DIR`.
* Screen readers: automated checks only, no manual VoiceOver pass.
* Load and concurrency beyond a single instance.

### Known limitations

* **Email is manual:** staff send approved messages and portal keys themselves. Transactional email is the first thing to add.
* **One staff role:** every admin has full dashboard access, including the two payment overrides below. Founder access (Command) is separate.
* **Passwords only:** no second factor or passkeys yet for staff or the founder.
* **Contractor fees are recorded as costs, not paid** through the system.
* **Single instance:** SQLite, with rate limits held in memory (they reset on restart).
* **Command offline mode** shows an offline page; it does not show cached data, by design.
* **Display font:** Canela is not licensed (Newsreader stands in). There is no studio photography yet.
* **Repository:** Sunday Division still lives in the Game QA repository. See [`REPO-SEPARATION.md`](REPO-SEPARATION.md).

## 2. Security review

Scope: authentication, authorization, private file access, payment gates and approval workflows. This was a review of the code and tests on the branch, not a third-party penetration test.

| Area | Finding | Status |
|---|---|---|
| Authentication | scrypt hashes with constant-time comparison. Sessions are server-side; cookies are HttpOnly, SameSite=Lax, Secure under https, and scoped by path (Command uses its own cookie on `/command`). Sign-ins are rate-limited per IP and per email, and non-founders get the same message as a wrong password. Founder high-impact actions need the password again after 12 hours. Revoking founder access ends live sessions. | OK — tested |
| Authorization | Every `/admin` route requires a staff session and every `/command` route the founder flag, checked on the server. Portal and contractor routes check that the record belongs to the client or contractor (another client's project or file gives 404). | OK — tested |
| Private files | Uploads are checked by magic bytes (JPEG, PNG, WebP, PDF for clients). Downloads are `attachment` (inline only for whitelisted images), `private, no-store`, with `nosniff`, and stored outside the web root. Clients see only their own uploads and released studio files; contractors only reference files for their active assignments; Command only that project's own images. | OK — tested |
| Payment gates | Invoices become paid only through a verified webhook (signature, five-minute timestamp window, exact amount and currency; duplicates and mismatches are flagged, not applied) or a manual payment recorded by staff. Work stays locked until the deposit is verified. Final files are held while a balance is due. Agent claims of payment change nothing. | OK — tested |
| Approval workflows | Agents can only read and draft: no tool sends, approves, pays, releases or changes controls, and hidden instructions in client text are ignored. Quotes, invoices, messages, updates and file releases each need a person. Command actions run only on a code-built preview, confirmed against its digest; the confirm button needs press-and-hold or a second press. | OK — tested |
| CSRF / cross-site | Signed-in POSTs need a session-bound token; all form posts are refused when `Origin` is cross-site. Unauthenticated forms accept requests with no `Origin` header (older clients). | OK; low residual risk |

**Concerns to decide before go-live** (none is an exploitable bug; all are policy):

1. **Staff-level payment overrides — resolved (15 Nov 2026).** Manual payments, payment overrides, final file release, roles, agent permissions and spending limits are now founder-only; sending to clients needs the founder or a studio manager; technical sign-off needs a technical reviewer; closing a project needs the founder or a studio manager. Enforced in the services, audited (`permission.denied` on refusal), tested in `tests/permissions.test.js`. See [SECURITY-POLICY.md](SECURITY-POLICY.md).
2. **No second factor.** Staff and founder accounts are password-only. *Recommendation:* passkeys or TOTP for the founder and staff before real money moves.
3. **Portal keys are bearer secrets sent by staff.** Anyone holding a key sees that client's portal. Keys can be rotated from the dashboard. *Recommendation:* send keys through a channel other than the portal link, and rotate on any doubt.
4. **In-memory rate limits.** These are fine for a single instance. Move them to the database (or a shared store) before running more than one.

## 3. Latest verification run

**14 Nov 2026 — Atelier brand and studio inbox (commit after `0e65e92`).**

| Check | Result |
|---|---|
| `npm test` (local and CI) | 120 / 120 pass, 0 skipped; the studio surfaces test now also covers the inbox (listing, J/K and Enter, filters, an action that returns to the inbox, phone list-then-item) |
| axe-core WCAG 2.2 A/AA + best practice | 26 page views (site, portal, inbox, Command; phone and desktop): 0 violations once entrance fades finish, 0 with reduced motion. Three contrast hits measured mid-fade are animation artefacts, not colours. |
| Text contrast (Atelier light theme) | every pairing ≥ 4.9:1 (computed) |
| Command | layouts unchanged; it now uses the brand faces (Cormorant Garamond, Instrument Sans) through the tokens, so it is no longer pixel-identical to the previous release by design |
| CI (GitHub Actions) | green |

**Earlier run (design-system extension):**

| Check | Result |
|---|---|
| `npm test` (local and CI) | 120 / 120 pass, 0 skipped |
| Command unchanged by the shared-component refactor | 24 / 24 screens pixel-identical (service worker blocked; each version's styles served explicitly; a control run confirms the method detects changes) |
| Syntax (`node --check`) | 100 files, 0 errors |
| `npm ci --omit=dev` + `npm audit` | 0 vulnerabilities (one runtime dependency) |
| Production configuration refusals | simulated payments, simulated messaging, http `BASE_URL`, sample seeding: all refused |
| Production boot | health 200, all public pages 200, 404 page 404, protected pages → sign-in |
| axe-core WCAG 2.2 A/AA | 76 page views, 0 violations |
| Keyboard walk | 612 focus stops, all visibly focused, no traps |
| Field outlines (WCAG 1.4.11) | every visible field on every product ≥ 3:1 (test) |
| Cache busting | first load after a stylesheet change uses the new file, with and without the service worker |
| Secret scan | none in tracked files or in the Sunday Division history |
| CI (GitHub Actions) | green |

## 4. Fixed during review

* Field outlines on the dark themes were 1.3–1.6:1; now ≥ 3.1:1 on every surface, and tested.
* Mixed old and new styling after a deploy: fixed with content-hashed asset URLs, including in the Command service worker.
* The Command service worker didn't cover the overview page (`/command`), the installed app's start page, because its scope was `/command/`. Fixed.
* The dashboard was laid out wider than a phone screen. Fixed.
* The dashboard's field focus style was overridden by a more specific rule, and date fields showed no focus on their calendar button. Fixed.
* Accessibility issues fixed:
  * missing `h1` on the client and contractor portals;
  * a skipped heading level on the services page;
  * empty table header cells;
  * unnamed navigation landmarks;
  * scrolling regions not reachable by keyboard;
  * targets under 24 px.
* CI actions moved to versions that run on the current Node runtime.
