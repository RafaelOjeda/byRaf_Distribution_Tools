# Dashboard tab consolidation plan

**Goal:** reduce the dashboard from six tabs to four with no loss of information.
Two pairs of tabs show the same SKUs from two angles, so you have to switch tabs to connect them.

| Today | After |
|---|---|
| By SKU · Order lines · Price over time | **Sales** (SKU rollup → order-line drill-down, with a Chart view) |
| Inventory & costs · Stock value | **Inventory** (costs, on hand and value in one row) |
| Marketplace fees | **Fees** (unchanged apart from the shorter name) |

This is a frontend-only change. `buildReport`, `Report`, the CSV builders and the portable save file keep their current behavior. The only engine change is a small helper, which is optional (see "Inventory").

Ship it as two PRs, Inventory first. Each PR is useful by itself, and the Inventory merge is the safer one.

---

## PR 1 — Inventory (merge "Inventory & costs" + "Stock value")

### Why

- Stock value is computed entirely from what you enter on Inventory & costs. Its help text even points back there.
- The two tabs also disagree on **On hand**, and that is a real bug:
  - Inventory & costs reads `inventoryBySku`. That map is built with `Map.set` per source, so when several sources are connected, the **last source wins**. The "Left" discrepancy check then compares your batches against that one source.
  - Stock value uses `stockValue()`, which pools units per SKU and is never summed across sources (see engine.md).
- Merging the tabs means there is one definition of On hand, the pooled one.

### Table (desktop)

One row per SKU, keyed by normalized SKU, as `skus` is today. The current Inventory row gains the stock-value columns:

| Item ▸ | On hand | Sold | Bought | Left | Avg cost | Box cost | Listed price | Value @ cost | Value @ price |
|---|---|---|---|---|---|---|---|---|---|

- **On hand** comes from the matching `stock.rows` entry, not `inventoryBySku`. Keep what the current Stock value tab shows: the `(est.)` suffix, the amber oversell colour, and the per-source tooltip. Where a SKU has no stock row, show `—`.
- **Left** keeps its amber discrepancy check. It compares against the largest single-source count (`max(bySource.onHand)`), because the pooled On hand already *is* the batch-implied number once batches exist. Comparing against the pool would make the check meaningless.
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

- `components/tabs/InventoryTab.tsx`: take a `stock: Report["stock"]` prop, build `stockBySku` (normalized) with `useMemo`, render `StockTotals` and the new columns.
- `components/InventoryCard.tsx`: accept the stock row.
- `components/StockValueTable.tsx` → reduced to `StockTotals.tsx` (the totals and the oversell banner). Delete the rest.
- `components/tabs/StockTab.tsx`: delete.
- `types.ts`: `Tab` drops `"stock"`.
- `hooks/useTabNavigation.ts`: `TAB_ORDER` drops `"stock"`.
- `DashboardClient.tsx`:
  - Remove the tab entry and its render branch.
  - Pass `stockVal` into `InventoryTab`.
  - Make the **Stock value KPI tile** a link to Inventory, as the Profit tile already is: `setTab("inventory")`.
  - `inventoryBySku` is still needed for the On-hand tooltip (`availToSell` / `reserved`). Change it to collect *all* entries per SKU so the tooltip can list every source, instead of keeping only the last one.
- Optional engine helper: `stockRowBySku(stock)` in `lib/gateway`, if `nameBySku`-style lookups multiply. Not required.

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

- Group order lines per SKU once, with `useMemo`: `linesBySku = Map<normalizeSku(sku), MarginRow[]>`. That is the same key `summarizeBySku` uses, so they always agree. No engine change.
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
  - `SkuSummaryTable`, with new `expanded` / `onToggle` / `linesBySku` props and a nested lines row.
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

- Same commands as PR 1.
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
- Any engine or `Report` change.

## Risks

- **Muscle memory:** "Order lines" moves one click deeper (Sales → All lines).
  - Mitigation: remember the last Sales view in localStorage, so someone who lives in All lines lands there.
- **Wider Inventory table.** Mitigated by the toggle and by the phone card layout.
- **On hand changes meaning on Inventory**, from last-source to pooled. That is the bug fix, but a user with one source and no batches sees no change. A user with several sources may see a different number: mention it in the PR description.
