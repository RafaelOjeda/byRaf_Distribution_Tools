# Frontend / Dashboard

> [Documentation Index](../index.md) · Up: [Architecture Overview](./architecture.md) · Related: [Gateway Contract](./gateway-contract.md) · [Engine](./engine.md)

## Overview

The entire product surface is one Next.js App Router route: `app/(dashboard)/dashboard/`. It is a three-step wizard (connect → pick periods → view data) that becomes, once data is loaded, a tabbed dashboard with five report views plus inline cost/inventory editing. Styling is a hand-rolled "classic Mac OS (System 1) black-and-white" theme built with Tailwind CSS 4 `@apply` utilities (see `app/globals.css`, not detailed further here — purely presentational).

**The dashboard is marketplace-neutral by construction.** No file under `app/` imports a connector or `engine/*` directly, and no file names a marketplace — both facts are mechanically enforced (see [Configuration & Security](./configuration-and-security.md#the-gateway-import-boundary)). Every label, field, and figure the UI shows comes from the gateway's `SourceDescriptor`/`Report` data, not from hard-coded copy.

## Responsibilities

- Render the credential form, settlement-period picker, summary tiles, and six report tabs.
- Hold every piece of user-entered state: pasted credentials, the fetched `Snapshot`, typed costs/box cost/aliases, the active tab, the source filter.
- Call the two gateway server actions (`listPeriods`, `fetchSnapshot`) and the one pure function (`buildReport`) — nothing else reaches outside `app/`.
- Provide CSV download buttons (client-side `Blob` + anchor download, nothing round-trips to a server).
- Provide PWA install behavior (`InstallPrompt`) and mobile-first responsive layouts (card lists below `md`, tables above).

## Directory map

```
app/(dashboard)/dashboard/
  page.tsx                 server component: describeSources() -> <DashboardClient sources=.../>
  DashboardClient.tsx       client component: all wizard/report state (the file most edits touch)
  PriceChart.tsx            hand-built SVG line chart, no chart library
  InstallPrompt.tsx         PWA "Add to Home Screen" banner
  types.ts                  Step, Tab, SkuField, LotDraft, BOX_FIELDS
  hooks/
    useTabNavigation.ts      active tab state + ARIA arrow-key navigation + scroll-into-view
  utils/
    format.ts                 money(), downloadCsv()
    shipping.ts                shipPctClass() — amber/red threshold styling
  components/
    KpiTile, PanelHeader, Fig, ImportPreviewCard  (components/shared/)
    CostLotsEditor, InventoryCard, OrderLineCard,
    SkuSummaryTable, StockValueTable,
    MarketplaceFeesTable, TotalsRow/TotalsCard      (per-domain table/card components)
    tabs/
      SkuTab, OrdersTab, PriceTab,
      InventoryTab, StockTab, FeesTab                (one component per dashboard tab)
```

This structure is the result of a refactor ("Modularize the dashboard: extract components, hooks, and utils from DashboardClient" — see repo history) that pulled tab bodies and reusable table/card pieces out of what was previously one large file; `DashboardClient.tsx` now owns state and wiring, `components/tabs/*` own each tab's layout, and `components/*`/`components/shared/*` own the reusable display pieces.

## Component tree

```mermaid
flowchart TD
    Page["page.tsx (server)"] --> DC["DashboardClient (client)"]
    DC --> Install["InstallPrompt"]
    DC --> KpiTiles["KpiTile × 5\n(Revenue, Units, Net, Profit, Stock value)"]
    DC --> TabBar["role=tablist\n(useTabNavigation)"]
    DC --> SkuTabC["SkuTab"] --> SkuTable["SkuSummaryTable"]
    DC --> OrdersTabC["OrdersTab"] --> OrderCards["OrderLineCard (phone)\n+ table (md+)"] & Totals["TotalsCard / TotalsRow"]
    DC --> PriceTabC["PriceTab"] --> PriceChart["PriceChart (SVG)"]
    DC --> InvTabC["InventoryTab"] --> InvCards["InventoryCard (phone)\n+ table (md+)"] & CostEditor["CostLotsEditor"] & ImportCard["ImportPreviewCard"]
    DC --> StockTabC["StockTab"] --> StockTable["StockValueTable"]
    DC --> FeesTabC["FeesTab"] --> FeesTable["MarketplaceFeesTable"]

    SkuTable --> Fig1["Fig"]
    OrderCards --> Fig2["Fig"]
    InvCards --> Fig3["Fig"]
    StockTable --> Fig4["Fig"]
    InvCards --> CostEditor
```

`Fig` (`components/shared/Fig.tsx`) is the smallest reusable piece — a label-over-value pair used across every card-view component on phone widths. `PanelHeader` gives every tab a consistent title + optional action button (typically "Download CSV") + description line.

## Wizard state machine

```mermaid
stateDiagram-v2
    [*] --> connect
    connect --> periods: handleConnect()\n(listPeriods succeeds, or a settlement-free\nsource like Demo is connected)
    connect --> connect: listPeriods returns nothing\nusable -> show error, stay
    periods --> data: handleLoadSelected()\n(fetchSnapshot succeeds)
    periods --> connect: startOver()
    data --> periods: "Change periods"\n(clearData(), keep connections)
    data --> connect: startOver()\n(clears connections + periods too)
```

`Step` (`connect | periods | data`) lives in `DashboardClient` state. Note the asymmetry: **"Change periods" clears the report data but keeps the pasted credentials**; **"Start over" clears everything**, including credentials — both are explicit, separate actions in the UI.

## State shape (`DashboardClient`)

| State | Type | Holds |
|---|---|---|
| `connections` | `Record<sourceId, Record<fieldKey, string>>` | Pasted credentials, per source |
| `periodsBySource` | `Record<sourceId, PeriodList>` | Result of `listPeriods` |
| `selectedPeriods` | `Record<sourceId, Set<string>>` | Checked periods per source |
| `snapshot` | `Snapshot \| null` | Opaque result of `fetchSnapshot` — see [Gateway Contract](./gateway-contract.md#the-snapshot-brand) |
| `sourceFilter` | `string[] \| "all"` | Which connected sources' data to include in the report |
| `inputs` | `Record<sku, Partial<Record<SkuField, string>>>` | Raw *string* box-cost field, keyed by normalized SKU |
| `lotDrafts` | `Record<sku, LotDraft[]>` | Raw *string* qty/unitCost pairs per purchase batch |
| `aliasDrafts` | `Record<sku, string>` | Raw comma/semicolon-separated alias SKU text per SKU |
| `expanded` | `Set<sku>` | Which SKUs' purchase-batch editor is open |
| `importPreview` | `PortableImportResult \| null` | Parsed-but-not-yet-applied import file (xlsx, zip or csv) |
| `pendingPeriods` | `Record<sourceId, string[]> \| null` | Period ids from an imported file, applied (where still offered) when the period list next loads |

**Why raw strings, not parsed numbers:** inputs are kept as strings (`inputs`, `lotDrafts`) so a half-typed value like `"1."` doesn't fight the controlled input's value on every keystroke. A `useMemo` (`parsedInputs`) converts everything to the real `CostInputs` shape — parsing each field with `parseFloat`, dropping `NaN`s — and only *that* derived value is passed to `buildReport`. This keeps `buildReport` itself simple (it only ever sees valid numbers or `undefined`) while the UI stays forgiving of in-progress typing.

## Data flow: typing a cost to seeing a new profit figure

```mermaid
sequenceDiagram
    participant U as User
    participant Input as <input> (controlled)
    participant State as inputs/lotDrafts state
    participant Memo as parsedInputs (useMemo)
    participant Report as liveReport (useMemo -> buildReport)
    participant UI as Tables/tiles

    U->>Input: types "3.50"
    Input->>State: setField(sku, "boxCost", "3.50")
    State->>Memo: recompute (inputs changed)
    Memo->>Report: recompute (parsedInputs changed)
    Note over Report: buildReport(snapshot, parsedInputs, {sourceFilter})\npure — no network call
    Report->>UI: new Report -> re-render
```

Because `snapshot` doesn't change, this entire chain runs with **zero network calls** — the responsiveness the two-step fetch/compute split ([Gateway Contract](./gateway-contract.md#buildreport--the-pure-step)) exists to guarantee.

## Tabs

| Tab | Component | Backed by (`Report` field) | Notes |
|---|---|---|---|
| **By SKU** | `SkuTab` → `SkuSummaryTable` | `bySku: SkuSummary[]` | Per-product rollup; flags `possibleDuplicates`; CSV export |
| **Order lines** | `OrdersTab` → `OrderLineCard` (phone) / table (desktop) | `orderLines: MarginRow[]` | One row per settled or estimated line; settled/estimated totals shown separately, never blended; CSV export |
| **Price over time** | `PriceTab` → `PriceChart` | `priceSeries: PriceSeries[]` | Hand-built SVG chart — see [below](#price-chart) |
| **Inventory & costs** | `InventoryTab` → `InventoryCard` (phone) / table (desktop) | derived from `parsedInputs` + `Report.inventory` | The only tab with write operations: cost entry, box cost, CSV import/export |
| **Stock value** | `StockTab` → `StockValueTable` | `stock` (from `stockValue()`, see [Engine](./engine.md#stockvalue-pooled-never-summed-across-sources)) | Merchant-fulfilled only; oversell risk flagged |
| **Marketplace fees** | `FeesTab` → `MarketplaceFeesTable` | `marketplaceFees: AccountCharge[]` | Charges tied to no single order line |

Every tab follows the same **mobile-first pattern**: a `<ul>` of cards rendered below the `md` breakpoint (768px), a `<table>` rendered at `md` and above, both driven from the same data so there's no separate "mobile logic."

### Inventory & costs tab

The one tab that mutates state rather than just displaying it. Two input paths converge on the same state:

1. **Manual entry** — `CostLotsEditor` (batch qty × unit cost rows) and the box-cost input, wired through `setField`/`addLot`/`updateLot`/`removeLot`/`aliasDrafts`.
2. **File import** — `handleImportFile` reads the file into bytes, calls `parseImportFile` (from `lib/gateway`) with the current inputs, and stores the result in `importPreview` *without touching any other state*. `ImportPreviewCard` shows stats, a diff against the current entries, and warnings/errors; **Merge** or **Replace** (`confirmImport`) then applies it — see [Engine — Portable save file](./engine.md#portable-save-file-engineportable).

**Export / Import controls (`SaveLoadControls`)** live in the data screen's header (Export menu + Import file) and, import-only, on the connect screen so a saved file can be loaded before connecting. `handleExport` builds the file (workbook, CSV bundle, or the costs-only CSV) and downloads it client-side. The costs-only CSV (`costsToCsv`) still lists every loaded SKU with blank batch columns when nothing is entered, so it doubles as a fill-in template. API credentials (`connections`) are never passed to the exporter.

### Price chart

`PriceChart.tsx` is a hand-built inline SVG line chart — no charting library. Notable implementation choices:

- **Measures its own rendered width** via `ResizeObserver` and draws at that real pixel width (capped at 900px), rather than a fixed viewBox scaled to fit — so axis/label text stays legible on a phone instead of shrinking to unreadable sizes.
- **Caps at 6 charted series** (`MAX_SERIES`); the rest remain visible in the always-available table view.
- **Colors are positional, not value-based** — a SKU's color comes from its index among charted series and never changes, so a legend entry always means the same product.
- **Keyboard and touch support**: arrow keys move the crosshair between sale dates (ARIA `role="group"` with a descriptive label); a tap keeps the tooltip open until focus moves (unlike a mouse, which clears it on `pointerleave`) because touch fires `pointerleave` the instant a finger lifts.
- **`approxPoints`** (from `PriceSeries`, see [Engine — price series](./engine.md#price-series-pricests)) is surfaced as a footnote when any point was placed on a settlement posting date rather than the real order date.

## Tab navigation (`useTabNavigation`)

A small hook implementing the ARIA "tabs" keyboard pattern: `ArrowLeft`/`ArrowRight` cycle through `TAB_ORDER`, moving both React state and DOM focus together. It also scrolls the newly active tab into view — needed because the tab bar scrolls horizontally on a phone, so a tab selected indirectly (e.g. clicking "Enter purchase costs to see profit" inside the Profit KPI tile, which calls `setTab("inventory")`) could otherwise land off-screen.

## PWA install prompt (`InstallPrompt.tsx`)

Shown on the **connect screen**, before any credentials are entered, so it's visible on first load. Key mechanics:

- **`beforeinstallprompt` is captured at module load** (not inside the component), because the event fires once, early in page load — long before the wizard reaches this screen.
- **Platform detection** distinguishes iOS (no install API; Apple only allows Share → Add to Home Screen — the button shows numbered steps instead) from Android/Chromium (native `beforeinstallprompt` flow — the button really installs). iPadOS reports itself as `Macintosh` in its user agent, so touch-point count disambiguates it from a real Mac.
- **Dismissal** is remembered via `localStorage` (`byraf-install-dismissed`). With the `theme` cookie (see [Design system and themes](#design-system-and-themes-componentsui)) it is one of only two UI preferences this app keeps in the browser, consistent with the "nothing is stored" security model (see [Configuration & Security](./configuration-and-security.md)).
- Uses `useSyncExternalStore` with a `serverSnapshot` of `"hidden"`, so server-rendered HTML always matches the first client render (avoiding a hydration mismatch) and the real platform-detected state appears immediately after hydration.

## Design system and themes (`components/ui/`)

The app has two designs, switched live by the **Retro UI / Modern UI** button in the menu bar (`ThemeToggle`): *retro* (the original classic-Mac look) and *modern* (Bootstrap-style). Pages never name a design; they use kit components and the active design decides the classes.

```mermaid
flowchart LR
    Cookie["theme cookie"] --> Root["app/layout.tsx\ngetTheme() -> html data-theme"]
    Config["config.ts\ndefaultTheme, allowSwitching"] --> Root
    Root --> Provider["ThemeProvider\nuseTheme / useStyles"]
    Provider --> Kit["Button, Card, Input, Table,\nTabList/TabButton, MenuBar, ThemeBody"]
    Kit --> Map["styles.ts registry\nthemes/retro.ts, themes/modern.ts"]
    Map --> Retro["sc-* classes\napp/globals.css"]
    Map --> Modern["daisyUI classes\n+ Tailwind utilities"]
    Toggle["ThemeToggle"] --> Provider
```

| File | Role |
|---|---|
| `config.ts` | **The one file to edit to change the design:** `defaultTheme` and `allowSwitching` (see below). |
| `theme.ts` | `THEMES`, `Theme`, `parseTheme()`, `resolveTheme()`, the cookie name. Pure, so it is unit-tested. |
| `theme.server.ts` | `getTheme()` reads the cookie in a server component (`server-only`) and applies `resolveTheme`. |
| `themes/types.ts` | `ThemeStyles`: every design-dependent slot (`card`, `button.variant.primary`, `input`, `table`, `tabList`, ...). |
| `themes/retro.ts`, `themes/modern.ts` | **One file per design**, each an object of that same shape. |
| `styles.ts` | The registry `{ retro, modern }`; `satisfies Record<Theme, ThemeStyles>` makes a name in `THEMES` fail to compile until it has a design file. |
| `ThemeProvider.tsx` | Context + `useTheme()` / `useStyles()`. `setTheme()` updates state, `<html data-theme>` and the cookie. |
| `ThemeBody.tsx` | `<body>` as a client component so it restyles the moment the theme flips. |
| `Button.tsx`, `Card.tsx`, `Input.tsx`, `Table.tsx`, `Tabs.tsx`, `MenuBar.tsx` | The kit. Each merges the slot's classes with the caller's `className` (via `clsx`). `useButtonClass()` serves non-`<button>` elements such as `<summary>`. |
| `ThemeToggle.tsx` | The menu-bar switch; shows the design it will switch to. |

**How the designs differ.** *Retro* is the existing `sc-*` classes in `app/globals.css`, untouched. *Modern* is [daisyUI](https://daisyui.com) component classes (`btn`, `card`, `input`, `table`, `tabs`) written as Tailwind class strings in `styles.ts`, plus one `@plugin "daisyui/theme"` block in `globals.css` that sets a Bootstrap 5 palette. That block also redefines the `--color-sc-*` tokens, so the roughly hundred existing `text-sc-ink-2` / `border-sc-line` / `bg-sc-head` utilities follow the theme with no per-file change. There is no hand-written modern CSS.

**Flash-free and mismatch-free.** The server reads the `theme` cookie in the root layout and renders `data-theme` and every class for that design, so the first paint is already right and server and client agree. The cookie holds only `retro` or `modern`; any other value falls back to retro.

**Retro-only global CSS is scoped.** The dithered desktop, Chicago font (`--font-retro`, no longer `--font-sans`) and boxy scrollbars live under `[data-theme="retro"]`. They are unlayered rules, which would otherwise beat Tailwind utilities and leak into modern.

**Gotcha: a design's card class may set `display`.** daisyUI's `card` is `display: flex`, which overrides a closed `<dialog>`'s `display: none`. The receipts dialog therefore carries `hidden … open:flex`. Anything else that puts a card class on an element with its own display behaviour needs the same care.

**Changing the design from config.** Edit `components/ui/config.ts`:

```ts
export const themeConfig = {
  defaultTheme: "modern", // what visitors get until they pick one
  allowSwitching: false,  // true: menu-bar toggle + remembered choice; false: locked to defaultTheme
};
```

With `allowSwitching: false` the toggle is hidden and any saved `theme` cookie is ignored, so the whole app is that one design. It is a build-time constant; there is no environment-variable override. A design's class names live in `themes/<name>.ts` and its colours in the matching theme block in `app/globals.css` (colours cannot move into TypeScript because daisyUI reads them from CSS).

**Adding a design:** add its name to `THEMES` in `theme.ts`, create `themes/<name>.ts` exporting a `ThemeStyles` (the compiler lists the slots) and register it in `styles.ts`, then define its colour tokens (for a daisyUI design, another `@plugin "daisyui/theme"` block that also overrides every `--color-sc-*`). `npm run test:theme` checks the pieces line up.

**Adding a kit component:** add a slot to `ThemeStyles`, fill it for both designs, and write a ~10-line component that reads `useStyles()`.

## Receipts folder (`app/(dashboard)/receipts/`)

A standalone, stateless folder for PDF receipts, opened from the **Receipts** button in the dashboard header. Not linked to batches or SKUs.

| File | Role |
|---|---|
| `ReceiptsProvider.tsx` | Context holding the receipts (in memory only), `addFiles`/`rename`/`remove`, and blob-URL bookkeeping. Rendered in `app/(dashboard)/layout.tsx`. |
| `ReceiptsPanel.tsx` | The modal window (a native `<dialog>`): upload zone, per-upload results, search, list, Download all. |
| `ReceiptsButton.tsx` | Header button, shows the count. |
| `utils.ts` | Pure helpers: PDF sniffing, limits, name cleanup, SHA-256 duplicate id, zip backup. Covered by `npm run test:receipts`. |

**Why it is a panel and not a `/receipts` page:** the app keeps nothing between page loads, so navigating away from `/dashboard` would unmount `DashboardClient` and discard the typed-in credentials and costs. State lives in the layout instead, which survives the panel opening and closing.

**Reviving persistence later:** the UI only talks to `useReceipts()`, so swapping the in-memory array for IndexedDB or cloud storage keyed by the signed-in user id (see [Authentication](./authentication.md#toward-saved-data)) is a change inside `ReceiptsProvider.tsx`.

## Legacy route

`app/(dashboard)/margins/page.tsx` is a redirect to `/dashboard`, and `app/page.tsx` redirects `/` to `/dashboard` as well. `/margins` was the route before the multi-marketplace refactor unified everything under `/dashboard`; it's kept only so old bookmarks/links keep working.

## Related documentation

- [Gateway Contract](./gateway-contract.md) — every type this UI renders (`Report`, `SourceDescriptor`, `Snapshot`)
- [Engine](./engine.md) — how the figures shown in every tab are actually computed
- [Configuration & Security](./configuration-and-security.md) — the import boundary that keeps this layer marketplace-neutral, and why nothing here is persisted
- [`README.md`](../../README.md) — the user-facing description of every tab and the mobile/PWA behavior, from the seller's point of view
