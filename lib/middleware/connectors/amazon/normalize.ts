import type { AccountCharge } from "../../contract";
import { settlementKey, type SkuHistory } from "../../engine/margins";
import { normalizeSku, type OrderLineSummary } from "../../engine/types";
import type {
  AdjustmentEvent,
  FinancialEvents,
  ServiceFeeEvent,
  ShipmentEvent,
  ShipmentItem,
} from "./finances";
import type { Order, OrderItem } from "./orders";

/**
 * Raw Finances/Orders API shapes -> OrderLineSummary/AccountCharge.
 * UNVERIFIED against a live account - see docs/amazon-connector-plan.md
 * and docs/amazon-api-notes.md. Every classification below has a
 * catch-all fallback (otherFees / "other") so an unrecognized fee type
 * is never silently dropped, the same pattern as Walmart's classify()
 * in connectors/walmart/normalize.ts - the engine only requires that
 * revenue + commission + shipping + tax + otherFees === netAmount, not
 * that any one category is exactly right.
 */

type Component = "revenue" | "commission" | "shipping" | "tax" | "otherFees";

function classifyCharge(chargeType: string | undefined): Component {
  if (chargeType === "Principal") return "revenue";
  if (chargeType && /tax/i.test(chargeType)) return "tax";
  return "otherFees";
}

function classifyFee(feeType: string | undefined): Component {
  if (!feeType) return "otherFees";
  if (feeType === "Commission") return "commission";
  if (feeType.startsWith("FBA") || /shipping/i.test(feeType)) return "shipping";
  return "otherFees";
}

function classifyServiceFeeKind(reason: string | undefined): AccountCharge["kind"] {
  if (!reason) return "other";
  if (/storage/i.test(reason)) return "storage";
  if (/subscription/i.test(reason)) return "subscription";
  if (/advertis|sponsor/i.test(reason)) return "advertising";
  return "other";
}

const moneyOf = (m?: { CurrencyAmount?: number }): number => m?.CurrencyAmount ?? 0;

/**
 * One OrderLineSummary per shipment/refund item. `sign` is -1 for a
 * refund so its money nets against the original sale, per
 * docs/amazon-connector-plan.md's refund-handling note - emitted as its
 * own line rather than merged into the original, so money is never lost
 * even when the original line isn't in the same batch.
 */
function lineFromShipmentItem(
  orderId: string,
  postedDate: string | undefined,
  item: ShipmentItem,
  sign: 1 | -1
): OrderLineSummary | null {
  const sku = item.SellerSKU;
  if (!sku) return null;

  let revenue = 0;
  let commission = 0;
  let shipping = 0;
  let tax = 0;
  let otherFees = 0;

  for (const c of item.ItemChargeList ?? []) {
    const amount = moneyOf(c.ChargeAmount) * sign;
    const bucket = classifyCharge(c.ChargeType);
    if (bucket === "revenue") revenue += amount;
    else if (bucket === "tax") tax += amount;
    else otherFees += amount;
  }
  for (const f of item.ItemFeeList ?? []) {
    const amount = moneyOf(f.FeeAmount) * sign;
    const bucket = classifyFee(f.FeeType);
    if (bucket === "commission") commission += amount;
    else if (bucket === "shipping") shipping += amount;
    else otherFees += amount;
  }

  return {
    purchaseOrderNo: orderId,
    purchaseOrderLine: item.OrderItemId ?? "",
    sku,
    // Financial events don't carry an item title - only the Orders API
    // does, and fetchSettled has no access to it (see
    // docs/amazon-connector-plan.md). Left blank rather than guessed;
    // the UI already renders a blank item name gracefully.
    itemName: "",
    qty: item.QuantityShipped ?? 1,
    fulfillmentType: "",
    commissionRate: "",
    status: "settled",
    noEstimate: false,
    postedDate: postedDate?.slice(0, 10),
    revenue,
    commission,
    shipping,
    tax,
    otherFees,
    netAmount: revenue + commission + shipping + tax + otherFees,
  };
}

function chargesFromServiceFeeEvents(
  events: ServiceFeeEvent[],
  periodId: string
): AccountCharge[] {
  return events.map((e) => ({
    source: "amazon",
    periodId,
    kind: classifyServiceFeeKind(e.FeeReason),
    description: e.FeeReason ?? "Service fee",
    amount: (e.FeeList ?? []).reduce((n, f) => n + moneyOf(f.FeeAmount), 0),
  }));
}

function chargesFromAdjustmentEvents(
  events: AdjustmentEvent[],
  periodId: string
): AccountCharge[] {
  return events.map((e) => ({
    source: "amazon",
    periodId,
    kind: "adjustment" as const,
    description: e.AdjustmentType ?? "Adjustment",
    amount: moneyOf(e.AdjustmentAmount),
  }));
}

export function linesFromFinancialEvents(
  events: FinancialEvents,
  periodId: string
): { lines: OrderLineSummary[]; charges: AccountCharge[] } {
  const lines: OrderLineSummary[] = [];

  for (const shipment of events.ShipmentEventList ?? []) {
    for (const item of shipment.ShipmentItemList ?? []) {
      const line = lineFromShipmentItem(
        shipment.AmazonOrderId ?? "",
        shipment.PostedDate,
        item,
        1
      );
      if (line) lines.push(line);
    }
  }

  for (const refund of events.RefundEventList ?? []) {
    // Confirm live which list name a real refund event actually
    // populates - docs/amazon-connector-plan.md flags this.
    const items: ShipmentEvent["ShipmentItemList"] =
      refund.ShipmentItemList ?? refund.ShipmentItemAdjustmentList ?? [];
    for (const item of items ?? []) {
      const line = lineFromShipmentItem(
        refund.AmazonOrderId ?? "",
        refund.PostedDate,
        item,
        -1
      );
      if (line) lines.push(line);
    }
  }

  const charges = [
    ...chargesFromServiceFeeEvents(events.ServiceFeeEventList ?? [], periodId),
    ...chargesFromAdjustmentEvents(events.AdjustmentEventList ?? [], periodId),
  ];

  return { lines, charges };
}

/**
 * Turns orders not yet in a financial event group into estimated line
 * summaries, projecting fees from settled history - same pattern as
 * connectors/walmart/normalize.ts::estimateUnsettled, reusing the
 * engine's buildSkuHistory/settlementKey unchanged.
 */
export function estimateUnsettledAmazon(
  orders: Order[],
  orderItemsByOrder: Map<string, OrderItem[]>,
  settledKeys: Set<string>,
  history: Record<string, SkuHistory>
): OrderLineSummary[] {
  const out: OrderLineSummary[] = [];

  for (const order of orders) {
    if (order.OrderStatus === "Canceled") continue;

    for (const item of orderItemsByOrder.get(order.AmazonOrderId) ?? []) {
      const sku = item.SellerSKU;
      if (!sku) continue;
      if (settledKeys.has(settlementKey(order.AmazonOrderId, sku))) continue;

      const qty = item.QuantityOrdered ?? 0;
      if (qty === 0) continue;
      const revenue = item.ItemPrice?.Amount ?? 0;

      const h = history[normalizeSku(sku)];
      const commission = h ? -revenue * h.commissionRate : 0;
      const shipping = h ? h.avgShipping : 0;

      out.push({
        purchaseOrderNo: order.AmazonOrderId,
        purchaseOrderLine: item.OrderItemId,
        sku,
        itemName: item.Title ?? "",
        qty,
        fulfillmentType: "Merchant", // Orders API's fulfillment channel isn't read yet - see docs/amazon-connector-plan.md
        commissionRate: h ? (h.commissionRate * 100).toFixed(1) : "",
        status: "estimated",
        noEstimate: !h,
        estimateNote: h
          ? `Estimated: commission at ${(h.commissionRate * 100).toFixed(1)}% and shipping at the average of ${h.shipments} settled shipment${h.shipments === 1 ? "" : "s"}`
          : "No settled history for this SKU yet - nothing to estimate from",
        orderDate: order.PurchaseDate.slice(0, 10),
        revenue,
        commission,
        shipping,
        tax: 0,
        otherFees: 0,
        netAmount: revenue + commission + shipping,
      });
    }
  }

  return out;
}
