/**
 * Checks for fee prediction (lib/gateway/engine/fee-predict.ts and
 * fee-fallback.ts): referral schedules, weight-bucketed shipping, the
 * fallback for estimated lines that have no settled history, and the
 * portable-file round trip of the weight/category inputs.
 *
 * Uses a fixture fee model, not the Walmart one, so the arithmetic stays
 * valid when the real rates are verified or changed.
 *
 * Run with: npx tsx scripts/test-fees.ts
 */
import assert from "node:assert/strict";
import { brandSnapshot, type SnapshotData } from "../lib/gateway/contract";
import type { FeeModel } from "../lib/gateway/engine/fee-model";
import {
  MIN_BUCKET_SAMPLES,
  buildShippingSamples,
  matchCategory,
  predictFees,
  referralFee,
  type ShippingSample,
} from "../lib/gateway/engine/fee-predict";
import { buildReport } from "../lib/gateway/engine/report";
import type { OrderLineSummary } from "../lib/gateway/engine/types";
import { WALMART_FEE_MODEL } from "../lib/gateway/connectors/walmart/fees";
import {
  exportCsvBundle,
  parseImportFile,
  type PortableData,
} from "../lib/gateway/engine/portable";

let passed = 0;
const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  const done = (ok: boolean, err?: unknown) => {
    if (ok) {
      passed++;
      console.log(`ok - ${name}`);
    } else {
      console.error(`FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  };
  try {
    const r = fn();
    if (r instanceof Promise) {
      pending.push(r.then(() => done(true), (e) => done(false, e)));
      return;
    }
    done(true);
  } catch (err) {
    done(false, err);
  }
}

const cents = (n: number) => Math.round(n * 100) / 100;

const MODEL: FeeModel = {
  sourceId: "mkt",
  sourceLabel: "Mkt",
  managedFulfillmentLabels: ["MWF"],
  referral: {
    sourceUrl: "https://example.test/fees",
    lastVerified: "2026-10-01",
    categories: [
      { id: "flat", label: "Flat", aliases: ["gadget"], mode: "flat", bands: [{ upTo: null, rate: 0.1 }] },
      {
        id: "tiered",
        label: "Tiered",
        aliases: ["apparel"],
        mode: "tiered",
        bands: [
          { upTo: 15, rate: 0.05 },
          { upTo: 20, rate: 0.1 },
          { upTo: null, rate: 0.15 },
        ],
      },
      {
        id: "marginal",
        label: "Marginal",
        aliases: ["jewel"],
        mode: "marginal",
        bands: [
          { upTo: 250, rate: 0.2 },
          { upTo: null, rate: 0.05 },
        ],
      },
      { id: "minfee", label: "Min fee", aliases: [], mode: "flat", bands: [{ upTo: null, rate: 0.08 }], minFee: 0.3 },
    ],
  },
  managed: {
    sourceUrl: "https://example.test/mwf",
    lastVerified: "2026-10-01",
    tiers: [
      { upToLb: 1, fee: 3 },
      { upToLb: 3, fee: 5 },
      { upToLb: null, fee: 8, perLbOver: { fromLb: 10, rate: 0.5 } },
    ],
  },
};
const cat = (id: string) => MODEL.referral.categories.find((c) => c.id === id)!;

const sample = (weightLb: number, cost: number): ShippingSample => ({ weightLb, cost });

// ---------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------
check("referral: flat rate on the whole price", () => {
  assert.equal(cents(referralFee(cat("flat"), 25)), 2.5);
});

check("referral: tiered rate applies to the whole price, boundaries inclusive", () => {
  assert.equal(cents(referralFee(cat("tiered"), 15)), 0.75); // 5% of 15
  assert.equal(cents(referralFee(cat("tiered"), 15.01)), 1.5); // 10% of 15.01
  assert.equal(cents(referralFee(cat("tiered"), 20)), 2);
  assert.equal(cents(referralFee(cat("tiered"), 40)), 6);
});

check("referral: marginal rate charges each slice of price at its own rate", () => {
  assert.equal(cents(referralFee(cat("marginal"), 100)), 20);
  assert.equal(cents(referralFee(cat("marginal"), 250)), 50);
  assert.equal(cents(referralFee(cat("marginal"), 300)), 52.5); // 50 + 5% of 50
});

check("referral: minimum fee applies to cheap items", () => {
  assert.equal(cents(referralFee(cat("minfee"), 2)), 0.3); // 8% = 0.16 < 0.30
  assert.equal(cents(referralFee(cat("minfee"), 10)), 0.8);
});

check("matchCategory: suggests from catalog text, null when nothing matches", () => {
  assert.equal(matchCategory(MODEL, "Electronics > Gadget Accessories"), "flat");
  assert.equal(matchCategory(MODEL, "APPAREL / Shirts"), "tiered");
  assert.equal(matchCategory(MODEL, "Pet Supplies"), null);
  assert.equal(matchCategory(MODEL, undefined), null);
  assert.equal(matchCategory(MODEL, "  "), null);
});

// ---------------------------------------------------------------------
// Shipping from history
// ---------------------------------------------------------------------
const own = (weightLb: number, cost: number, n: number) =>
  Array.from({ length: n }, () => sample(weightLb, cost));
const req = (over: Partial<Parameters<typeof predictFees>[2]> = {}) => ({
  price: 20,
  categoryId: "flat",
  weightLb: 1.5,
  fulfillment: "self" as const,
  ...over,
});

check("shipping: a bucket with enough shipments is trusted as-is", () => {
  const p = predictFees(MODEL, [...own(1.5, 4, 2), sample(1.2, 5), sample(9, 20)], req());
  assert.equal(p.shipping.basis, "weight-bucket");
  assert.equal(cents(p.shipping.cost!), cents((4 + 4 + 5) / 3));
  assert.equal(p.shipping.lowConfidence, false);
  assert.equal(p.shipping.samples, 3);
});

check("shipping: a thin bucket widens to neighbours and is flagged low-confidence", () => {
  const samples = [sample(1.5, 4), sample(0.5, 3), sample(3, 6)]; // 1 in-bucket, 2 adjacent
  const p = predictFees(MODEL, samples, req());
  assert.equal(p.shipping.basis, "widened-bucket");
  assert.equal(cents(p.shipping.cost!), cents((4 + 3 + 6) / 3));
  assert.equal(p.shipping.lowConfidence, true);
  assert.equal(p.lowConfidence, true);
});

check("shipping: too little data anywhere falls back to the flat average", () => {
  const p = predictFees(MODEL, [sample(9, 20), sample(0.4, 3)], req());
  assert.equal(p.shipping.basis, "flat-average");
  assert.equal(cents(p.shipping.cost!), 11.5);
  assert.equal(p.shipping.lowConfidence, true);
});

check("shipping: no weight entered uses the flat average, not a bucket", () => {
  const p = predictFees(MODEL, [...own(1.5, 4, 5)], req({ weightLb: null }));
  assert.equal(p.shipping.basis, "flat-average");
  assert.equal(p.shipping.cost, 4);
});

check("shipping: no history at all predicts nothing, and net is unknown", () => {
  const p = predictFees(MODEL, [], req());
  assert.equal(p.shipping.cost, null);
  assert.equal(p.shipping.basis, "none");
  assert.equal(p.net, null);
  assert.equal(p.referral.fee, 2); // referral still predicted
});

check("shipping: qty raises shipment weight, not the label count", () => {
  // 3 x 0.6 lb = 1.8 lb lands in the 1-2 lb bucket, not the up-to-1 lb one
  const samples = [...own(1.8, 7, 3), ...own(0.6, 3, 3)];
  const p = predictFees(MODEL, samples, req({ weightLb: 0.6, qty: 3 }));
  assert.equal(p.shipping.cost, 7);
  assert.equal(MIN_BUCKET_SAMPLES, 3);
});

check("buildShippingSamples: only own-label settled lines with a weight and a charged label", () => {
  const line = (over: Partial<OrderLineSummary>): OrderLineSummary => ({
    purchaseOrderNo: "1",
    purchaseOrderLine: "1",
    sku: "A",
    itemName: "",
    qty: 1,
    fulfillmentType: "Seller Fulfilled",
    commissionRate: "",
    status: "settled",
    noEstimate: false,
    revenue: 20,
    commission: -2,
    shipping: -4,
    tax: 0,
    otherFees: 0,
    netAmount: 14,
    ...over,
  });
  const samples = buildShippingSamples(
    [
      line({}), // counts
      line({ qty: 2 }), // counts, double weight
      line({ fulfillmentType: "MWF" }), // marketplace-shipped
      line({ shipping: 0 }), // no label charged
      line({ sku: "NOWEIGHT" }), // no weight entered
      line({ status: "estimated" }), // not settled
      line({ sku: "" }), // no sku
    ],
    { A: { weightLb: 1.5 } },
    MODEL.managedFulfillmentLabels
  );
  assert.deepEqual(samples, [
    { weightLb: 1.5, cost: 4 },
    { weightLb: 3, cost: 4 },
  ]);
});

// ---------------------------------------------------------------------
// Managed fulfillment
// ---------------------------------------------------------------------
check("managed: looks up the rate card, including the per-lb surcharge", () => {
  const m = (w: number) =>
    predictFees(MODEL, [], req({ fulfillment: "managed", weightLb: w, price: 30 }));
  assert.equal(m(0.5).shipping.cost, 3);
  assert.equal(m(2).shipping.cost, 5);
  assert.equal(m(12).shipping.cost, 8 + 2 * 0.5);
  assert.equal(m(2).shipping.basis, "rate-card");
});

check("managed: with no rate card it says so rather than guessing", () => {
  const p = predictFees({ ...MODEL, managed: null }, [], req({ fulfillment: "managed" }));
  assert.equal(p.shipping.cost, null);
  assert.match(p.shipping.note, /not estimated/);
});

check("an unverified rate table marks the prediction low-confidence", () => {
  const unverified = { ...MODEL, referral: { ...MODEL.referral, lastVerified: null } };
  const p = predictFees(unverified, own(1.5, 4, 3), req());
  assert.equal(p.referral.lowConfidence, true);
  assert.equal(p.lowConfidence, true);
  assert.match(p.referral.note, /not yet verified/);
});

check("the shipped Walmart table is flagged unverified until someone checks it", () => {
  assert.equal(WALMART_FEE_MODEL.referral.lastVerified, null);
  assert.equal(WALMART_FEE_MODEL.managed, null);
});

// ---------------------------------------------------------------------
// Fallback for estimated lines with no settled history (via buildReport)
// ---------------------------------------------------------------------
const settledLine = (po: string, sku: string): OrderLineSummary => ({
  source: "mkt",
  sourceLabel: "Mkt",
  purchaseOrderNo: po,
  purchaseOrderLine: "1",
  sku,
  itemName: sku,
  qty: 1,
  fulfillmentType: "Seller Fulfilled",
  commissionRate: "10.0",
  status: "settled",
  noEstimate: false,
  revenue: 20,
  commission: -2,
  shipping: -4,
  tax: 0,
  otherFees: 0,
  netAmount: 14,
});
const unsettled = (sku: string, fulfillmentType = "Seller Fulfilled"): OrderLineSummary => ({
  source: "mkt",
  sourceLabel: "Mkt",
  purchaseOrderNo: `U-${sku}`,
  purchaseOrderLine: "1",
  sku,
  itemName: sku,
  qty: 1,
  fulfillmentType,
  commissionRate: "",
  status: "estimated",
  noEstimate: true,
  estimateNote: "No settled history for this SKU yet - nothing to estimate from",
  orderDate: "2026-10-10",
  revenue: 30,
  commission: 0,
  shipping: 0,
  tax: 0,
  otherFees: 0,
  netAmount: 30,
});

function reportFor(
  lines: OrderLineSummary[],
  costs: Parameters<typeof buildReport>[1],
  catalog: SnapshotData["sources"][number]["catalog"] = []
) {
  return buildReport(
    brandSnapshot<SnapshotData>({
      sources: [
        {
          id: "mkt",
          label: "Mkt",
          status: "ok",
          lines,
          charges: [],
          orderDates: {},
          inventory: [],
          catalog,
          feeModel: MODEL,
        },
      ],
    }),
    costs,
    { sourceFilter: "all" }
  );
}

// History: three 1.5 lb shipments of HIST at $4 each.
const historyLines = ["h1", "h2", "h3"].map((po) => settledLine(po, "HIST"));
const historyCosts = { HIST: { weightLb: 1.5 } };

check("fallback: a no-history line is predicted from the schedules and learned shipping", () => {
  const r = reportFor([...historyLines, unsettled("NEW")], {
    ...historyCosts,
    NEW: { weightLb: 1.5, feeCategory: "flat" },
  });
  const line = r.orderLines.find((l) => l.sku === "NEW")!;
  assert.equal(line.noEstimate, false);
  assert.equal(cents(line.commission), -3); // 10% of 30
  assert.equal(cents(line.shipping), -4);
  assert.equal(cents(line.netAmount), 23);
  assert.equal(line.commissionRate, "10.0");
  assert.match(line.estimateNote!, /Predicted/);
  assert.equal(r.noEstimateCount, 0);
});

check("fallback: category is suggested from the catalog when the user hasn't picked one", () => {
  const r = reportFor(
    [...historyLines, unsettled("NEW")],
    { ...historyCosts, NEW: { weightLb: 1.5 } },
    [{ sku: "NEW", price: 30, publishedStatus: "PUBLISHED", categoryHint: "Gadget Accessories" }]
  );
  assert.equal(r.orderLines.find((l) => l.sku === "NEW")!.noEstimate, false);
});

check("fallback: a user-chosen category beats the catalog suggestion", () => {
  const r = reportFor(
    [...historyLines, unsettled("NEW")],
    { ...historyCosts, NEW: { weightLb: 1.5, feeCategory: "tiered" } },
    [{ sku: "NEW", price: 30, publishedStatus: "PUBLISHED", categoryHint: "Gadget" }]
  );
  const line = r.orderLines.find((l) => l.sku === "NEW")!;
  assert.equal(cents(line.commission), -4.5); // tiered: 15% of 30, not flat 10%
});

check("fallback: stays unestimated, with the reason, when a fee can't be predicted", () => {
  const noCategory = reportFor([...historyLines, unsettled("NEW")], {
    ...historyCosts,
    NEW: { weightLb: 1.5 },
  });
  const a = noCategory.orderLines.find((l) => l.sku === "NEW")!;
  assert.equal(a.noEstimate, true);
  assert.equal(a.commission, 0);
  assert.match(a.estimateNote!, /referral fee/);

  const noHistory = reportFor([unsettled("NEW")], { NEW: { weightLb: 1.5, feeCategory: "flat" } });
  const b = noHistory.orderLines.find((l) => l.sku === "NEW")!;
  assert.equal(b.noEstimate, true);
  assert.match(b.estimateNote!, /shipping/);
  assert.equal(noHistory.noEstimateCount, 1);
});

check("fallback: a SKU with its own settled history keeps the connector's estimate untouched", () => {
  const withHistory: OrderLineSummary = {
    ...unsettled("HIST"),
    noEstimate: false,
    commission: -3.3,
    shipping: -4,
    netAmount: 22.7,
    estimateNote: "Estimated: commission at 11.0% ...",
  };
  const r = reportFor([...historyLines, withHistory], historyCosts);
  const line = r.orderLines.find((l) => l.status === "estimated")!;
  assert.equal(line.commission, -3.3);
  assert.equal(line.estimateNote, "Estimated: commission at 11.0% ...");
});

check("fallback: a source without a fee model leaves lines alone", () => {
  const r = buildReport(
    brandSnapshot<SnapshotData>({
      sources: [
        {
          id: "mkt",
          label: "Mkt",
          status: "ok",
          lines: [unsettled("NEW")],
          charges: [],
          orderDates: {},
          inventory: [],
          catalog: [],
        },
      ],
    }),
    { NEW: { weightLb: 1.5, feeCategory: "flat" } },
    { sourceFilter: "all" }
  );
  assert.equal(r.orderLines[0].noEstimate, true);
});

check("fallback: managed fulfillment lines use the rate card", () => {
  const r = reportFor([unsettled("W", "MWF")], { W: { weightLb: 2, feeCategory: "flat" } });
  const line = r.orderLines[0];
  assert.equal(line.noEstimate, false);
  assert.equal(cents(line.shipping), -5);
});

// ---------------------------------------------------------------------
// Weight and category survive the save/load file
// ---------------------------------------------------------------------
check("portable: weight and fee category round-trip through the CSV bundle", async () => {
  const data: PortableData = {
    inputs: {
      A: { boxCost: 0.5, weightLb: 1.25, feeCategory: "flat" },
      B: { weightLb: 3 },
      C: { feeCategory: "tiered" },
    },
    settings: { sourceFilter: "all", selectedPeriods: {} },
  };
  const result = await parseImportFile(await exportCsvBundle(data));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data.inputs, data.inputs);
});

Promise.all(pending).then(() => console.log(`\n${passed} check(s) passed.`));
