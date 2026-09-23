import type { ReconRow } from "./walmart/recon";

export interface OrderLineSummary {
  purchaseOrderNo: string;
  purchaseOrderLine: string;
  sku: string;
  itemName: string;
  qty: number;
  fulfillmentType: string;
  commissionRate: string;

  // Components. Every row lands in exactly one of these, so they always
  // sum to netAmount - nothing is silently dropped.
  revenue: number; // "Product Price"
  commission: number; // "Commission on Product" (negative)
  shipping: number; // shipping label charges (negative)
  tax: number; // tax collected + withheld, normally nets to 0
  otherFees: number; // anything not matched above

  netAmount: number;
}

type Component = "revenue" | "commission" | "shipping" | "tax" | "otherFees";

/**
 * Categories confirmed against live settlement data 2026-09-23. Shipping
 * is matched on description rather than Amount Type, because Walmart
 * files label charges under the generic "Fee/Reimbursement" type.
 */
function classify(amountType: string, description: string): Component {
  if (amountType === "Product Price") return "revenue";
  if (amountType === "Commission on Product") return "commission";
  if (amountType.startsWith("Product tax")) return "tax";
  if (/shipping/i.test(description)) return "shipping";
  return "otherFees";
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
        commissionRate: "",
        revenue: 0,
        commission: 0,
        shipping: 0,
        tax: 0,
        otherFees: 0,
        netAmount: 0,
      };
      groups.set(key, group);
    }

    const amount = parseFloat(row["Amount"]) || 0;
    group[classify(row["Amount Type"], row["Transaction Description"])] +=
      amount;
    group.netAmount += amount;

    if (!group.sku && row["Partner Item Id"]) group.sku = row["Partner Item Id"];
    if (!group.itemName && row["Partner Item Name"]) {
      group.itemName = row["Partner Item Name"];
    }
    if (!group.qty) group.qty = parseInt(row["Ship Qty"], 10) || 0;
    if (!group.commissionRate && row["Commission Rate"]) {
      group.commissionRate = row["Commission Rate"];
    }
  }

  return [...groups.values()];
}

export interface MarginRow extends OrderLineSummary {
  hasCost: boolean;
  costTotal: number;
  profit: number;
  margin: number | null;
}

/**
 * profit is correct even for a SKU with no cost entered yet (falls back
 * to cost=0) or an unrecognized Amount Type, since netAmount already
 * sums every row for the line regardless of category. Only the margin
 * percentage needs the revenue split.
 */
export function computeMargins(
  lines: OrderLineSummary[],
  costs: Record<string, number>
): MarginRow[] {
  return lines.map((line) => {
    const unitCost = costs[line.sku];
    const hasCost = typeof unitCost === "number" && !Number.isNaN(unitCost);
    const costTotal = hasCost ? unitCost * line.qty : 0;
    const profit = line.netAmount - costTotal;
    const margin = line.revenue !== 0 ? profit / line.revenue : null;
    return { ...line, hasCost, costTotal, profit, margin };
  });
}

export function sumMargins(rows: MarginRow[]) {
  return rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      commission: acc.commission + r.commission,
      shipping: acc.shipping + r.shipping,
      tax: acc.tax + r.tax,
      otherFees: acc.otherFees + r.otherFees,
      netAmount: acc.netAmount + r.netAmount,
      costTotal: acc.costTotal + r.costTotal,
      profit: acc.profit + r.profit,
    }),
    {
      revenue: 0,
      commission: 0,
      shipping: 0,
      tax: 0,
      otherFees: 0,
      netAmount: 0,
      costTotal: 0,
      profit: 0,
    }
  );
}
