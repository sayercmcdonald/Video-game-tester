# Design System

_Last updated: 2026-10-27_

Sent is used mostly on phones, so its interface follows Apple's **Human Interface Guidelines** (HIG), adapted for the web. The goal: simple, calm, and familiar to anyone who uses an iPhone, while working equally well on Android and desktop.

We follow Apple's *principles and patterns*. We do **not** copy Apple's branding or assets: icons are our own drawings (Apple's SF Symbols are licensed for Apple platforms only), and the font is each device's own system font (which is San Francisco on Apple devices).

## Principles we apply (from the HIG)

| Apple's guidance | How it shows up here |
| --- | --- |
| Put the most important content in focus; controls float on a separate layer above content. | Content sits in grouped sections. The top bar and phone tab bar use a translucent "glass" material (`.glass`) and float above the page. Glass is never used on content. |
| "Use a tab bar to support navigation, not to provide actions"; single-word labels; don't hide tabs; avoid a "More" tab. | Phones get a floating bottom tab bar with at most five single-word tabs (Home, Trips, Giving, People, Settings for admins; Home, Trips, Profile for members). It's always visible. On wide screens it becomes a sidebar, as the HIG recommends. |
| Grouped lists use headers, footers and space to separate groups. | Cards are rounded white sections on a light gray background (`canvas` → `surface`), with hairline separators between rows and no outlines in light mode. |
| Use a disclosure indicator to drill into detail. | `ListRow` shows a chevron for rows that open another screen (e.g., Settings → Payments). |
| Built-in text styles; Body is 17 pt; avoid light weights. | Apple's type scale: Large Title 34, Title 2 22, Title 3 20, Body/Headline 17, Subhead 15, Footnote 13, Caption 12. Phones use 17 px body text; desktops 15 px for density. Weights: regular, medium, semibold, bold only. |
| Touch targets at least 44×44 pt; space between controls. | Buttons, list rows, menu items, tabs and fields are at least 44 px tall on phones. |
| Use a prominent style for the most likely action; keep prominent buttons to one or two per view; never make a destructive action primary. | Button styles: **primary** (filled tint), **secondary** (tinted), **ghost** (plain text), **danger** (red tint, never primary). Capsule shape. |
| Be judicious with color; reserve it for status and primary actions; don't rely on color alone. | One tint color (teal). Status badges always include a word ("Complete", "Overdue"); charts have legends and table views. |
| Supply light **and** dark variants for every color. | Full dark mode following the device setting, with Apple's black / `#1c1c1e` grouped backgrounds. |
| Contrast: 4.5:1 for text up to 17 pt. | Every text/background token pair was computed to meet WCAG AA in both themes (see below). |
| Respect safe areas. | `viewport-fit=cover`; bars pad themselves with `env(safe-area-inset-*)` so nothing hides under the notch or home indicator. |
| Respect Reduce Motion. | Motion is limited to small press and switch transitions, disabled under `prefers-reduced-motion`. |

## Phone-specific patterns

- **Large titles** at the top of each screen; a back link ("‹ Trips") in the tint color, like iOS navigation.
- **Tables become lists** on phones: the first column is the row title, and other columns become "label … value" lines (`.list-table`, `Td label="…"`).
- **Trip sections** are a horizontally scrolling row of capsules; the selected one scrolls into view.
- **Switches** replace checkboxes (still real checkboxes underneath, so forms and screen readers work).
- **Segmented control** for filters (Donations).
- **Form fields** are filled, borderless, 17 px on phones (iOS Safari zooms into smaller fields).

## Tokens

Defined in `src/app/globals.css`. Light / dark:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#f2f2f7` | `#000000` | Page background (grouped background) |
| `surface` | `#ffffff` | `#1c1c1e` | Sections, cards |
| `fill` | gray 12% | gray 24% | Fields, tracks, pressed states |
| `ink` | `#1d1d1f` | `#f5f5f7` | Primary text |
| `ink-2` | `#48484a` | `#d1d1d6` | Secondary text |
| `ink-3` | `#6e6e73` | `#a1a1a6` | Tertiary text, captions |
| `accent` | `#0a6e67` | `#4fd1c5` | Tint: links, primary buttons, selection |
| `good` / `warn` / `bad` / `info` | `#1f7a37` / `#8a5300` / `#c4161c` / `#0058c7` | `#30d158` / `#ffb340` / `#ff6961` / `#5aa8ff` | Status, always with words |
| `series-1` / `series-2` | `#2a6fd6` / `#c27c0e` | `#4a8af0` / `#c4861c` | Chart marks (received/paid, pledged/committed) |

Contrast checks (WCAG): every text token is ≥ 4.5:1 on its backgrounds in both themes. Chart colors pass the color-vision-deficiency, lightness and 3:1 contrast checks for their theme.

## Components

`src/components/ui.tsx` (Button, Card, PageHeader, Badge, Alert, Stat, Table/Td, ListRow, DescriptionList), `src/components/forms.tsx` (fields, switches, submit buttons), `src/components/nav.tsx` (TabBar, SideNav, section Tabs), `src/components/top-bar.tsx` (GlassHeader, account menu). Build new screens from these rather than styling from scratch.

## Sources

- Apple, *Human Interface Guidelines*: [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- Apple, [Liquid Glass technology overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
