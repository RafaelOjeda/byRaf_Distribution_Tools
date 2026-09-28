import { normalizeSku, type OrderLineSummary } from "../../engine/types";
import { settlementKey, type SkuHistory } from "../../engine/margins";
import type { AccountCharge } from "../../contract";
import type { Order } from "./orders";
import type { ReconRow } from "./recon";

/** Walmart sends MM/DD/YYYY; ISO sorts and compares correctly as a string. */
function toIsoDate(mdy: string | undefined): string | undefined {
  const m = mdy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
}

type Component =
  | "revenue"
  | "commission"
  | "shipping"
  | "tax"
  | "otherFees"
  | "refunds";

/**
 * Matches Walmart's documented refund/return vocabulary as best we can
 * guess it, since no refund or return row has ever actually been observed
 * against a live account (see docs/walmart-api-notes.md, "Still
 * unverified"). Checked ahead of the "Product Price"/"Commission on
 * Product" matches below so a refund that reuses those same Amount Type
 * labels (reversing a sale rather than adding a new one) lands in
 * `refunds`, not back in revenue/commission - which would otherwise skew
 * buildSkuHistory's commission-rate learning for that SKU.
 */
function isRefundLike(transactionType: string, amountType: string, description: string): boolean {
  return /refund|return/i.test(`${transactionType} ${amountType} ${description}`);
}

/**
 * Categories confirmed against live settlement data 2026-09-23, except
 * `refunds` (best-effort - see `isRefundLike`). Shipping is matched on
 * description rather than Amount Type, because Walmart files label
 * charges under the generic "Fee/Reimbursement" type.
 */
function classify(
  transactionType: string,
  amountType: string,
  description: string
): Component {
  if (isRefundLike(transactionType, amountType, description)) return "refunds";
  if (amountType === "Product Price") return "revenue";
  if (amountType === "Commission on Product") return "commission";
  if (amountType.startsWith("Product tax")) return "tax";
  if (/shipping/i.test(description)) return "shipping";
  return "otherFees";
}

/**
 * Groups raw recon rows into one summary per order line, plus any
 * account-level charge that doesn't belong to one. Rows with no Purchase
 * Order # used to be dropped outright; now only the account-level deposit
 * summary row (`PaymentSummary`, which carries no order info at all) is
 * skipped, and everything else PO-less - WFS storage fees, and any
 * refund/return adjustment that isn't tied back to an order line - becomes
 * an `AccountCharge` instead of silently vanishing. There's no live
 * signal yet to tell a PO-less refund apart from a PO-less storage fee,
 * so all of them land under the generic "adjustment" kind for now (see
 * docs/multi-marketplace-plan.md, "AccountCharge closes a known gap").
 */
export function groupReconRows(
  rows: ReconRow[]
): { lines: OrderLineSummary[]; charges: AccountCharge[] } {
  const groups = new Map<string, OrderLineSummary>();
  const charges: AccountCharge[] = [];

  for (const row of rows) {
    const po = row["Purchase Order #"];
    const line = row["Purchase Order line #"];
    const amount = parseFloat(row["Amount"]) || 0;

    if (!po || !line) {
      if (row["Transaction Type"] !== "PaymentSummary") {
        charges.push({
          source: "walmart",
          // A raw row doesn't say which settlement file it came from, so
          // this is the row's own posted date, not the MMDDYYYY period id
          // listPeriods() hands out - close enough for display, not for
          // matching back to a specific period.
          periodId: toIsoDate(row["Transaction Posted Timestamp"]) ?? "",
          kind: "adjustment",
          description:
            row["Transaction Description"] || row["Amount Type"] || "Adjustment",
          amount,
        });
      }
      continue;
    }

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
        refunds: 0,
        netAmount: 0,
      };
      groups.set(key, group);
    }

    group[
      classify(row["Transaction Type"], row["Amount Type"], row["Transaction Description"])
    ] += amount;
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

  return { lines: [...groups.values()], charges };
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
        // Returns happen after delivery, which is after settlement in
        // every case observed so far, so an unsettled order has no refund
        // signal to read from the Orders API.
        refunds: 0,
        netAmount: revenue + commission + shipping + otherFees,
      });
    }
  }

  return out;
}
