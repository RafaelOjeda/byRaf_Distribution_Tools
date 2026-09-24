import "server-only";
import type { AccountCharge } from "../../contract";
import type { OrderLineSummary } from "../../engine/types";

/**
 * Fixed, in-memory data standing in for a real marketplace. This is the
 * abstraction's living test (docs/multi-marketplace-plan.md, "The demo
 * connector is the living test"): if the dashboard works fully against
 * this with no dashboard-side special cases, the MarketplaceConnector
 * boundary holds. Two periods, two SKUs, one of them shared with the
 * fixture SKUs a Walmart account might also carry (DEMO-WIDGET-1),
 * so per-SKU rollups have something real to combine across sources.
 */

export const DEMO_PERIODS = [
  { id: "2026-P1", label: "Sep 1 – Sep 14, 2026" },
  { id: "2026-P2", label: "Sep 15 – Sep 28, 2026" },
];

const SETTLED_LINES: Record<string, OrderLineSummary[]> = {
  "2026-P1": [
    {
      purchaseOrderNo: "D-10001",
      purchaseOrderLine: "1",
      sku: "DEMO-WIDGET-1",
      itemName: "Demo Widget",
      qty: 2,
      fulfillmentType: "Merchant",
      commissionRate: "10.0",
      status: "settled",
      noEstimate: false,
      postedDate: "2026-09-05",
      revenue: 40,
      commission: -4,
      shipping: -6,
      tax: 0,
      otherFees: 0,
      netAmount: 30,
    },
  ],
  "2026-P2": [
    {
      purchaseOrderNo: "D-10002",
      purchaseOrderLine: "1",
      sku: "DEMO-WIDGET-1",
      itemName: "Demo Widget",
      qty: 1,
      fulfillmentType: "Merchant",
      commissionRate: "10.0",
      status: "settled",
      noEstimate: false,
      postedDate: "2026-09-20",
      revenue: 20,
      commission: -2,
      shipping: -3,
      tax: 0,
      otherFees: 0,
      netAmount: 15,
    },
    {
      purchaseOrderNo: "D-10003",
      purchaseOrderLine: "1",
      sku: "DEMO-GADGET-2",
      itemName: "Demo Gadget",
      qty: 3,
      fulfillmentType: "Merchant",
      commissionRate: "12.0",
      status: "settled",
      noEstimate: false,
      postedDate: "2026-09-22",
      revenue: 90,
      commission: -10.8,
      shipping: -9,
      tax: 0,
      otherFees: 0,
      netAmount: 70.2,
    },
  ],
};

const CHARGES: Record<string, AccountCharge[]> = {
  "2026-P1": [
    {
      source: "demo",
      periodId: "2026-P1",
      kind: "storage",
      description: "Fulfillment center storage fee",
      amount: -4.5,
    },
  ],
  "2026-P2": [
    {
      source: "demo",
      periodId: "2026-P2",
      kind: "advertising",
      description: "Sponsored placement",
      amount: -12,
    },
  ],
};

export function settledForPeriods(periodIds: string[]) {
  const lines: OrderLineSummary[] = [];
  const charges: AccountCharge[] = [];
  for (const id of periodIds) {
    lines.push(...(SETTLED_LINES[id] ?? []));
    charges.push(...(CHARGES[id] ?? []));
  }
  return { lines, charges };
}

/** One unsettled order, always "recent" regardless of when this runs. */
export function recentOrder(): { lines: OrderLineSummary[]; orderDates: Record<string, string> } {
  const orderDate = new Date().toISOString().slice(0, 10);
  const line: OrderLineSummary = {
    purchaseOrderNo: "D-10004",
    purchaseOrderLine: "1",
    sku: "DEMO-WIDGET-1",
    itemName: "Demo Widget",
    qty: 1,
    fulfillmentType: "Merchant",
    commissionRate: "10.0",
    status: "estimated",
    noEstimate: false,
    estimateNote: "Estimated: commission at 10.0% and shipping at the average of 2 settled shipments",
    orderDate,
    revenue: 20,
    commission: -2,
    shipping: -4.5,
    tax: 0,
    otherFees: 0,
    netAmount: 13.5,
  };
  return {
    lines: [line],
    orderDates: { "D-10004::DEMO-WIDGET-1": orderDate },
  };
}

export const DEMO_STOCK = [
  { sku: "DEMO-WIDGET-1", onHand: 18, availToSell: 15, reserved: 3 },
  { sku: "DEMO-GADGET-2", onHand: 7, availToSell: 7, reserved: 0 },
];

export const DEMO_CATALOG = [
  { sku: "DEMO-WIDGET-1", price: 22.5, publishedStatus: "PUBLISHED" },
  { sku: "DEMO-GADGET-2", price: 32.0, publishedStatus: "PUBLISHED" },
];
