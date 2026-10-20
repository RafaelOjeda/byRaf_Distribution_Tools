import type {
  FeeModel,
  ManagedFulfillmentTable,
  ReferralCategory,
} from "./fee-model";
import { normalizeSku, type OrderLineSummary } from "./types";

/**
 * Predicts the two fees that can't be known before an order settles: the
 * referral fee (a published percentage of price, by category) and shipping.
 * Own-label shipping is learned from the user's settled shipments, bucketed
 * by weight; a marketplace-managed service uses its published rate card.
 * Pure: no network, so the dashboard can call it on every keystroke.
 */

/** Upper edge (lb) of each shipping weight bucket; the last bucket has none. */
export const WEIGHT_BUCKET_EDGES_LB = [1, 2, 5, 10] as const;
/** Fewer settled shipments than this in a bucket and it is widened rather than trusted. */
export const MIN_BUCKET_SAMPLES = 3;

export function bucketIndex(weightLb: number): number {
  const i = WEIGHT_BUCKET_EDGES_LB.findIndex((edge) => weightLb <= edge);
  return i === -1 ? WEIGHT_BUCKET_EDGES_LB.length : i;
}

export function bucketLabel(index: number): string {
  const edges = WEIGHT_BUCKET_EDGES_LB;
  if (index === 0) return `up to ${edges[0]} lb`;
  if (index >= edges.length) return `over ${edges[edges.length - 1]} lb`;
  return `${edges[index - 1]}-${edges[index]} lb`;
}

export interface ShippingSample {
  weightLb: number; // total shipment weight
  cost: number; // positive
}

/** What's entered per SKU that the shipping history needs. */
export interface WeightInput {
  weightLb?: number;
}

/**
 * Settled own-label shipments with a known weight. A line only counts
 * when the SKU has a weight entered, the marketplace isn't the one
 * shipping, and a label cost was actually charged. Shipment weight is the
 * unit weight times the line's quantity.
 */
export function buildShippingSamples(
  settled: OrderLineSummary[],
  inputs: Record<string, WeightInput>,
  managedLabels: string[]
): ShippingSample[] {
  const samples: ShippingSample[] = [];
  for (const line of settled) {
    if (line.status !== "settled" || !line.sku || line.shipping >= 0) continue;
    if (managedLabels.includes(line.fulfillmentType)) continue;
    const unit = inputs[normalizeSku(line.sku)]?.weightLb;
    if (typeof unit !== "number" || !Number.isFinite(unit) || unit <= 0) continue;
    samples.push({ weightLb: unit * Math.max(1, line.qty), cost: -line.shipping });
  }
  return samples;
}

export type ReferralBasis = "category-table" | "none";
export type ShippingBasis =
  | "weight-bucket"
  | "widened-bucket"
  | "flat-average"
  | "rate-card"
  | "none";

export interface FeeRequest {
  /** Unit sale price. */
  price: number;
  qty?: number;
  categoryId: string | null;
  /** Weight of one unit. */
  weightLb: number | null;
  fulfillment: "self" | "managed";
}

export interface FeePrediction {
  referral: {
    fee: number | null;
    rate: number | null; // effective fraction of price
    basis: ReferralBasis;
    note: string;
    lowConfidence: boolean;
  };
  shipping: {
    cost: number | null; // positive
    basis: ShippingBasis;
    note: string;
    lowConfidence: boolean;
    samples: number;
  };
  /** price - referral - shipping; null when either fee is unknown. */
  net: number | null;
  lowConfidence: boolean;
}

export function findCategory(
  model: FeeModel,
  categoryId: string | null
): ReferralCategory | null {
  if (!categoryId) return null;
  return model.referral.categories.find((c) => c.id === categoryId) ?? null;
}

/** Suggests a category from a catalog item's category text, or null when nothing matches. */
export function matchCategory(model: FeeModel, hint: string | undefined): string | null {
  const h = (hint ?? "").trim().toLowerCase();
  if (!h) return null;
  for (const c of model.referral.categories) {
    if (c.aliases.some((a) => h.includes(a))) return c.id;
  }
  return null;
}

/** Referral fee on one item at `price`, by the category's schedule. */
export function referralFee(category: ReferralCategory, price: number): number {
  let fee = 0;
  if (category.mode === "marginal") {
    let floor = 0;
    for (const band of category.bands) {
      const ceiling = band.upTo ?? Infinity;
      if (price > floor) fee += (Math.min(price, ceiling) - floor) * band.rate;
      floor = ceiling;
    }
  } else {
    const band =
      category.bands.find((b) => b.upTo === null || price <= b.upTo) ??
      category.bands[category.bands.length - 1];
    fee = price * band.rate;
  }
  return Math.max(fee, category.minFee ?? 0);
}

export function managedFee(table: ManagedFulfillmentTable, weightLb: number): number | null {
  const tier = table.tiers.find((t) => t.upToLb === null || weightLb <= t.upToLb);
  if (!tier) return null;
  const over = tier.perLbOver;
  return tier.fee + (over && weightLb > over.fromLb ? (weightLb - over.fromLb) * over.rate : 0);
}

const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

function predictOwnShipping(
  samples: ShippingSample[],
  weightLb: number | null
): FeePrediction["shipping"] {
  if (samples.length === 0) {
    return {
      cost: null,
      basis: "none",
      note: "No settled shipments with a weight entered yet - nothing to estimate from",
      lowConfidence: true,
      samples: 0,
    };
  }
  const flat = () => ({
    cost: mean(samples.map((s) => s.cost)),
    basis: "flat-average" as const,
    note: `Average of all ${samples.length} settled shipment${samples.length === 1 ? "" : "s"}; no weight entered`,
    lowConfidence: true,
    samples: samples.length,
  });
  if (weightLb === null || !(weightLb > 0)) return flat();

  const target = bucketIndex(weightLb);
  const byBucket = (i: number) => samples.filter((s) => bucketIndex(s.weightLb) === i);

  const own = byBucket(target);
  if (own.length >= MIN_BUCKET_SAMPLES) {
    return {
      cost: mean(own.map((s) => s.cost)),
      basis: "weight-bucket",
      note: `Average of ${own.length} settled shipments at ${bucketLabel(target)}`,
      lowConfidence: false,
      samples: own.length,
    };
  }

  // Widen one bucket at a time on both sides until there is enough to average.
  for (let reach = 1; reach <= WEIGHT_BUCKET_EDGES_LB.length; reach++) {
    const lo = Math.max(0, target - reach);
    const hi = Math.min(WEIGHT_BUCKET_EDGES_LB.length, target + reach);
    const near = samples.filter((s) => {
      const b = bucketIndex(s.weightLb);
      return b >= lo && b <= hi;
    });
    if (near.length >= MIN_BUCKET_SAMPLES) {
      return {
        cost: mean(near.map((s) => s.cost)),
        basis: "widened-bucket",
        note: `Only ${own.length} settled at ${bucketLabel(target)}; averaged ${near.length} from ${bucketLabel(lo)} to ${bucketLabel(hi)}`,
        lowConfidence: true,
        samples: near.length,
      };
    }
  }
  return flat();
}

export function predictFees(
  model: FeeModel,
  samples: ShippingSample[],
  req: FeeRequest
): FeePrediction {
  const qty = Math.max(1, req.qty ?? 1);
  const price = req.price;

  const category = findCategory(model, req.categoryId);
  let referral: FeePrediction["referral"];
  if (category && price > 0) {
    const perItem = referralFee(category, price);
    referral = {
      fee: perItem * qty,
      rate: perItem / price,
      basis: "category-table",
      note: `${category.label} schedule${model.referral.lastVerified ? ` (checked ${model.referral.lastVerified})` : " (rates not yet verified)"}`,
      lowConfidence: model.referral.lastVerified === null,
    };
  } else {
    referral = {
      fee: null,
      rate: null,
      basis: "none",
      note: category
        ? "Enter a price to estimate the referral fee"
        : "No category chosen, or it isn't in the rate table",
      lowConfidence: true,
    };
  }

  let shipping: FeePrediction["shipping"];
  if (req.fulfillment === "managed") {
    const fee =
      model.managed && req.weightLb && req.weightLb > 0
        ? managedFee(model.managed, req.weightLb)
        : null;
    shipping =
      fee === null
        ? {
            cost: null,
            basis: "none",
            note: model.managed
              ? "Enter a weight to look up the fulfillment fee"
              : `${model.sourceLabel} fulfillment fees aren't loaded yet - not estimated`,
            lowConfidence: true,
            samples: 0,
          }
        : {
            cost: fee * qty,
            basis: "rate-card",
            note: `Published fulfillment rate card${model.managed?.lastVerified ? ` (checked ${model.managed.lastVerified})` : " (not yet verified)"}`,
            lowConfidence: model.managed?.lastVerified == null,
            samples: 0,
          };
  } else {
    // One label per shipment: qty raises the shipment's weight, not the label count.
    shipping = predictOwnShipping(
      samples,
      req.weightLb === null ? null : req.weightLb * qty
    );
  }

  const net =
    referral.fee === null || shipping.cost === null
      ? null
      : price * qty - referral.fee - shipping.cost;
  return {
    referral,
    shipping,
    net,
    lowConfidence: referral.lowConfidence || shipping.lowConfidence,
  };
}
