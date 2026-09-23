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

/**
 * Walmart's own APIs disagree on SKU casing - the inventory API returns
 * "Jurassic-World-001" where the settlement report says
 * "JURASSIC-WORLD-001". Every SKU-keyed lookup goes through this so the
 * same product doesn't silently split in two.
 */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
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
    const key = normalizeSku(line.sku);
    const a = (acc[key] ??= { revenue: 0, commission: 0, shipping: 0, n: 0 });
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
  return `${purchaseOrderNo}::${normalizeSku(sku)}`;
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

      const h = history[normalizeSku(sku)];
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

/**
 * One purchase batch: how many units, at what price each. The same item
 * gets bought at different prices over time, so cost per SKU is the
 * quantity-weighted average across batches rather than a single number.
 */
export interface CostLot {
  qty: number;
  unitCost: number;
}

/** What you enter per SKU. All optional - the math degrades gracefully. */
export interface SkuInputs {
  lots?: CostLot[];
  boxCost?: number;
  boxLength?: number;
  boxWidth?: number;
  boxHeight?: number;
}

function validLots(lots: CostLot[] | undefined): CostLot[] {
  return (lots ?? []).filter(
    (l) =>
      Number.isFinite(l.qty) &&
      l.qty > 0 &&
      Number.isFinite(l.unitCost) &&
      l.unitCost >= 0
  );
}

/** Total units purchased across every batch. */
export function totalPurchased(lots: CostLot[] | undefined): number {
  return validLots(lots).reduce((n, l) => n + l.qty, 0);
}

/** Quantity-weighted average cost, or null when nothing usable is entered. */
export function averageUnitCost(lots: CostLot[] | undefined): number | null {
  const valid = validLots(lots);
  const units = valid.reduce((n, l) => n + l.qty, 0);
  if (units === 0) return null;
  return valid.reduce((sum, l) => sum + l.qty * l.unitCost, 0) / units;
}

export interface SkuStock {
  purchased: number; // from the cost lots you entered
  sold: number; // units on settled + estimated order lines
  onHand: number | null; // Walmart's count, null if inventory wasn't loaded
  /** purchased - sold: what your own records imply is left. */
  impliedOnHand: number;
  /**
   * Your implied stock minus Walmart's. Non-zero means the two disagree
   * - usually a missing or mistyped lot. Null when either side is
   * unknown. Deliberately advisory: real drift happens (damage,
   * returns, stock held but not listed), so this never blocks entry.
   */
  discrepancy: number | null;
}

export function reconcileStock(
  lots: CostLot[] | undefined,
  sold: number,
  onHand: number | null
): SkuStock {
  const purchased = totalPurchased(lots);
  const impliedOnHand = purchased - sold;
  return {
    purchased,
    sold,
    onHand,
    impliedOnHand,
    discrepancy:
      onHand === null || purchased === 0 ? null : impliedOnHand - onHand,
  };
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
    const { lots, boxCost } = inputs[normalizeSku(line.sku)] ?? {};
    const unitCost = averageUnitCost(lots);
    const hasCost = unitCost !== null;

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

/** Shipping cost as a share of revenue, past which a SKU gets flagged. */
export const SHIPPING_PCT_WARN = 0.15;
export const SHIPPING_PCT_ALERT = 0.25;

export interface SkuSummary {
  sku: string;
  itemName: string;
  units: number; // every line, including non-estimable ones
  lines: number;
  settledLines: number;
  estimatedLines: number;
  noEstimateLines: number;
  /** false => every money column must render "—", never $0.00. */
  hasMoney: boolean;
  unitsCounted: number; // units behind the money figures
  avgPrice: number | null;
  shippingPct: number | null;
  margin: number | null;
  missingCost: boolean;
  totals: ReturnType<typeof sumMargins>;
}

/**
 * One row per SKU, for "how is this product actually doing" rather than
 * per-order detail.
 *
 * Lines flagged noEstimate carry real revenue but placeholder zeros for
 * commission/shipping/net, so every money figure and ratio here comes
 * from the same filtered basis. Mixing an all-rows revenue with a
 * filtered profit would silently corrupt the margin. Unit and line
 * counts still cover everything, so a SKU's real activity stays visible
 * even when its fees can't be estimated.
 */
export function summarizeBySku(rows: MarginRow[]): SkuSummary[] {
  const bySku = new Map<string, MarginRow[]>();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = normalizeSku(row.sku);
    const group = bySku.get(key);
    if (group) group.push(row);
    else bySku.set(key, [row]);
  }

  const summaries: SkuSummary[] = [];
  for (const [sku, group] of bySku) {
    const counted = group.filter((r) => !r.noEstimate);
    const totals = sumMargins(counted);
    const unitsCounted = counted.reduce((n, r) => n + r.qty, 0);
    const hasMoney = counted.length > 0;

    summaries.push({
      sku,
      itemName: group.find((r) => r.itemName)?.itemName ?? "",
      units: group.reduce((n, r) => n + r.qty, 0),
      lines: group.length,
      settledLines: group.filter((r) => r.status === "settled").length,
      estimatedLines: group.filter(
        (r) => r.status === "estimated" && !r.noEstimate
      ).length,
      noEstimateLines: group.length - counted.length,
      hasMoney,
      unitsCounted,
      avgPrice: unitsCounted > 0 ? totals.revenue / unitsCounted : null,
      shippingPct:
        totals.revenue !== 0 ? -totals.shipping / totals.revenue : null,
      margin: totals.revenue !== 0 ? totals.profit / totals.revenue : null,
      missingCost: counted.some((r) => !r.hasCost),
      totals,
    });
  }

  // Revenue descending. Not profit: unentered costs inflate profit, so
  // that ordering would shuffle as costs get typed in.
  return summaries.sort((a, b) => b.totals.revenue - a.totals.revenue);
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
