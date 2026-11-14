# Release checks — design system across Studio, portals and website

Run on the review branch before opening the pull request. Nothing has been merged or deployed.

## Results

| Check | How | Result |
|---|---|---|
| Test suite | `npm test` (unit, workflow, agents, Command, and real-browser tests with Playwright + Chromium) | **118 / 118 pass**, 0 skipped |
| Command unchanged by the refactor | the same server HTML rendered with the previous and the new stylesheets, 12 screens × phone and desktop | **24 / 24 pixel-identical** |
| Syntax | `node --check` on every tracked JavaScript file | 96 files, 0 errors |
| Production install | `npm ci --omit=dev` from the lockfile; `npm audit --omit=dev` | installs; **0 vulnerabilities** |
| Production configuration | `NODE_ENV=production` with simulated payments, simulated messaging, a plain-http `BASE_URL`, and `seed:sample` | all **refused** |
| Production boot | `NODE_ENV=production`, https `BASE_URL`, fresh data directory | boots; health check 200; every public page 200; 404 page 404 |
| Security headers | response headers in production mode | CSP (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer- and Permissions-Policy; pages `no-store` |
| Access control | unauthenticated requests to `/admin…`, `/command…`, `/portal/home`, `/contractor/home` | all redirect to sign-in |
| Responsive layout | browser audit of every dashboard, website, portal and Command screen on iPhone 13 and a 1280 px desktop | no horizontal scrolling; one `h1` per page; every field labelled; every control named and ≥ 24 px |
| Accessibility | axe-core 4.10, WCAG 2.0/2.1/2.2 A + AA and best practices, 76 page views (all four products, phone and desktop) | **0 violations** |
| Keyboard | Tab through 14 key pages across all four products: skip link first, focus reaches main content, every stop visibly focused | 613 focus stops, **all visible, no traps** |
| Sensitive actions | Command: one tap / one key press only arms; hold or a second press confirms; interrupted hold changes nothing (tests). Dashboard: 22 confirmation prompts unchanged; dismissing one changes nothing (test) | pass |
| Website and portal | real-browser submissions of `/start` (with validation) and `/contact`; portal sign-in by key, next step, pay button, project scoping | pass; records created; agents pick up inquiries |
| Secrets and private data | pattern scan of tracked files (API keys, Stripe, webhooks, private keys, tokens); tracked `.env`, databases, uploads, VAPID keys | none (only fake placeholders in tests, e.g. `sk_live_x`) |
| Mock-data leakage | fresh production install; sample seeding | no sample data or "simulated" mentions; seeding refused in production; development data labelled "(sample)" / "Simulated" / "Sample data" |
| Backend untouched | diff of `src/routes`, `src/services`, `src/command`, `src/agents`, `src/payments`, `src/http` | **no changes** — this release is views, styles, scripts, fonts, tests and docs |

## Fixed while checking

* Dashboard on phones was laid out wider than the screen (the navigation's width forced a zoomed-out page; it was already 1.4× too wide before this change). Fixed.
* Dashboard text-field focus style was overridden by a more specific rule; date fields showed no focus on their calendar button. Fixed.
* Client and contractor portals had no `h1`; the services page skipped a heading level; empty action-column headers; two unnamed navigation landmarks; scrolling regions not reachable by keyboard; small targets (wordmark, footer links, approval links, disclosure summaries, checkbox labels, "Discard"). Fixed.

## Outstanding issues

None of these block review. Items marked **before go-live** are production blockers.

1. **Before go-live — configuration and services that cannot be verified here** (unchanged from the previous release, see [`DEPLOYMENT.md`](DEPLOYMENT.md)): Stripe live keys and webhook (without them clients see "Contact the studio to pay"), an https `BASE_URL` behind a proxy with `TRUST_PROXY=1`, `FOUNDER_EMAIL` and admin credentials, VAPID keys in the secret store, backed-up storage for `DATA_DIR` with a tested restore, lawyer review of the privacy notice and quote terms. Live Stripe, Claude/OpenAI, Web Push delivery to a phone and the Docker image build were not run in this environment.
2. **Before go-live — email is manual.** Approved messages wait in the outbox for staff to send.
3. **At deploy — static CSS is cached for an hour without versioned URLs.** Visitors who loaded the old site within the hour before the deploy may see a mix of old and new styles (and fallback fonts) until their cache expires. Deploy at a quiet time, or add a content hash to asset URLs (a small change; the Command service worker would then need `ignoreSearch` when matching its cache).
4. **Accessibility — subtle input borders on the dark themes.** Field borders are about 1.6:1 against the page (WCAG 1.4.11 asks 3:1 for component boundaries). Fields are labelled and their focus state is strong; raising `--sd-line-strong` would fix it but visibly changes the approved Command look, so it is left for a design decision.
5. **Design — Canela is not licensed.** Newsreader Display stands in; add a licensed Canela web font as "SD Display" when held.
6. **Design — no studio photography.** The site uses the studio's technical flats and Command a rendered fabric texture; both take real photography when available.
