/**
 * Fixture regression check for the margin/price/stock engine. Pins the
 * dollar figures the app produces today against a hand-built fixture, so
 * the lib/gateway/ carve-out (docs/multi-marketplace-plan.md, phase 1)
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
  settlementKey,
  stockValue,
  summarizeBySku,
  sumMargins,
  type SkuInputs,
} from "../lib/gateway/engine/margins";
import { priceSeriesBySku } from "../lib/gateway/engine/prices";
import { buildReport } from "../lib/gateway/engine/report";
import { parseCostDrafts } from "../lib/gateway/engine/drafts";
import { normalizeSku } from "../lib/gateway/engine/types";
import { brandSnapshot, type CostInputs, type SnapshotData } from "../lib/gateway/contract";
import { buildAliasIndex, findPossibleDuplicates, resolveSku } from "../lib/gateway/engine/identity";
import {
  estimateUnsettled,
  groupReconRows,
} from "../lib/gateway/connectors/walmart/normalize";
import type { Order } from "../lib/gateway/connectors/walmart/orders";
import type { ReconRow } from "../lib/gateway/connectors/walmart/recon";

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

check("stockValue pools quantity across sources and flags oversell risk", () => {
  const inventory = [
    { sku: "widget-a", onHand: 8, source: "s1", sourceLabel: "Source 1" },
    { sku: "widget-b", onHand: 0 },
    { sku: "widget-d", onHand: 3 },
  ];
  const catalog = [
    { sku: "WIDGET-A", price: 29.99, publishedStatus: "PUBLISHED" },
    { sku: "WIDGET-D", price: 9.99, publishedStatus: "UNPUBLISHED" },
  ];
  const soldA = skuSummaries.find((s) => s.sku === "WIDGET-A")!.units; // 3
  const { rows, totals } = stockValue(inventory, catalog, costs, {
    "WIDGET-A": soldA,
  });

  // widget-b has cost batches entered (5 units, none sold in this fixture)
  // even though its own source reports 0 on hand - the pool figure is
  // your purchase records, not any one source's feed, so it still shows.
  assert.equal(rows.length, 3);
  const a = rows.find((r) => r.sku === "widget-a")!;
  // Pool: purchased 10 - sold 3 = 7. Not the raw inventory count (8).
  assert.equal(a.onHand, 7);
  assert.equal(a.onHandIsEstimate, false);
  assert.deepEqual(a.bySource, [
    { source: "s1", sourceLabel: "Source 1", onHand: 8, availToSell: null, reserved: null },
  ]);
  // A source claims 8 on hand but the pool only supports 7.
  assert.equal(a.oversellRisk, true);
  assert.equal(cents(a.valueAtCost ?? 0), 35); // 7 * 5
  assert.equal(cents(a.valueAtPrice ?? 0), 209.93); // 7 * 29.99

  const b = rows.find((r) => r.sku === "widget-b")!;
  assert.equal(b.onHand, 5); // purchased 5 - sold 0 (not passed in `sold`)
  assert.equal(b.onHandIsEstimate, false);
  assert.equal(b.oversellRisk, false); // source's 0 doesn't exceed the pool
  assert.equal(cents(b.valueAtCost ?? 0), 15); // 5 * 3
  assert.equal(b.valueAtPrice, null); // not in the catalog fixture

  const d = rows.find((r) => r.sku === "widget-d")!;
  // No cost batches entered for WIDGET-D: falls back to the source count.
  assert.equal(d.onHand, 3);
  assert.equal(d.onHandIsEstimate, true);
  assert.equal(d.oversellRisk, false);
  assert.equal(d.valueAtCost, null);

  assert.equal(totals.costedSkus, 2);
  assert.equal(totals.pricedSkus, 1);
  assert.equal(totals.unpublishedSkus, 1);
  assert.equal(totals.oversellSkus, 1);
  assert.equal(cents(totals.atCost), 50); // 35 + 15
  assert.equal(cents(totals.atPrice), 209.93);

  // The same record carries the reconciliation the inventory view shows.
  assert.equal(a.reported, 8);
  assert.equal(a.purchased, 10);
  assert.equal(a.sold, 3);
  assert.equal(a.left, 7);
  assert.equal(a.discrepancy, -1);
  assert.equal(d.left, null); // no batches: nothing to reconcile
  assert.equal(d.discrepancy, null);
});

check("buildAliasIndex/resolveSku merge an alias SKU into its canonical key", () => {
  const index = buildAliasIndex({
    "WIDGET-A": { aliasSkus: ["amz-widget-1", "EBAY WIDGET 1"] },
  });
  assert.equal(resolveSku("AMZ-Widget-1", index), "WIDGET-A");
  assert.equal(resolveSku("ebay widget 1", index), "WIDGET-A");
  // No alias declared: resolves to itself, untouched.
  assert.equal(resolveSku("WIDGET-Z", index), "WIDGET-Z");
});

check("findPossibleDuplicates flags near-matches without merging them", () => {
  const dupes = findPossibleDuplicates([
    { sku: "WIDGET-A", itemName: "Widget A" },
    { sku: "WIDGETA", itemName: "Different name entirely" }, // same stripped form
    { sku: "GADGET-1", itemName: "Widget A" }, // same item name, different SKU
    { sku: "WIDGET-B", itemName: "Widget B" }, // no match
  ]);
  assert.deepEqual(new Set(dupes.get("WIDGET-A")), new Set(["WIDGETA", "GADGET-1"]));
  assert.deepEqual(dupes.get("WIDGETA"), ["WIDGET-A"]);
  assert.equal(dupes.has("WIDGET-B"), false);
});

check("summarizeBySku surfaces possibleDuplicates per row", () => {
  const dupeMargins = computeMargins(
    assignSaleDates(
      [
        { ...settled[0], sku: "WIDGET-A" },
        { ...settled[0], sku: "WIDGETA", itemName: "Widget A clone" },
      ],
      {}
    ),
    {}
  );
  const summaries = summarizeBySku(dupeMargins);
  const a = summaries.find((s) => s.sku === "WIDGET-A")!;
  assert.deepEqual(a.possibleDuplicates, ["WIDGETA"]);
});

// ---------------------------------------------------------------------
// One source, many views: every per-product figure the dashboard shows
// is calculated once and read everywhere - see
// docs/tab-consolidation-plan.md, "Rule: one source, many views". If a
// second calculation path creeps in, one of these breaks.
// ---------------------------------------------------------------------
const twoSourceSnapshot = brandSnapshot<SnapshotData>({
  sources: [
    {
      id: "s1",
      label: "Source 1",
      status: "ok",
      lines: lines.map((l) => ({ ...l, source: "s1", sourceLabel: "Source 1" })),
      charges: [],
      orderDates: {},
      inventory: [
        { sku: "widget-a", onHand: 8, availToSell: 7, reserved: 1, source: "s1", sourceLabel: "Source 1" },
        { sku: "WIDGET-D", onHand: 3, availToSell: 3, reserved: 0, source: "s1", sourceLabel: "Source 1" },
      ],
      catalog: [{ sku: "WIDGET-A", price: 29.99, publishedStatus: "PUBLISHED" }],
    },
    {
      id: "s2",
      label: "Source 2",
      status: "ok",
      // Same product sold under the second source's own SKU, aliased below.
      lines: [{ ...settled[0], sku: "amz-widget-1", source: "s2", sourceLabel: "Source 2" }],
      charges: [],
      orderDates: {},
      // Listed last, and lower than source 1's count: the old dashboard
      // map kept whichever source came last, so it would have shown 6.
      inventory: [
        { sku: "AMZ-WIDGET-1", onHand: 6, availToSell: 6, reserved: 0, source: "s2", sourceLabel: "Source 2" },
      ],
      catalog: [],
    },
  ],
});
const sharedCosts: CostInputs = {
  "WIDGET-A": { ...costs["WIDGET-A"], aliasSkus: ["amz-widget-1"] },
  "WIDGET-B": costs["WIDGET-B"],
};
const report = buildReport(twoSourceSnapshot, sharedCosts, { sourceFilter: "all" });

check("products: one record per SKU sold or reported, aliases merged", () => {
  assert.deepEqual(
    report.products.map((p) => p.sku),
    ["WIDGET-A", "WIDGET-B", "WIDGET-C", "WIDGET-D"]
  );
});

check("products: every view reads the same objects, never a copy", () => {
  const stockRows = new Map(report.stock.rows.map((r) => [normalizeSku(r.sku), r]));
  for (const p of report.products) {
    const row = stockRows.get(p.sku);
    if (row) assert.equal(row, p.stock, `${p.sku}: stock row is the product's own record`);
    // The inventory view shows a value only where inStock is set; that must
    // be exactly the rows the stock totals add up.
    assert.equal(p.stock.inStock, row !== undefined, `${p.sku}: inStock matches the stock totals`);
    if (p.sales) assert.ok(report.bySku.includes(p.sales), `${p.sku}: sales is the bySku entry`);
    for (const line of p.orderLines) {
      assert.ok(report.orderLines.includes(line), `${p.sku}: order line is the report's own row`);
    }
  }
  assert.equal(
    report.products.reduce((n, p) => n + p.orderLines.length, 0),
    report.orderLines.filter((l) => l.sku).length
  );
});

check("products: a SKU's cost is the same number in every view", () => {
  for (const p of report.products) {
    assert.equal(p.stock.avgCost, p.cost.avgCost, `${p.sku}: stock value avg cost`);
    assert.equal(p.stock.purchased, p.cost.purchased, `${p.sku}: bought`);
    for (const line of p.orderLines) {
      assert.equal(line.hasCost, p.cost.avgCost !== null, `${p.sku}: line has cost`);
      if (p.cost.avgCost !== null) {
        assert.equal(cents(line.itemCostTotal), cents(p.cost.avgCost * line.qty), `${p.sku}: line item cost`);
      }
      assert.equal(line.boxCostTotal, p.cost.boxCost ?? 0, `${p.sku}: line box cost`);
    }
  }
});

check("products: name, sold and on hand agree across views", () => {
  for (const p of report.products) {
    assert.equal(p.name, p.sales?.itemName ?? "", `${p.sku}: name`);
    assert.equal(p.stock.sold, p.sales?.units ?? 0, `${p.sku}: sold`);
  }
  const a = report.products.find((p) => p.sku === "WIDGET-A")!;
  // Alias line from source 2 is part of WIDGET-A: 3 own + 1 aliased.
  assert.equal(a.sales?.units, 4);
  assert.ok(a.orderLines.some((l) => l.source === "s2"));
  // Reported = largest single-source count, not the last source's (6).
  assert.equal(a.stock.reported, 8);
  assert.deepEqual(
    a.stock.bySource.map((b) => [b.sourceLabel, b.onHand, b.availToSell, b.reserved]),
    [["Source 1", 8, 7, 1], ["Source 2", 6, 6, 0]]
  );
  // Pool: bought 10 - sold 4 = 6, and the inventory view's "Left" is the same figure.
  assert.equal(a.stock.onHand, 6);
  assert.equal(a.stock.left, 6);
  assert.equal(a.stock.discrepancy, -2);

  const c = report.products.find((p) => p.sku === "WIDGET-C")!;
  // Sold, but no source reports it: a record with no count, kept out of stock value.
  assert.equal(c.stock.reported, null);
  assert.ok(!report.stock.rows.includes(c.stock));
});

check("parseCostDrafts: typed text becomes the same inputs everywhere", () => {
  const parsed = parseCostDrafts({
    fields: { "WIDGET-A": { boxCost: "2" }, "WIDGET-B": { boxCost: "" } },
    lots: {
      "WIDGET-A": [
        { qty: "10", unitCost: "5" },
        { qty: "3", unitCost: "" }, // half-typed: ignored
      ],
    },
    aliases: { "WIDGET-A": "amz-widget-1; , EBAY-1" },
  });
  assert.deepEqual(parsed, {
    "WIDGET-A": {
      boxCost: 2,
      lots: [{ qty: 10, unitCost: 5 }],
      aliasSkus: ["amz-widget-1", "EBAY-1"],
    },
    "WIDGET-B": {},
  });
});

console.log(`\n${passed} check(s) passed.`);
