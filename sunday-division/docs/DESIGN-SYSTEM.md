# Sunday Division design system

Reference: the approved Sunday Division Command concept (dark editorial, serif display type, bone accents, sage for operating states), and — from 14 Nov 2026 — the approved **Atelier** brand direction (limestone and paper, Cormorant Garamond and Instrument Sans, ink and moss) with **Precision's** three-pane inbox for the studio. The directions are on the design canvas.

**Status:** one design system across all four products. Each keeps its own job:

| Product | Theme | Purpose | Stylesheets |
|---|---|---|---|
| **Command** (`/command`) | dark | the founder's premium, mobile-first command centre | `tokens.css` → `ui.css` → `command.css` |
| **Studio dashboard** (`/admin`) | dark | productivity: the inbox (rail · list · detail), dense tables, project and operational visibility | `tokens.css` → `ui.css` → `studio.css` |
| **Client portal** (`/portal`) and contractor portal (`/contractor`) | light | premium and very simple: the next step first, then one card per subject | `tokens.css` → `ui.css` → `site.css` |
| **Public website** | light (Atelier), with moss and ink moments | editorial and fashion-forward; explains the services and converts visitors | `tokens.css` → `ui.css` → `site.css` |

Screenshots: [`docs/screenshots/`](screenshots/).

## 1. What exists (inspection)

| | Today |
|---|---|
| Rendering | Server-rendered HTML from template-literal view functions (`src/views/*.js`); escape-by-default `html```; no client framework, no build step |
| Styles | One token file and one shared component file; one product stylesheet each for Command, the studio and the site/portals |
| Script | Small progressive-enhancement files per area (`public/js/*.js`); every screen works without JavaScript |
| Fonts | Self-hosted, SIL OFL: Cormorant Garamond (display, lining figures by default), Instrument Sans (interface), IBM Plex Mono (codes and measurements) |
| Constraints | Strict CSP (no inline scripts or style attributes), `no-store` pages, the Command service worker caches static assets only |

## 2. Architecture

```
public/css/tokens.css     design tokens: palette, semantic colour (dark default + .theme-light),
        │                 type, space, shape, touch, motion; @font-face for SD Display / SD Sans / SD Mono
public/css/ui.css         shared components (ui-*), coloured only through semantic tokens, no base rules
        │                 header · section · card · stat · sparkline · list/row · dot · pill · progress ·
        │                 tabs · empty state · buttons · flash · forms · table · utilities
        ├── public/css/command.css   Command: base, app bar, tab bar / rail, Command-only blocks, motion
        ├── public/css/studio.css    Studio: base, rail + workspace, cards, figures, tables, forms, records
        └── public/css/site.css      Website + portals: editorial layout; the site's own variable names
                                     are aliases for tokens (--ink: var(--sd-obsidian), …)

src/views/command-ui.js   components as server-side functions (Icon, StatusPill, StatCard, …)
src/views/studio-ui.js    the studio's status → tone rule and the "Simulated" label, on StatusPill
src/views/*.js            screens composed from components (data in, HTML out)
```

Moving the shared components out of `command.css` changed nothing in Command: 24 Command screens rendered with the old and the new stylesheets are pixel-identical at phone and desktop sizes.

Rules the components enforce:

* **No invented values.** `StatCard` shows a delta only when one is passed; `Sparkline` renders nothing for an empty or flat series; `Thumb` shows the client's own reference image or the studio's labelled drawing. The portal's "Next step" is read from the client's records (an open quote, an unpaid invoice, released files) and is absent when there is nothing to do.
* **Sage means something.** Only operating or finished states are sage (`success`). A decision waiting for a person is bone on dark and ink on light (`review`). Attention is amber, failures clay, both sparingly. The same rule drives Command, the dashboard (`studio-ui.js`) and the portals.
* **Development data is always labelled.** Sample records carry "(sample)"; simulated deliveries carry an amber "Simulated" pill; Command shows "Sample data". Sample data and simulated providers are refused in production.
* **Touch and pointer targets.** Primary controls are at least 44 px in Command and on the site; dense dashboard controls are at least 24 px (WCAG 2.5.8), 36–40 px in practice.
* **Accessible by construction.** Icons are `aria-hidden` and paired with a label; every page has one `h1`, a skip link and named landmarks; focus is always visible.

## 3. Tokens

| Token | Value | Use |
|---|---|---|
| `--sd-obsidian` | `#111111` | dark background · ink on light |
| `--sd-charcoal` | `#191919` | elevated surfaces (cards) |
| `--sd-graphite` | `#252525` | secondary surfaces |
| `--sd-bone` | `#E8E0D4` | primary accent on dark · alternate section on light |
| `--sd-warm-white` | `#F4EFE7` | text on dark · the page on light |
| `--sd-sage` | `#71977B` | operating / success (dark) |
| `--sd-mist` / `--sd-stone` | `#B3AB9F` / `#8F887D` | secondary (8.3:1) / tertiary (5.4:1) text on dark |
| `--sd-field` | `#757067` | form-field outlines on dark (≥ 3.1:1 on every dark surface) |
| `--sd-limestone` | `#EEEAE3` | the page on light (Atelier) |
| `--sd-paper` / `--sd-sand` | `#F7F5F1` / `#E4DED4` | raised surfaces / alternate sections on light |
| `--sd-ink` | `#1C1A17` | text and primary actions on light (14.5:1) |
| `--sd-moss` | `#3F4B33` | the brand colour: deep sections, one accent (7.7:1 on limestone) |
| `--sd-oat` | `#C9C0B2` | secondary text on moss (5.2:1) and ink (9.7:1) |
| `--sd-umber` / `--sd-taupe` | `#5B544A` / `#625C54` | secondary (6.2:1) / tertiary (5.5:1) text on limestone |
| `--sd-sage-deep`, `--sd-amber-deep`, `--sd-clay-deep` | `#476A52`, `#7A5A22`, `#8C3A2B` | status text on light (≥ 5.3:1) |

Products use the semantic tokens (`--color-bg`, `--color-surface`, `--color-text-2`, `--color-accent`, `--color-success`, …). `class="theme-light"` on `<html>` swaps them for the light set, so a `ui-pill` or `ui-btn` is correct on either theme.

Type: **display** — Cormorant Garamond (SIL OFL), 300/400/500 upright and 300/400 italic, with its lining figures mapped as the default digits so codes and prices never fall into old-style figures; the display scale runs about an eighth larger than a book serif would, because Cormorant's x-height is small. **Interface** — Instrument Sans. **Data** — IBM Plex Mono for codes, measurements and transcripts only. Scales: `--text-display-*`, `--text-figure-*`, `--text-title/body/callout/label/footnote/caption/overline`. Space: 4-point grid. Radii: 8 / 14 / 20 / 28 / pill on dark; 2 px everywhere on light (Atelier is square-shouldered). Motion: 140 / 240 / 420 ms, ease-out; off with reduced motion.

## 4. Command

Five destinations in the bottom tab bar: **Overview · Projects · Agents · Approvals · Command**. Morning Brief, Performance, Notifications and Settings are reached from Overview (and the bell); on wide screens a side rail lists every section.

High-impact confirmations use **press and hold** (1.2 s, with a visible fill; sliding off or releasing early cancels). Any other activation — a tap, the keyboard, a screen reader — **arms** the button ("Press again to confirm") and a second activation within six seconds confirms. A single accidental tap never confirms. Server rules are unchanged: code-built preview, digest-bound confirmation and, after 12 hours, the password.

## 5. Studio dashboard

* Dark, on the same tokens and components as Command; denser: 14 px interface text, 40 px fields, wide tables with tabular figures.
* **Inbox** (`/admin/inbox`, first in the rail): Precision's pattern — rail, list, detail. One list of everything waiting on the studio, read from the same tables as Approvals and Operations: decisions, inquiries, agent hand-offs and failed agent jobs, INDEX V3 / FORM production jobs, and (separately) what is waiting on the client. Rows are ordered failed → needs a look → waiting on you → for information, newest first. <kbd>J</kbd>/<kbd>K</kbd> move, <kbd>Enter</kbd> opens. The detail pane acts through the existing routes with their existing confirmations (issue an invoice, approve a reviewed file, mark an inquiry as reviewing, close a hand-off) and returns to the inbox; anything with fields — quotes, releases, contractor approvals, messages — links to the page where it is decided. On phones the list and the item are two steps with a way back.
* A persistent rail with icons (Inbox, Overview, Leads, Projects, Approvals, Messages, Operations, Invoices, Contractors); on phones it becomes a top bar with a scrolling section list, and sign-out stays reachable.
* Status pills follow the shared colour rule; AI drafts are a dashed pill; simulated deliveries an amber "Simulated" pill.
* Buttons are the shared `ui-btn` (primary in bone for the main action of a form). Every approval-gated action keeps its confirmation prompt (22 prompts, unchanged).
* Wide tables scroll inside their card; a scrolling region becomes keyboard-focusable and is named after its card.

## 6. Client portal

* One page. The client's name is the heading; with several projects, a "Your projects" list jumps to each.
* Each project opens with its status pill and a single **Next step** in ink — review the quote, pay invoice SD-INV-…, review released files — with a button to the right card.
* Quote, invoices, updates, files from the studio, brief and reference files each sit in their own paper card. Paid invoices and accepted quotes are sage; anything waiting on the client is ink.
* Payments still go through the payment provider's hosted page; access is still the client's portal key; a client still sees only their own projects.

## 7. Public website

* Atelier: Cormorant Garamond, light weight, with italic accents; Instrument Sans for reading and for sentence-case buttons; sentence-case form labels (easier to read and complete than small capitals).
* Limestone page and a light hero with the flat on a paper card; sand sections; moss for the process section; ink for the footer and the portal's next step. The technical flats remain the imagery: they are the studio's own work and show what it sells.
* Conversion paths unchanged: "Start a Project" in the header, hero, packages and closing section; the intake form keeps its validation, spam honeypot and rate limits.

## 8. Imagery

The Command hero is an original rendered fabric texture (`public/command/hero-drape.jpg`, no licence restrictions). Project thumbnails use the client's own reference images (≥ 64 px), served to the founder only and never cached; otherwise the studio's flat drawing for the category. The website uses the studio's technical flats. Replace either with the studio's own photography when available.

## 9. Known limitations

See [`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md) for the full checklist. Design-specific: there is no studio photography yet.

## 10. Field outlines and asset caching

* **Field outlines.** Text fields, selects and text areas use `--color-field-border` — `--sd-field` `#757067` on the dark themes (3.8:1 on obsidian, 3.6:1 on charcoal, 3.1:1 on graphite) and taupe on light (≥ 5:1) — so every field boundary meets WCAG 1.4.11. Buttons and pills keep the quieter `--sd-line-strong` hairline: their text identifies them. The browser tests check every visible field on every product.
* **Versioned assets.** Pages link `/assets/<file>?v=<content hash>` (`src/lib/assets.js`). The current hash is served `immutable` for a year; any other version is revalidated. The Command service worker receives the same versioned list and a cache name derived from it, so a deploy that changes a file installs a fresh cache. Fonts are referenced by the stylesheets under their plain names and keep a one-hour cache; a changed font ships under a new file name.
