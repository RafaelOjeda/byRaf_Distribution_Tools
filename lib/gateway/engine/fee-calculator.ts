import type { CostInputs, Snapshot, SnapshotData } from "../contract";
import type { FeeModel } from "./fee-model";
import {
  buildShippingSamples,
  matchCategory,
  predictFees,
  type FeePrediction,
  type FeeRequest,
} from "./fee-predict";
import { buildAliasIndex, resolveSku } from "./identity";
import { skuCost, type SkuInputs } from "./margins";
import { normalizeSku, type OrderLineSummary } from "./types";

/**
 * The "what would I make on this?" calculator: predicted fees for a price
 * you're considering, then profit and margin once your own cost is
 * included. Same prediction as unsettled-order estimates use, so the two
 * can never disagree about what a fee will be.
 */
export interface ListingRequest extends FeeRequest {
  /** What one unit costs you; null when unknown. */
  unitCost: number | null;
  /** Packaging per shipment; null when unknown. */
  boxCost: number | null;
}

export interface ListingEstimate {
  prediction: FeePrediction;
  revenue: number;
  unitCost: number | null;
  boxCost: number | null;
  /** null unless both fees and the unit cost are known. */
  profit: number | null;
  margin: number | null;
}

export function estimateListing(
  model: FeeModel,
  lines: OrderLineSummary[],
  costs: CostInputs,
  req: ListingRequest
): ListingEstimate {
  const samples = buildShippingSamples(
    lines.filter((l) => l.source === model.sourceId && l.status === "settled"),
    costs as Record<string, SkuInputs>,
    model.managedFulfillmentLabels
  );
  const prediction = predictFees(model, samples, req);
  const qty = Math.max(1, req.qty ?? 1);
  const revenue = req.price * qty;

  const known = prediction.net !== null && req.unitCost !== null;
  const profit = known
    ? prediction.net! - req.unitCost! * qty - (req.boxCost ?? 0)
    : null;
  return {
    prediction,
    revenue,
    unitCost: req.unitCost,
    boxCost: req.boxCost,
    profit,
    margin: profit !== null && revenue > 0 ? profit / revenue : null,
  };
}

/** What's already known about a SKU, to fill the calculator's fields. Every field is null when unknown. */
export interface SkuPrefill {
  price: number | null;
  categoryId: string | null;
  weightLb: number | null;
  unitCost: number | null;
  boxCost: number | null;
}

export function prefillFromSku(
  snapshot: Snapshot | null,
  model: FeeModel,
  costs: CostInputs,
  sku: string
): SkuPrefill {
  const key = normalizeSku(sku);
  const aliasIndex = buildAliasIndex(costs);
  const resolved = normalizeSku(resolveSku(sku, aliasIndex));

  const source = (snapshot as unknown as SnapshotData | null)?.sources.find(
    (s) => s.id === model.sourceId
  );
  const item = source?.catalog.find(
    (c) => normalizeSku(resolveSku(c.sku, aliasIndex)) === resolved
  );

  const inputs = (costs as Record<string, SkuInputs>)[key] ?? (costs as Record<string, SkuInputs>)[resolved];
  const cost = skuCost(inputs);
  return {
    price: item?.price ?? null,
    categoryId: inputs?.feeCategory ?? matchCategory(model, item?.categoryHint),
    weightLb: inputs?.weightLb ?? null,
    unitCost: cost.avgCost,
    boxCost: cost.boxCost,
  };
}
