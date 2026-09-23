import type { ReconRow } from "./walmart/recon";

export interface OrderLineSummary {
  purchaseOrderNo: string;
  purchaseOrderLine: string;
  sku: string;
  itemName: string;
  qty: number;
  fulfillmentType: string;
  netAmount: number; // sum of every row for this line, all amount types
  revenue: number; // sum of "Product Price" rows only
}

/**
 * Groups raw recon rows into one summary per order line. Rows with no
 * Purchase Order # (account-level rows like PaymentSummary, or WFS
 * storage fees) are dropped here - they don't belong to a single line.
 */
export function groupReconRows(rows: ReconRow[]): OrderLineSummary[] {
  const groups = new Map<string, OrderLineSummary>();

  for (const row of rows) {
    const po = row["Purchase Order #"];
    const line = row["Purchase Order line #"];
    if (!po || !line) continue;

    const key = `${po}::${line}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        purchaseOrderNo: po,
        purchaseOrderLine: line,
        sku: row["Partner Item Id"] || "",
        itemName: row["Partner Item Name"] || "",
        qty: 0,
        fulfillmentType: row["Fulfillment Type"] || "",
        netAmount: 0,
        revenue: 0,
      };
      groups.set(key, group);
    }

    const amount = parseFloat(row["Amount"]) || 0;
    group.netAmount += amount;
    if (row["Amount Type"] === "Product Price") group.revenue += amount;
    if (!group.sku && row["Partner Item Id"]) group.sku = row["Partner Item Id"];
    if (!group.qty) group.qty = parseInt(row["Ship Qty"], 10) || 0;
  }

  return [...groups.values()];
}

export interface MarginRow extends OrderLineSummary {
  hasCost: boolean;
  profit: number;
  margin: number | null;
}

/**
 * profit is correct even for a SKU with no cost entered yet (falls back
 * to cost=0) or an unrecognized Amount Type, since netAmount already
 * sums every row for the line regardless of type. Only the margin
 * percentage needs the revenue split.
 */
export function computeMargins(
  lines: OrderLineSummary[],
  costs: Record<string, number>
): MarginRow[] {
  return lines.map((line) => {
    const unitCost = costs[line.sku];
    const hasCost = typeof unitCost === "number" && !Number.isNaN(unitCost);
    const cost = hasCost ? unitCost * line.qty : 0;
    const profit = line.netAmount - cost;
    const margin = line.revenue !== 0 ? profit / line.revenue : null;
    return { ...line, hasCost, profit, margin };
  });
}
