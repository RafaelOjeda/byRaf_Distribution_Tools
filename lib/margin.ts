import type { Order } from "./walmart/orders";
import type { ReconRow } from "./walmart/recon";

export interface OrderLineSummary {
  purchaseOrderNo: string;
  purchaseOrderLine: string;
  sku: string;
  itemName: string;
  qty: number;
  fulfillmentType: string;
  commissionRate: string;

  // "settled" = exact figures from a recon report. "estimated" = an
  // order Walmart hasn't settled yet; commission and shipping are
  // projected from that SKU's settled history.
  status: "settled" | "estimated";
  // Estimated line whose SKU has no settled history to project from.
  // Its commission/shipping/net are placeholders and must not be shown
  // or summed.
  noEstimate: boolean;
  estimateNote?: string;
  orderDate?: string; // YYYY-MM-DD, estimated lines only

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
        status: "settled",
        noEstimate: false,
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

export interface SkuHistory {
  commissionRate: number; // effective fraction of revenue, e.g. 0.064
  avgShipping: number; // per shipment, negative
  shipments: number;
}

/**
 * Per-SKU averages from settled lines. Commission is the effective rate
 * actually charged, not the "Commission Rate" field: the Barbie SKU's
 * effective rate (~6.4%) differs from the plain category rate, likely
 * from an incentive program, so a flat category rate would be wrong.
 */
export function buildSkuHistory(
  settled: OrderLineSummary[]
): Record<string, SkuHistory> {
  const acc: Record<
    string,
    { revenue: number; commission: number; shipping: number; n: number }
  > = {};
  for (const line of settled) {
    if (!line.sku || line.revenue === 0) continue;
    const a = (acc[line.sku] ??= { revenue: 0, commission: 0, shipping: 0, n: 0 });
    a.revenue += line.revenue;
    a.commission += line.commission;
    a.shipping += line.shipping;
    a.n += 1;
  }

  const out: Record<string, SkuHistory> = {};
  for (const [sku, a] of Object.entries(acc)) {
    out[sku] = {
      commissionRate: -a.commission / a.revenue,
      avgShipping: a.shipping / a.n,
      shipments: a.n,
    };
  }
  return out;
}

const SHIP_NODE_LABELS: Record<string, string> = {
  SellerFulfilled: "Seller Fulfilled",
  WFSFulfilled: "WFS",
};

/**
 * Match key between the recon report and the Orders API. Not PO + line
 * number: the two APIs disagree on line numbers for the same order
 * (PO 129124698245692 is line 2 in its recon report, line 1 in the
 * Orders API). Trade-off: an order with the same SKU on two lines that
 * settle in different periods would count as settled once either does.
 */
export function settlementKey(purchaseOrderNo: string, sku: string): string {
  return `${purchaseOrderNo}::${sku}`;
}

/**
 * Turns orders Walmart hasn't settled yet into estimated line summaries.
 * Lines already in a recon report (settledKeys, built with
 * settlementKey) and fully cancelled lines are skipped. Tax is left at
 * 0: Walmart collects and withholds it, so it nets to nothing on every
 * settled line seen so far.
 */
export function estimateUnsettled(
  orders: Order[],
  settledKeys: Set<string>,
  history: Record<string, SkuHistory>
): OrderLineSummary[] {
  const out: OrderLineSummary[] = [];

  for (const order of orders) {
    for (const line of order.orderLines?.orderLine ?? []) {
      const sku = line.item?.sku ?? "";
      if (settledKeys.has(settlementKey(order.purchaseOrderId, sku))) {
        continue;
      }

      const orderedQty = parseInt(line.orderLineQuantity?.amount, 10) || 0;
      const activeQty = (line.orderLineStatuses?.orderLineStatus ?? [])
        .filter((s) => s.status !== "Cancelled")
        .reduce((n, s) => n + (parseInt(s.statusQuantity?.amount, 10) || 0), 0);
      if (activeQty === 0 || orderedQty === 0) continue;

      // chargeAmount is taken as the line total and scaled down for any
      // partially cancelled quantity. Every line seen so far is qty 1,
      // so the line-total reading is unverified for qty > 1.
      const scale = activeQty / orderedQty;
      let revenue = 0;
      let otherFees = 0;
      for (const c of line.charges?.charge ?? []) {
        const amount = (c.chargeAmount?.amount ?? 0) * scale;
        if (c.chargeType === "PRODUCT") revenue += amount;
        else otherFees += amount;
      }

      const h = history[sku];
      const commission = h ? -revenue * h.commissionRate : 0;
      const shipping = h ? h.avgShipping : 0;

      out.push({
        purchaseOrderNo: order.purchaseOrderId,
        purchaseOrderLine: line.lineNumber,
        sku,
        itemName: line.item?.productName ?? "",
        qty: activeQty,
        fulfillmentType:
          SHIP_NODE_LABELS[order.shipNode?.type ?? ""] ??
          order.shipNode?.type ??
          "",
        commissionRate: h ? (h.commissionRate * 100).toFixed(1) : "",
        status: "estimated",
        noEstimate: !h,
        estimateNote: h
          ? `Estimated: commission at ${(h.commissionRate * 100).toFixed(1)}% and shipping at the average of ${h.shipments} settled shipment${h.shipments === 1 ? "" : "s"}`
          : "No settled history for this SKU yet - nothing to estimate from",
        orderDate: new Date(order.orderDate).toISOString().slice(0, 10),
        revenue,
        commission,
        shipping,
        tax: 0,
        otherFees,
        netAmount: revenue + commission + shipping + otherFees,
      });
    }
  }

  return out;
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
