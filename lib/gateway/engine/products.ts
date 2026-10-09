import {
  skuCost,
  type MarginRow,
  type SkuCost,
  type SkuInputs,
  type SkuStockRecord,
  type SkuSummary,
} from "./margins";
import { normalizeSku } from "./types";

/**
 * Everything the dashboard shows about one product, in one record. Each
 * view picks the fields it needs from here rather than working a figure
 * out again, so a cost or count shown in two places is always the same
 * number - see docs/tab-consolidation-plan.md, "Rule: one source, many
 * views".
 *
 * Nothing is copied: `stock` is the same object as the product's row in
 * `Report.stock.rows`, `sales` the same as its entry in `Report.bySku`,
 * and `orderLines` holds the same rows as `Report.orderLines`.
 */
export interface ProductRecord {
  /** normalizeSku key, after aliases are resolved. */
  sku: string;
  /** The product's name from its order lines; "" when no line names it. */
  name: string;
  cost: SkuCost;
  stock: SkuStockRecord;
  /** null when the product has no order lines in the loaded periods. */
  sales: SkuSummary | null;
  orderLines: MarginRow[];
}

/** One record per SKU in `stock`, sorted by SKU. */
export function buildProducts(
  stock: Map<string, SkuStockRecord>,
  bySku: SkuSummary[],
  orderLines: MarginRow[],
  inputs: Record<string, SkuInputs>
): ProductRecord[] {
  const sales = new Map(bySku.map((s) => [s.sku, s]));
  const lines = new Map<string, MarginRow[]>();
  for (const line of orderLines) {
    if (!line.sku) continue;
    const key = normalizeSku(line.sku);
    const group = lines.get(key);
    if (group) group.push(line);
    else lines.set(key, [line]);
  }

  return [...stock.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sku, record]) => {
      const summary = sales.get(sku) ?? null;
      return {
        sku,
        name: summary?.itemName ?? "",
        cost: skuCost(inputs[sku]),
        stock: record,
        sales: summary,
        orderLines: lines.get(sku) ?? [],
      };
    });
}
