# Sunday Division design system

Reference: the approved Sunday Division Command concept (dark editorial, serif display type, bone accents, sage for operating states). Status: **every Command screen is built from the components** — Overview, Projects, project detail, Agent Studio and task logs, Approvals and the review screen, Command, Morning Brief, Performance, Notifications, Settings, sign-in, offline and error pages. The studio dashboard and public site keep their current look.

## 1. What exists (inspection)

| | Today |
|---|---|
| Rendering | Server-rendered HTML from template-literal view functions (`src/views/*.js`); escape-by-default `html```; no client framework, no build step |
| Styles | `site.css` (public site), `admin.css` (studio dashboard), `command.css` (founder app) — each had its own variables |
| Script | Small progressive-enhancement files per area (`public/js/*.js`); every screen works without JavaScript |
| Fonts | Self-hosted, SIL OFL (Instrument Serif, Hanken Grotesk, IBM Plex Mono) |
| Constraints | Strict CSP (no inline scripts or style attributes), `no-store` founder pages, service worker caches static assets only |

The design system keeps that architecture: tokens in CSS custom properties, components as server-side view functions with matching CSS blocks. No framework and no new runtime dependency.

## 2. Architecture

```
public/css/tokens.css        design tokens (colour, type, space, shape, touch, motion) + @font-face
        │
public/css/command.css       1 base · 2 layout (app bar, tab bar, rail) · 3 components (ui-*) · 5 motion
        │
src/views/command-ui.js      components: one function per component, one CSS block per component
        │                    Icon · StatusDot · StatusPill · ProgressBar · PageHeader · Hero · Section · Card ·
        │                    StatCard · Sparkline · List / ListRow · SegmentedTabs · Thumb · EmptyState ·
        │                    Button · IconButton · Avatar
        │                    (+ CSS-only blocks: forms, flash, gallery, stages, approvals, review/hold,
        │                     key-value, timeline, log, bars, table)
src/views/command.js         screens composed from components (data in, HTML out)
        │
src/command/metrics.js       the data the screens show — read from the records, never estimated
```

Rules the components enforce:

* **No invented values.** `StatCard` shows a delta only when one is passed; the Overview passes one only when the previous period has data. `Sparkline` renders nothing for an empty or flat series. `Thumb` shows the client's own reference image, or the studio's technical-flat drawing for the garment category (labelled as a drawing), never a stock photo of someone else's product.
* **Sage means something.** Only operating / completed states use sage (`success`). A decision waiting for the founder is bone (`review`). Attention and problems use amber and clay sparingly.
* **Touch.** Primary controls are at least 44 px; list rows 52 px; tab bar 52 px items above the home indicator (safe-area insets throughout).
* **Accessible by construction.** Icons are `aria-hidden` and always paired with a label; status dots carry a text label where they convey meaning; progress uses `<progress>`; contrast is checked by the mobile test.

## 3. Tokens

| Token | Value | Use |
|---|---|---|
| `--sd-obsidian` | `#111111` | primary background |
| `--sd-charcoal` | `#191919` | elevated surfaces (cards) |
| `--sd-graphite` | `#252525` | secondary surfaces (icon tiles, bubbles, tracks) |
| `--sd-bone` | `#E8E0D4` | primary accent (primary buttons, progress, "your decision") |
| `--sd-warm-white` | `#F4EFE7` | text and controls (16.5:1 on obsidian) |
| `--sd-sage` | `#71977B` | operating / success states (5.8:1 on obsidian) |
| `--sd-mist` / `--sd-stone` | `#B3AB9F` / `#8F887D` | secondary (8.3:1) / tertiary (5.4:1) text |

Type: **display** — Newsreader Display (SIL OFL), instanced at its display optical size, standing in for Canela (commercial; drop in a licensed web font as "SD Display" when held). **Interface** — Inter (SIL OFL). Scales: `--text-display-xl/l/m/s`, `--text-figure-l/m`, `--text-title/body/callout/label/footnote/caption/overline`. Space: 4-point grid (`--space-1` … `--space-9`). Radii: 8 / 14 / 20 / 28 / pill. Motion: 140 / 240 / 420 ms, ease-out; cross-document view transitions, disabled with reduced motion.

## 4. Navigation

Five destinations in the bottom tab bar: **Overview · Projects · Agents · Approvals · Command**. Morning Brief, Performance, Notifications and Settings are reached from Overview (and the bell); on wide screens a side rail lists every section.

## 5. Critical actions (approval review)

Spending, external communications, permission changes and deliverable release require a code-built preview, a digest-bound confirmation and, after 12 hours, the password (unchanged server rules). The review screen puts the consequences first ("When you confirm"), then the details, then the confirm zone at the bottom, separated from the content.

High-impact confirmations use **press and hold** (1.2 s, with a visible fill; sliding off or releasing early cancels). Because press-and-hold is not reliable with screen readers and keyboards, any other activation **arms** the button ("Press again to confirm") and a second activation within six seconds confirms. A single accidental tap never confirms. Without JavaScript the button is an ordinary submit — the server-side checks still apply. Tested in a real browser at phone and desktop sizes.

## 6. Imagery

The Overview hero is an original rendered fabric texture (`public/command/hero-drape.jpg`, no licence restrictions). Project thumbnails use the client's own reference images when they are real pictures (≥ 64 px), served to the founder only and never cached; otherwise the studio's flat drawing for the category. Replace the hero with the studio's own photography when available — the component takes any image.

## 7. Project detail

* **Gallery**: the client's own reference images (swipe, scroll-snap), served only to the founder and only for that project; otherwise the studio drawing for the category, labelled as such.
* **Development progress**: stages decided by records — Brief & scope (quote accepted), Deposit (verified payment), one stage per kind of work the client bought (all its tasks done), Review & sign-off (every deliverable signed off, no open revisions), Final delivery (finals released and paid).

## 8. Optional next step

Apply `tokens.css` to the studio dashboard and the public site; both keep their current look until you decide.
