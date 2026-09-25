import { normalizeSku, type OrderLineSummary } from "../../engine/types";
import { settlementKey, type SkuHistory } from "../../engine/margins";
import type { Order } from "./orders";
import type { ReconRow } from "./recon";

/** Walmart sends MM/DD/YYYY; ISO sorts and compares correctly as a string. */
function toIsoDate(mdy: string | undefined): string | undefined {
  const m = mdy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
}

type Component = "revenue" | "commission" | "shipping" | "tax" | "otherFees";

/** A fraction as a 1-decimal percent number-string, e.g. 0.153 -> "15.3" - no "%", callers append their own. */
function pct1(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

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
 * (WFS storage fees becoming an `AccountCharge` the engine can show is
 * tracked as a known gap - see docs/multi-marketplace-plan.md.)
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

    const posted = toIsoDate(row["Transaction Posted Timestamp"]);
    if (posted && (!group.postedDate || posted < group.postedDate)) {
      group.postedDate = posted; // earliest row wins
    }

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

const SHIP_NODE_LABELS: Record<string, string> = {
  SellerFulfilled: "Seller Fulfilled",
  WFSFulfilled: "WFS",
};

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
        commissionRate: h ? pct1(h.commissionRate) : "",
        status: "estimated",
        noEstimate: !h,
        estimateNote: h
          ? `Estimated: commission at ${pct1(h.commissionRate)}% and shipping at the average of ${h.shipments} settled shipment${h.shipments === 1 ? "" : "s"}`
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
