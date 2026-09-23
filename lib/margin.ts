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

/** What you enter per SKU. All optional - the math degrades gracefully. */
export interface SkuInputs {
  unitCost?: number;
  boxCost?: number;
  boxLength?: number;
  boxWidth?: number;
  boxHeight?: number;
}

/**
 * The divisor carriers use to turn box volume into billable "dimensional
 * weight" - 139 is the common domestic ground figure. Shown so an
 * oversized box's shipping charge is explainable rather than mysterious;
 * it is an estimate, not what Walmart actually billed.
 */
export const DIM_DIVISOR = 139;

export function cubicInches(i: SkuInputs): number | null {
  if (!i.boxLength || !i.boxWidth || !i.boxHeight) return null;
  return i.boxLength * i.boxWidth * i.boxHeight;
}

export function dimWeight(i: SkuInputs): number | null {
  const cu = cubicInches(i);
  return cu === null ? null : cu / DIM_DIVISOR;
}

export interface MarginRow extends OrderLineSummary {
  hasCost: boolean;
  itemCostTotal: number;
  boxCostTotal: number;
  costTotal: number;
  profit: number;
  margin: number | null;
}

/**
 * profit is correct even for a SKU with nothing entered yet (costs fall
 * back to 0) or an unrecognized Amount Type, since netAmount already
 * sums every row for the line regardless of category. Only the margin
 * percentage needs the revenue split.
 *
 * Item cost scales with qty; box cost does not - one shipment, one box.
 */
export function computeMargins(
  lines: OrderLineSummary[],
  inputs: Record<string, SkuInputs>
): MarginRow[] {
  return lines.map((line) => {
    const { unitCost, boxCost } = inputs[line.sku] ?? {};
    const hasCost = typeof unitCost === "number" && !Number.isNaN(unitCost);

    const itemCostTotal = hasCost ? unitCost * line.qty : 0;
    const boxCostTotal =
      typeof boxCost === "number" && !Number.isNaN(boxCost) ? boxCost : 0;
    const costTotal = itemCostTotal + boxCostTotal;

    const profit = line.netAmount - costTotal;
    const margin = line.revenue !== 0 ? profit / line.revenue : null;
    return {
      ...line,
      hasCost,
      itemCostTotal,
      boxCostTotal,
      costTotal,
      profit,
      margin,
    };
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
      itemCostTotal: acc.itemCostTotal + r.itemCostTotal,
      boxCostTotal: acc.boxCostTotal + r.boxCostTotal,
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
      itemCostTotal: 0,
      boxCostTotal: 0,
      costTotal: 0,
      profit: 0,
    }
  );
}
