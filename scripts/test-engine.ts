/**
 * Fixture regression check for the margin/price/stock engine. Pins the
 * dollar figures the app produces today against a hand-built fixture, so
 * the lib/middleware/ carve-out (docs/multi-marketplace-plan.md, phase 1)
 * can be proven to change zero numbers.
 *
 * All fixture amounts are chosen so the arithmetic has no floating-point
 * surprises once rounded to cents - see `cents()` below.
 *
 * Run with: npx tsx scripts/test-engine.ts
 */
import assert from "node:assert/strict";
import {
  assignSaleDates,
  buildSkuHistory,
  computeMargins,
  reconcileStock,
  settlementKey,
  stockValue,
  summarizeBySku,
  sumMargins,
  type SkuInputs,
} from "../lib/middleware/engine/margins";
import { priceSeriesBySku } from "../lib/middleware/engine/prices";
import {
  estimateUnsettled,
  groupReconRows,
} from "../lib/middleware/connectors/walmart/normalize";
import type { Order } from "../lib/middleware/connectors/walmart/orders";
import type { ReconRow } from "../lib/middleware/connectors/walmart/recon";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/** Rounds to cents so a rewrite that reorders float ops still compares equal. */
const cents = (n: number) => Math.round(n * 100) / 100;

function row(fields: Partial<ReconRow> & Record<string, string>): ReconRow {
  return {
    "Transaction Key": "",
    "Transaction Type": "",
    "Amount Type": "",
    Amount: "0",
    "Purchase Order #": "",
    "Purchase Order line #": "",
    "Partner Item Id": "",
    "Partner Item Name": "",
    "Ship Qty": "",
    "Fulfillment Type": "",
    ...fields,
  };
}

// ---------------------------------------------------------------------
// Fixture: two settled WIDGET-A lines, one settled WIDGET-B line.
// ---------------------------------------------------------------------
const reconRows: ReconRow[] = [
  // WIDGET-A, PO 1000000000001, posted 2026-09-01
  row({
    "Purchase Order #": "1000000000001",
    "Purchase Order line #": "1",
    "Partner Item Id": "widget-a",
    "Partner Item Name": "Widget A",
    "Ship Qty": "1",
    "Fulfillment Type": "SellerFulfilled",
    "Commission Rate": "6.4",
    "Amount Type": "Product Price",
    Amount: "25.00",
    "Transaction Posted Timestamp": "09/01/2026",
    "Transaction Description": "Product Price",
  }),
  row({
    "Purchase Order #": "1000000000001",
    "Purchase Order line #": "1",
    "Amount Type": "Commission on Product",
    Amount: "-1.60",
    "Transaction Posted Timestamp": "09/01/2026",
    "Transaction Description": "Commission",
  }),
  row({
    "Purchase Order #": "1000000000001",
    "Purchase Order line #": "1",
    "Amount Type": "Fee/Reimbursement",
    Amount: "-4.00",
    "Transaction Posted Timestamp": "09/01/2026",
    "Transaction Description": "Shipping label charge",
  }),
  row({
    "Purchase Order #": "1000000000001",
    "Purchase Order line #": "1",
    "Amount Type": "Product tax collected",
    Amount: "2.00",
    "Transaction Posted Timestamp": "09/01/2026",
    "Transaction Description": "Tax collected",
  }),
  row({
    "Purchase Order #": "1000000000001",
    "Purchase Order line #": "1",
    "Amount Type": "Product tax withheld",
    Amount: "-2.00",
    "Transaction Posted Timestamp": "09/01/2026",
    "Transaction Description": "Tax withheld",
  }),

  // WIDGET-A, PO 1000000000002, posted 2026-09-03 (identical money to above)
  row({
    "Purchase Order #": "1000000000002",
    "Purchase Order line #": "1",
    "Partner Item Id": "widget-a",
    "Partner Item Name": "Widget A",
    "Ship Qty": "1",
    "Fulfillment Type": "SellerFulfilled",
    "Commission Rate": "6.4",
    "Amount Type": "Product Price",
    Amount: "25.00",
    "Transaction Posted Timestamp": "09/03/2026",
    "Transaction Description": "Product Price",
  }),
  row({
    "Purchase Order #": "1000000000002",
    "Purchase Order line #": "1",
    "Amount Type": "Commission on Product",
    Amount: "-1.60",
    "Transaction Posted Timestamp": "09/03/2026",
    "Transaction Description": "Commission",
  }),
  row({
    "Purchase Order #": "1000000000002",
    "Purchase Order line #": "1",
    "Amount Type": "Fee/Reimbursement",
    Amount: "-4.00",
    "Transaction Posted Timestamp": "09/03/2026",
    "Transaction Description": "Shipping label charge",
  }),

  // WIDGET-B, PO 1000000000003, posted 2026-09-02
  row({
    "Purchase Order #": "1000000000003",
    "Purchase Order line #": "1",
    "Partner Item Id": "widget-b",
    "Partner Item Name": "Widget B",
    "Ship Qty": "1",
    "Fulfillment Type": "WFSFulfilled",
    "Commission Rate": "8.0",
    "Amount Type": "Product Price",
    Amount: "10.00",
    "Transaction Posted Timestamp": "09/02/2026",
    "Transaction Description": "Product Price",
  }),
  row({
    "Purchase Order #": "1000000000003",
    "Purchase Order line #": "1",
    "Amount Type": "Commission on Product",
    Amount: "-0.80",
    "Transaction Posted Timestamp": "09/02/2026",
    "Transaction Description": "Commission",
  }),
  row({
    "Purchase Order #": "1000000000003",
    "Purchase Order line #": "1",
    "Amount Type": "Fee/Reimbursement",
    Amount: "-2.00",
    "Transaction Posted Timestamp": "09/02/2026",
    "Transaction Description": "Shipping label charge",
  }),
];

function order(
  purchaseOrderId: string,
  orderDate: number,
  shipNodeType: string,
  sku: string,
  amount: number
): Order {
  return {
    purchaseOrderId,
    orderDate,
    shipNode: { type: shipNodeType },
    orderLines: {
      orderLine: [
        {
          lineNumber: "1",
          item: { sku, productName: `${sku} item` },
          orderLineQuantity: { amount: "1" },
          charges: { charge: [{ chargeType: "PRODUCT", chargeAmount: { amount } }] },
          orderLineStatuses: {
            orderLineStatus: [{ status: "Shipped", statusQuantity: { amount: "1" } }],
          },
        },
      ],
    },
  };
}

const orders: Order[] = [
  // Unsettled, has WIDGET-A history to project from.
  order("2000000000001", Date.UTC(2026, 8, 20), "SellerFulfilled", "WIDGET-A", 25),
  // Unsettled, no settled history anywhere for WIDGET-C.
  order("2000000000002", Date.UTC(2026, 8, 21), "WFSFulfilled", "WIDGET-C", 15),
  // Same PO+SKU as the first settled recon row above - must be skipped by
  // estimateUnsettled, and its date must feed assignSaleDates' fallback.
  order("1000000000001", Date.UTC(2026, 8, 18), "SellerFulfilled", "WIDGET-A", 25),
];

const settled = groupReconRows(reconRows);
const history = buildSkuHistory(settled);
const settledKeys = new Set(
  settled.map((l) => settlementKey(l.purchaseOrderNo, l.sku))
);
const estimated = estimateUnsettled(orders, settledKeys, history);

const orderDates: Record<string, string> = {};
for (const o of orders) {
  const date = new Date(o.orderDate).toISOString().slice(0, 10);
  for (const line of o.orderLines.orderLine) {
    orderDates[settlementKey(o.purchaseOrderId, line.item.sku)] = date;
  }
}

const lines = assignSaleDates([...estimated, ...settled], orderDates);

const costs: Record<string, SkuInputs> = {
  "WIDGET-A": { lots: [{ qty: 10, unitCost: 5.0 }], boxCost: 2.0 },
  "WIDGET-B": { lots: [{ qty: 5, unitCost: 3.0 }], boxCost: 1.5 },
};

const margins = computeMargins(lines, costs);
const skuSummaries = summarizeBySku(margins);

check("buildSkuHistory pins commission rate and average shipping per SKU", () => {
  assert.equal(cents(history["WIDGET-A"].commissionRate * 100), 6.4);
  assert.equal(history["WIDGET-A"].avgShipping, -4);
  assert.equal(history["WIDGET-A"].shipments, 2);
  assert.equal(cents(history["WIDGET-B"].commissionRate * 100), 8);
});

check("estimateUnsettled skips the already-settled PO+SKU", () => {
  assert.equal(estimated.length, 2);
  assert.equal(
    estimated.some((l) => l.purchaseOrderNo === "1000000000001"),
    false
  );
});

check("estimateUnsettled projects fees from settled history", () => {
  const a = estimated.find((l) => l.purchaseOrderNo === "2000000000001")!;
  assert.equal(a.noEstimate, false);
  assert.equal(cents(a.commission), -1.6);
  assert.equal(cents(a.shipping), -4);
  assert.equal(cents(a.netAmount), 19.4);
});

check("estimateUnsettled flags a SKU with no settled history", () => {
  const c = estimated.find((l) => l.purchaseOrderNo === "2000000000002")!;
  assert.equal(c.noEstimate, true);
  assert.equal(c.commission, 0);
});

check("assignSaleDates prefers a real order date, else falls back to posted", () => {
  const settledA1 = lines.find(
    (l) => l.purchaseOrderNo === "1000000000001" && l.status === "settled"
  )!;
  assert.equal(settledA1.saleDate, "2026-09-18");
  assert.equal(settledA1.saleDateBasis, "order");

  const settledA2 = lines.find(
    (l) => l.purchaseOrderNo === "1000000000002" && l.status === "settled"
  )!;
  assert.equal(settledA2.saleDate, "2026-09-03");
  assert.equal(settledA2.saleDateBasis, "posted");
});

check("computeMargins: settled WIDGET-A line profit and margin", () => {
  const m = margins.find(
    (r) => r.purchaseOrderNo === "1000000000001" && r.status === "settled"
  )!;
  assert.equal(cents(m.netAmount), 19.4);
  assert.equal(cents(m.itemCostTotal), 5);
  assert.equal(cents(m.boxCostTotal), 2);
  assert.equal(cents(m.profit), 12.4);
  assert.equal(cents((m.margin ?? 0) * 100), 49.6);
});

check("computeMargins: uncosted noEstimate line is excluded from money totals downstream", () => {
  const c = margins.find((r) => r.sku === "WIDGET-C")!;
  assert.equal(c.noEstimate, true);
  assert.equal(c.hasCost, false);
});

check("summarizeBySku: WIDGET-A rolls up settled + estimated, sorted revenue first", () => {
  assert.equal(skuSummaries[0].sku, "WIDGET-A");
  const a = skuSummaries[0];
  assert.equal(a.units, 3);
  assert.equal(a.settledLines, 2);
  assert.equal(a.estimatedLines, 1);
  assert.equal(a.noEstimateLines, 0);
  assert.equal(cents(a.totals.revenue), 75);
  assert.equal(cents(a.totals.profit), 37.2);
  assert.equal(cents((a.margin ?? 0) * 100), 49.6);
});

check("summarizeBySku: WIDGET-C has no money (nothing to sum, not $0)", () => {
  const c = skuSummaries.find((s) => s.sku === "WIDGET-C")!;
  assert.equal(c.hasMoney, false);
  assert.equal(c.noEstimateLines, 1);
  assert.equal(c.avgPrice, null);
  assert.equal(c.margin, null);
});

check("sumMargins: settled vs estimated totals stay apart", () => {
  const settledTotals = sumMargins(margins.filter((m) => m.status === "settled"));
  const estimatedTotals = sumMargins(
    margins.filter((m) => m.status === "estimated" && !m.noEstimate)
  );
  assert.equal(cents(settledTotals.revenue), 60);
  assert.equal(cents(settledTotals.profit), 27.5);
  assert.equal(cents(estimatedTotals.revenue), 25);
  assert.equal(cents(estimatedTotals.profit), 12.4);
});

check("priceSeriesBySku: WIDGET-A has 3 sale days, flat price, 1 approx point", () => {
  const series = priceSeriesBySku(lines);
  // Display casing is "first seen": the estimated WIDGET-A line (uppercase
  // in the order fixture) is placed before the settled ones in `lines`.
  const a = series.find((s) => s.sku === "WIDGET-A")!;
  assert.equal(a.points.length, 3);
  assert.equal(a.units, 3);
  assert.equal(a.changePct, 0);
  assert.equal(a.approxPoints, 1);
});

check("priceSeriesBySku: ties in units break by SKU display name", () => {
  const series = priceSeriesBySku(lines);
  const names = series.map((s) => s.sku);
  assert.deepEqual(names, ["WIDGET-A", "widget-b", "WIDGET-C"]);
});

check("stockValue and reconcileStock pin stock figures", () => {
  const inventory = [
    { sku: "widget-a", onHand: 8 },
    { sku: "widget-b", onHand: 0 },
    { sku: "widget-d", onHand: 3 },
  ];
  const catalog = [
    { sku: "WIDGET-A", price: 29.99, publishedStatus: "PUBLISHED" },
    { sku: "WIDGET-D", price: 9.99, publishedStatus: "UNPUBLISHED" },
  ];
  const { rows, totals } = stockValue(inventory, catalog, costs);

  assert.equal(rows.length, 2); // widget-b's onHand=0 is excluded
  assert.equal(rows[0].sku, "widget-a");
  assert.equal(cents(rows[0].valueAtCost ?? 0), 40);
  assert.equal(cents(rows[0].valueAtPrice ?? 0), 239.92);
  assert.equal(totals.costedSkus, 1);
  assert.equal(totals.pricedSkus, 1);
  assert.equal(totals.unpublishedSkus, 1);
  assert.equal(cents(totals.atCost), 40);
  assert.equal(cents(totals.atPrice), 239.92);

  const soldA = skuSummaries.find((s) => s.sku === "WIDGET-A")!.units;
  const stock = reconcileStock(costs["WIDGET-A"].lots, soldA, 8);
  assert.equal(stock.purchased, 10);
  assert.equal(stock.impliedOnHand, 7);
  assert.equal(stock.discrepancy, -1);
});

console.log(`\n${passed} check(s) passed.`);
