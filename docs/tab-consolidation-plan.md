# Dashboard tab consolidation plan

**Goal:** reduce the dashboard from six tabs to three with no loss of information.
Two pairs of tabs show the same SKUs from two angles, so you have to switch tabs to connect them.

| Today | After |
|---|---|
| By SKU · Order lines · Price over time | **Sales** (SKU rollup → order-line drill-down, with a Chart view) |
| Inventory & costs · Stock value | **Inventory** (costs, on hand and value in one row) |
| Marketplace fees | **Fees** (unchanged apart from the shorter name) |

Every number in the dashboard is a **view of one source**, never its own copy. See "Rule: one source, many views" below. This adds one engine change (PR 0) before the tab merges.

Ship it as three PRs: **0 → 1 → 2**. Each one is useful by itself.

---

## Rule: one source, many views

When a figure shows up in several places (a product's cost, its on-hand count, its name), there must be **one place it's stored and one place it's calculated**. Every tab, card, tooltip, KPI tile and CSV reads that one result. No screen recomputes a figure from raw inputs on its own. That way an edit anywhere shows up everywhere at once, and two screens can never disagree.

### Where things stand today (audit, 2026-10-09)

**What you type is already stored in one place.** Batches, box cost and aliases live only in `DashboardClient` state (`lotDrafts`, `inputs`, `aliasDrafts`). That state goes through `parsedInputs` → `buildReport()`. The Export file is written from the same state. There is no second copy of an entered cost.

**What's calculated from it is not.** Several screens work out the same figure separately:

| Figure | Calculated in | Problem |
|---|---|---|
| **On hand** | `inventoryBySku` (DashboardClient, last source wins) **and** `stockValue()` (engine, pooled) | **Already disagree** with several sources connected. Inventory & costs and Stock value can show different numbers for the same SKU. |
| **Avg cost** | `InventoryTab` (calls `averageUnitCost` itself), `stockValue()`, `computeMargins()` per line, and `CostLotsEditor` (re-parses the typed batches with a copy of the `parsedInputs` code) | Same today, but four call sites and two copies of the parsing code. A change to one (e.g. ignoring zero-qty batches) silently splits them. |
| **Bought / Left / discrepancy** | `InventoryTab` calls `reconcileStock()` with the last-source on-hand count | Built on the wrong On hand (above). |
| **Product name** | `nameBySku` (DashboardClient) **and** `SkuSummary.itemName` (engine) | Two separate rules for picking the name. Same result today, could drift. |
| **Sold** | `bySku[].units`, read by both the UI (`soldBySku`) and `stockValue()` | ✅ Already one source. |
| **Line cost / profit** | `computeMargins()`, read by Order lines, By SKU, KPIs and the CSVs | ✅ Already one source. |

---

## PR 0 — One product record per SKU (engine)

Add `Report.products` to `buildReport()`: one record per normalized SKU, after aliases are resolved. It holds **every** per-product figure the dashboard shows:

```ts
interface ProductRecord {
  sku: string;              // normalized key, the same one every other map uses
  name: string;             // one naming rule, here only
  cost: { avgCost: number | null; boxCost: number | null; purchased: number; batches: number };
  stock: {
    onHand: number;         // pooled; falls back to the largest source count
    onHandIsEstimate: boolean;
    bySource: { source: string; sourceLabel: string; onHand: number; availToSell: number; reserved: number }[];
    left: number | null;    // purchased − sold, null with no batches
    discrepancy: number | null; // left − largest source count
    oversellRisk: boolean;
  };
  listing: { price: number | null; publishedStatus: string | null; isPublished: boolean };
  value: { atCost: number | null; atPrice: number | null };
  sales: SkuSummary | null; // the existing rollup object, by reference, not copied
  orderLines: MarginRow[];  // the existing rows, by reference, not copied
}
```

- `stockValue()` and `summarizeBySku()` stay. `products` is assembled from their output plus the cost inputs, so there is still exactly one calculation per figure.
- `Report.stock.rows` and `Report.bySku` remain for the CSV builders and the save file. They are now *derived from the same objects* the product records point to.
- `computeMargins()` and `products[sku].cost.avgCost` both get the unit cost from one per-SKU cost table. That table is built once in `buildReport`, instead of calling `averageUnitCost` per line.
- **Move draft parsing into one helper,** `parseCostDrafts(inputs, lotDrafts, aliasDrafts)` in `lib/gateway`. Both `parsedInputs` and `CostLotsEditor` call it. The editor's live "avg / spent" line then reads `products[sku].cost` (the report rebuilds on each keystroke anyway).
- **UI cleanup:**
  - Delete `inventoryBySku`, `nameBySku` and `soldBySku` from `DashboardClient`.
  - Remove the `averageUnitCost` / `reconcileStock` calls from `InventoryTab` and `InventoryCard`.
  - Every component takes a `ProductRecord` (or a list of them) instead of raw maps.
- **Guard test** in `scripts/test-engine.ts`: for a fixture with two sources and an alias, check for every SKU that:
  - `products[sku].cost.avgCost` equals each of that SKU's order-line unit costs and its stock row's `avgCost`;
  - `products[sku].stock.onHand` equals its stock row's;
  - `products[sku].name` equals `sales.itemName`.

  If someone later adds a second calculation path, this test fails.
- **Write the rule into `docs/systems/frontend.md`:** "Components never call engine calculation helpers; they read `Report`." Add a lint-level check to `scripts/check-boundary.ts`: no imports of `averageUnitCost`, `reconcileStock` or `stockValue` under `app/`.

No visible change apart from the On hand fix, which this PR delivers early. PRs 1 and 2 then just choose which fields of `products` each view shows.

---

## PR 1 — Inventory (merge "Inventory & costs" + "Stock value")

### Why

- Stock value is computed entirely from what you enter on Inventory & costs. Its help text even points back there.
- The two tabs also disagree on **On hand**, and that is a real bug:
  - Inventory & costs reads `inventoryBySku`. That map is built with `Map.set` per source, so when several sources are connected, the **last source wins**. The "Left" discrepancy check then compares your batches against that one source.
  - Stock value uses `stockValue()`, which pools units per SKU and is never summed across sources (see engine.md).
- PR 0 fixes the number itself. Merging the tabs means you also only ever *see* it in one place.

### Table (desktop)

One row per SKU, keyed by normalized SKU, as `skus` is today. The current Inventory row gains the stock-value columns:

| Item ▸ | On hand | Sold | Bought | Left | Avg cost | Box cost | Listed price | Value @ cost | Value @ price |
|---|---|---|---|---|---|---|---|---|---|

- Every cell reads `products[sku]`, the same record the Sales view and the KPI tiles read. Typing a batch updates Avg cost, Left, Value @ cost, the Stock value tile and every order line's profit in the same render, because all of them are that one record.
- **On hand** is `stock.onHand`, pooled (PR 0 already fixed this). Keep the `(est.)` suffix, the amber oversell colour, and the per-source tooltip, which now includes `availToSell` / `reserved` for each source.
- **Left** / its amber check read `stock.left` / `stock.discrepancy`. The engine compares against the largest single-source count, because the pooled On hand already *is* the batch-implied number once batches exist.
- **Value @ price**: unpublished listings stay amber with the "unpublished" note and stay out of the total, as today.
- Rows the user expands (▸) still open `CostLotsEditor` underneath. Change `colSpan` from `BOX_FIELDS.length + 6` to `+ 9`.
- Sort and order stay the same, with one change: SKUs that are in stock come first. That is the main reason to open the tab, and it keeps sold-out SKUs from pushing stocked ones down.

### Summary strip

Move the "At cost / At current price" totals block and the oversell warning out of `StockValueTable` into a small `StockTotals` component. Place it above the table, under the PanelHeader. The coverage counts ("12 of 15 stocked SKUs · 3 with no cost entered") stay word-for-word.

### Phone

`InventoryCard` gains a second `<dl>` row: Listed price · Value @ cost · Value @ price. The unpublished note and the oversell note move into the card from `StockValueTable`'s card list. The card is already the expand target for batches, so no new interaction is needed.

### Width concern

The table goes from 7 to 10 columns.

- Give it a **"Show value columns"** toggle, on by default.
- Remember it under the localStorage key `byraf-inventory-value-cols`, following the `byraf-install-dismissed` pattern.
- Wrap the localStorage access in try/catch.

Optionally, drop **Sold** from the inventory row: By SKU already has Units, and Left = Bought − Sold shows it indirectly. My recommendation is to keep it, because Left is hard to read without it.

### Files

- `components/tabs/InventoryTab.tsx`: take `products: ProductRecord[]` and `stockTotals`, render `StockTotals` and the new columns. No calculations of its own.
- `components/InventoryCard.tsx`: take a `ProductRecord`.
- `components/StockValueTable.tsx` → reduced to `StockTotals.tsx` (the totals and the oversell banner). Delete the rest.
- `components/tabs/StockTab.tsx`: delete.
- `types.ts`: `Tab` drops `"stock"`.
- `hooks/useTabNavigation.ts`: `TAB_ORDER` drops `"stock"`.
- `DashboardClient.tsx`:
  - Remove the tab entry and its render branch.
  - Pass `stockVal` into `InventoryTab`.
  - Make the **Stock value KPI tile** a link to Inventory, as the Profit tile already is: `setTab("inventory")`.

### Docs

- `README.md`: merge the two table rows.
- `docs/systems/frontend.md`: update the tabs table, the KPI diagram note, and the "Inventory & costs tab" heading.
- `docs/systems/engine.md`: the anchor link `frontend.md#inventory--costs-tab` changes to `#inventory-tab`.
- `SkuSummaryTable`: its duplicate tooltip says "Add an alias under Inventory & costs". Change it to "under Inventory".

### Checks

- `npm run lint`, `npx tsc --noEmit`, `npm run test:engine`.
- Use the `run` skill for a manual pass with the Demo connector plus a second source. Check:
  - On hand shows the pooled value and the per-source tooltip.
  - Left's amber check still fires on a deliberately wrong batch.
  - The totals match the old Stock value tab.
  - The KPI tile jumps to the tab.
  - The layout holds on a phone (375px) and desktop.

---

## PR 2 — Sales (merge "By SKU" + "Order lines" + "Price over time")

### Why

By SKU is the rollup of Order lines. Today, answering "why is this SKU's margin low?" means switching to Order lines and scanning a flat list for that SKU. `multi-marketplace-plan.md` already planned for By SKU rows to expand into a per-source breakdown. This plan applies the same expand to the lines themselves.

### Layout

```
Sales                                        [Rollup | All lines | Chart]  [Download CSV ▾]
───────────────────────────────────────────────────────────────────────────────────────────
▸ Item A          units  lines  avg price  revenue  commission  shipping  ship%  net  cost  profit  margin
▾ Item B          ...
    Settled  Walmart  WFS   2   $40.00  -$6.00  -$5.10  ...      ← that SKU's order lines
    Est. 09-30 Demo   Self  1   ...
▸ Item C          ...
───────────────────────────────────────────────────────────────────────────────────────────
Settled · 41 lines         totals…        (from TotalsRow, as today)
Estimated · 6 lines        totals…
```

Three views behind one segmented control. The default is **Rollup**, so the first thing users see doesn't change.

1. **Rollup** (default): the `SkuSummaryTable` columns. Each row expands to its order lines in a nested row, shown with the Order-lines columns, minus Item (it's the parent row) and Status shown compactly.
2. **All lines**: today's flat Order lines table, unchanged. People do scan chronologically, and settled vs. estimated reads best flat.
3. **Chart**: today's `PriceChart`, unchanged. It already has a table view and a 6-series cap.
   - Small upgrade: if any SKUs are expanded in Rollup, chart *those* first (still capped at 6), so "expand two products, flip to Chart" compares them directly.

The settled/estimated `TotalsRow` footer moves to the bottom of both table views. The column sets differ, so `TotalsRow` gets a `variant: "rollup" | "lines"` that picks which cells line up. Its figures don't change, and "never blended" still holds: two rows, settled and estimated.

### Data

- The rollup row is `products[sku].sales`, and its expanded lines are `products[sku].orderLines`: the same `MarginRow` objects the All lines view and the CSVs use, not a regrouped copy. So the parent row and its children can't disagree, and a cost edit on Inventory changes both in the same render.
- Lines with no SKU (`!row.sku`) don't appear in the rollup today, and they still won't. **All lines** keeps showing them. The Rollup footer notes "N lines with no SKU — see All lines" when N > 0, so they aren't silently missing.
- The expanded set is `Set<string>` state in the tab, the same pattern as Inventory's `expanded`.

### CSV

One **Download CSV ▾** menu with two items: "By SKU" (`skuSummaryToCsv`) and "Order lines" (`orderLinesToCsv`). File names stay `by-sku` / `order-lines`. Both builders and the `Report - By SKU` / `Report - Order lines` export sheets are untouched.

### Phone

- **Rollup**: the `SkuSummaryTable` card gets a "Show N lines ▸" text button at the bottom that expands `OrderLineCard`s inside it, indented. Don't nest another bordered card in a card: use a left rule.
- **All lines**: today's `OrderLineCard` list.
- **Chart**: unchanged.
- The segmented control wraps if it must, but three short labels fit at 375px.

### Files

- New `components/tabs/SalesTab.tsx`: view state, the CSV menu, the footer. Composes:
  - `SkuSummaryTable`, with new `expanded` / `onToggle` props, reading lines from `products[sku].orderLines` and a nested lines row.
  - New `OrderLinesTable.tsx`, extracted from `OrdersTab` (table + cards). Reused by the All lines view and, with `compact`, inside expanded rows.
  - `PriceChart`, with a new optional `prefer?: string[]` prop for the expanded-first ordering.
- Delete `SkuTab.tsx`, `OrdersTab.tsx`, `PriceTab.tsx`.
- `TotalsRow.tsx`: add `variant`.
- `types.ts`: `Tab = "sales" | "inventory" | "fees"`.
- `useTabNavigation.ts`: `TAB_ORDER = ["sales", "inventory", "fees"]`, default `"sales"`.
- `DashboardClient.tsx`: the tab list becomes:
  - `Sales (N products · M lines)`
  - `Inventory (N)`
  - `Fees (N)`
- The view switcher inside Sales is a set of `aria-pressed` buttons, not nested ARIA tabs, matching the source filter chips.

### Docs

- `README.md`: the three table rows become one Sales row describing the three views. Also update "By SKU and Order lines each have a Download CSV button".
- `docs/systems/frontend.md`: the tabs table, the "Price chart" section (it now lives under Sales → Chart), and `useTabNavigation`.
- `docs/multi-marketplace-plan.md`: one line noting that the per-source breakdown now sits next to the line drill-down.

### Checks

- Same commands as PR 1, including PR 0's guard test.
- Manually check:
  - The expanded SKU's lines sum to its rollup row: units and revenue exactly; money columns over non-`noEstimate` lines only.
  - Both CSVs are byte-identical to the current exports on the same data.
  - The chart prefers expanded SKUs.
  - Keyboard: arrow keys across the 3 tabs; Tab into the view buttons and row toggles.
  - Phone layout.

---

## Fees

Rename the tab label to **Fees**; the panel title stays "Marketplace fees".

- **Keep it as a tab.** It has to stay out of the Sales and Inventory totals, which is its whole point.
- **Revisit later:** with only three tabs left, it could instead be a collapsible section at the bottom of Sales.
- **Hold off for now:** keeping it separate is what makes "these are not in your order totals" obvious.

## Out of scope

- Adding a fee total to the KPI tiles.
- Per-source breakdown rows (still planned in multi-marketplace-plan.md and unaffected).
- `Report` changes beyond `products` (PR 0).
- Persisting entered costs server-side. They stay in session state + the Export file, as today. The one-source rule is about not keeping *copies*; where that one copy is saved is a separate decision.

## Risks

- **Muscle memory:** "Order lines" moves one click deeper (Sales → All lines).
  - Mitigation: remember the last Sales view in localStorage, so someone who lives in All lines lands there.
- **Wider Inventory table.** Mitigated by the toggle and by the phone card layout.
- **On hand changes meaning on Inventory**, from last-source to pooled. That is the bug fix, but a user with one source and no batches sees no change. A user with several sources may see a different number: mention it in the PR description.
