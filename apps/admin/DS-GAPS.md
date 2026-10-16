# DS gaps found while building the admin demo

Building a real back office (the react-admin e-commerce demo, migrated from MUI) on Bridge surfaced what the
design system does not cover yet. Rule followed in `apps/admin`: no hacks in app CSS. Each gap below lists
what the app needed, what it used instead, and a proposal for the DS. Ordered by impact.

The adoption audit (`bridge audit apps/admin/src`, Adoption page in the docs) counts these gaps as non-DS UI:
row and card links built on ra-core `LinkBase`, product images (`img`), the skip link and the recharts revenue
chart. That is why component adoption is 90%, not 100%: closing the Image, ListItem and Chart gaps closes it.

## Components

| Need | Used instead | Proposal |
| --- | --- | --- |
| **DataTable** (columns, server sort, row selection, bulk bar, loading rows, empty row, row link) | `Table` parts + `Checkbox` + app adapter `ra-bridge/DataTable.tsx` | A `DataTable` pattern on top of `Table`: column model, selection model with indeterminate header, bulk action bar slot, skeleton rows, empty slot, responsive "list on phones" mode. Most of the admin's logic lives here today. |
| **Bulk action bar** | App-composed bar with selection fill (`--color-surface-selected`) | Part of DataTable, or a `SelectionBar` component with count, actions and "Clear selection". |
| **PageHeader** (breadcrumb, title, subtitle, media, actions) | `ra-bridge/Page.tsx`, composed with type tokens | `PageHeader` component; every screen of a back office needs it. |
| **Heading / Text** primitives | Raw `h1`/`h2`/`p` styled with `--font-size-*` in app CSS | `Heading` (levels mapped to the type scale) and `Text` (`muted`, `size`, `tabular`). |
| **Stat / KPI tile** (label, value, delta, icon) | `Card` + `Badge` for the delta (`ui/StatCard`) | `Stat` component with a delta that carries an arrow and text, not color alone. |
| **DescriptionList** (label/value pairs) | `dl` styled in app CSS (`ui/Properties`) | `DescriptionList` with stacked and inline layouts, numeric alignment. |
| **Rating** (read-only stars, later an input) | Lucide `Star` through `Icon` with `fill` | `Rating` display and `RatingInput` (radio group under the hood). |
| **Filter bar / Toolbar** | App flex row (`FilterBar`) | `Toolbar` layout with wrap rules, plus a "filter chip" pattern for active filters. |
| **DateField / DateRangePicker** | `Input type="date"`: the native placeholder follows the OS locale (shows `jj/mm/aaaa` on a French OS while the UI is English) and cannot be styled | Base UI based `DateField` and a range variant, locale-aware. |
| **Thumbnail / Image** (fixed ratio, rounded, fallback) | `img` with app CSS | `Image` with ratio, radius role and a fallback state. |
| **ListRow / item link** (avatar, two lines, end value, hover) | App CSS rows in dashboard, aside cards and phone lists | `ListItem` (interactive and static) inside a `List`, matching `menu.item` and table row tokens. |
| **AppShell / Header** layout | App grid: sticky header, sticky sidebar, drawer under 1024px | An `AppShell` layout (sidebar, header, content, mobile drawer) next to `SidebarNav`. |
| **SegmentedControl** | `Tabs variant="contained"` for Grid / List | Fine as is; document it as the segmented pattern. |
| **Destructive ghost button** | `Button variant="secondary"` with a trash icon | A quiet destructive style (`danger` tone on ghost or secondary). |

## Component API

- **Built-in English strings**: `Pagination` ("Previous", "Next", "Page 3 of 12", "Page n"), `Combobox`
  (chip "Remove x", "Selected options"), `Select` default placeholder, `Toast` "Dismiss notification" cannot
  be translated. The French UI shows these in English. Proposal: a `labels` prop or an i18n provider.
- **Combobox has no `suffix`** (Input has one): no room for a `Ctrl K` hint in the global search.
- **Checkbox requires a visible `label`**: row selection needs `label={<VisuallyHidden>...}`. A `hideLabel`
  prop (like Field) would be cleaner.
- **Card has no `title`/`subtitle` slots**: `CardHeader` sets a 20px title; a second muted line (hint, period)
  had to be composed.
- **Link inherits the surrounding font size**: inside `CardHeader` the "See all" link became 20px. A `size`
  prop on `Link` would help.
- **Tabs count and long lists on phones**: a tab list wider than the screen gets clipped; no scroll buttons
  or fade hint.

## Tokens

- **Data visualization tokens are missing**: no categorical series colors, no area fill, grid line or axis
  text roles. The revenue chart uses `--color-action-primary-bg` for the series, `--color-border-subtle` for
  the grid and `--color-text-muted` for axis text. Proposal: `color.chart.series.1..6`, `color.chart.grid`,
  `color.chart.axis`, plus `color.chart.area` with an alpha.
- **Size scale gap between 80 and 240** (`--size-20` then `--size-60`): a 160px control width (per-page
  select, shop switcher) is written `calc(var(--size-20) * 2)`.
- **No layout width tokens for app shells**: sidebar width and content max width reuse `--size-60` and
  `--size-300`. Proposal: `layout.sidebar.width`, `layout.content.max-width`.
- **Recharts needs numbers** (stroke width, dot radius, margins) in JS: no token export for those in
  `tokens.ts` today beyond raw values.

## Behavior

- **Toast and undo**: ra-core can run mutations in undoable mode (toast with Undo). The Bridge `Toast`
  supports an action, but there is no documented "undoable" pattern (timeout bound to commit). The admin
  uses pessimistic saves instead.

## Found while dogfooding the Bridge docs app

The Bridge docs app (`apps/docs-site`) now renders its own controls with `@bridge-ds/react`. Most of it is static
Astro HTML driven by small vanilla scripts, with a few React islands. That setup surfaced gaps the admin did not.

### Closed on this branch

- **Data visualization tokens**: `color.chart.series.1..6`, `color.chart.grid`, `color.chart.axis` and
  `color.chart.track`. Still open from the admin list: `color.chart.area` (a fill with alpha).
- **Layout tokens for app shells**: `layout.sidebar.width`, `layout.header.height`, `layout.content.max-width`.
- **Size scale gap**: `size.40` (160px) fills the step between `size.20` and `size.60`.
- **SegmentedControl**: new component (Forms). Base UI RadioGroup with native button radios, an `items` array
  so it renders from Astro, and a static contract (`data-segmented-control`, `data-segment`, `data-value`,
  `aria-checked`) a script can drive. Replaces the role=radiogroup button rows in the top bar, the theme
  playground, the props playground and the Copy as picker.
- **PageHeader**: new component (Layout). Title, lead, meta and actions, which wrap under the text on narrow
  screens. Used by every Library page. Breadcrumb and media slots from the admin proposal are not in it yet.

### Still open

| Need | Used instead | Proposal |
| --- | --- | --- |
| **Static mode for interactive parts** (Tabs, Accordion, Popover, Menu, Switch, Slider) | Native `details`, hash-link tabs and vanilla scripts; React islands for the two top bar menus | A documented static contract like SegmentedControl's: HTML that works without hydration (`details` for Accordion, hash links for Tabs) plus data attributes a script can drive. |
| **IconButton as a link** | `Button` ghost with `iconStart` and `aria-label` inside `render={<a />}`: not square | A `render` prop on `IconButton`, like `Button`. |
| **Stat / KPI tile** | App markup (`.stat-strip` on Agents, `.ov-kpi` in the Studio overview) | Same proposal as the admin: label, value, delta with an arrow and text. Only two surfaces in the docs app so far, so not built yet. |
| **Menu item as a link** | `Popover` with a list and a `Link` (version menu) | `MenuItem` with `href` or `render`, for navigation menus. |
| **Tag as a link** | App token chips (`.tchip`) | `Tag` with `href` for clickable labels. |
| **Copyable value** (token name or hex, click to copy, with feedback) | App buttons with `data-copy` | A `CopyButton` or `Copyable` with the copied state and live announcement built in. |
| **Search trigger** (field look, opens a command palette, shows a shortcut) | `Button` secondary with `Kbd` inside | A `SearchTrigger`, or a `Kbd` slot on `Button`. |
| **Command palette** | Native `dialog` with a vanilla listbox | A `CommandPalette` on Base UI Dialog and Combobox. |
| **Inverse-surface button** (terminal bars) | `Button` secondary | An inverse appearance for actions on `color.surface.inverse`. |
| **Brand tone on Badge** | `Badge` neutral plus icon | A `brand` (accent) tone. |
| **Stacked Table on phones** | `Table` scrolls sideways | A stacked layout option on `Table`. |
| **Radio cards** (visual option picks) | App radio cards in the theme playground | A `RadioCard` option for `RadioGroup`. |
| **Field label in mono** (prop names in the props playground) | Sans labels | A `mono` option on Field labels, for code names. |
| **Charts** (donut, stacked bars, waffle) | App SVG with the new chart tokens | Chart primitives once the token set includes `color.chart.area`. |

### Notes for app authors

- Astro wraps the children of a React component in `astro-static-slot`. Inside a `table` the parser moves it out,
  so compose DS `Table` parts in one `.tsx` component, never across `.astro` markup.
- Pass `className`, not `class`, to DS components from Astro.
- Global element rules in app CSS (`kbd`, `table`, `th`, `td`) restyle DS components. Scope them to app classes.
