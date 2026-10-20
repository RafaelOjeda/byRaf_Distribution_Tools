import type { SnapshotSource } from "../contract";
import {
  buildShippingSamples,
  matchCategory,
  predictFees,
  type ShippingSample,
} from "./fee-predict";
import type { SkuInputs } from "./margins";
import { normalizeSku, type OrderLineSummary } from "./types";

/**
 * Second chance for estimated lines the connector couldn't estimate for
 * lack of settled history: predict their fees from the source's published
 * schedules instead. SKU history always wins - this only touches lines the
 * connector left flagged noEstimate - and a line stays flagged unless both
 * fees can be predicted, so a half-known net is never shown.
 *
 * Runs in buildReport (not in the connector) because the category and
 * weight it needs are typed in the dashboard after the snapshot is fetched.
 */
export function applyFeePredictions(
  lines: OrderLineSummary[],
  sources: SnapshotSource[],
  inputs: Record<string, SkuInputs>,
  resolveSku: (sku: string) => string
): OrderLineSummary[] {
  const bySource = new Map(sources.map((s) => [s.id, s]));
  const samplesCache = new Map<string, ShippingSample[]>();
  const hintsCache = new Map<string, Map<string, string | undefined>>();

  const samplesFor = (s: SnapshotSource): ShippingSample[] => {
    let samples = samplesCache.get(s.id);
    if (!samples) {
      samples = buildShippingSamples(
        lines.filter((l) => l.source === s.id && l.status === "settled"),
        inputs,
        s.feeModel?.managedFulfillmentLabels ?? []
      );
      samplesCache.set(s.id, samples);
    }
    return samples;
  };

  const hintFor = (s: SnapshotSource, sku: string): string | undefined => {
    let hints = hintsCache.get(s.id);
    if (!hints) {
      hints = new Map(
        s.catalog.map((c) => [normalizeSku(resolveSku(c.sku)), c.categoryHint])
      );
      hintsCache.set(s.id, hints);
    }
    return hints.get(normalizeSku(sku));
  };

  return lines.map((line) => {
    if (line.status !== "estimated" || !line.noEstimate || !line.sku) return line;
    const source = line.source ? bySource.get(line.source) : undefined;
    const model = source?.feeModel;
    if (!source || !model || line.qty <= 0 || line.revenue <= 0) return line;

    const sku = inputs[normalizeSku(line.sku)];
    const categoryId =
      sku?.feeCategory ?? matchCategory(model, hintFor(source, line.sku));
    const prediction = predictFees(model, samplesFor(source), {
      price: line.revenue / line.qty,
      qty: line.qty,
      categoryId,
      weightLb: sku?.weightLb ?? null,
      fulfillment: model.managedFulfillmentLabels.includes(line.fulfillmentType)
        ? "managed"
        : "self",
    });

    const { referral, shipping } = prediction;
    if (referral.fee === null || shipping.cost === null) {
      const missing = [
        referral.fee === null ? `referral fee (${referral.note})` : null,
        shipping.cost === null ? `shipping (${shipping.note})` : null,
      ].filter(Boolean);
      return {
        ...line,
        estimateNote: `${line.estimateNote ?? ""} - can't predict from schedules either: ${missing.join("; ")}`.trim(),
      };
    }

    const commission = -referral.fee;
    const shippingCost = -shipping.cost;
    const confidence = prediction.lowConfidence ? " - low confidence" : "";
    return {
      ...line,
      noEstimate: false,
      commission,
      shipping: shippingCost,
      commissionRate: ((referral.rate ?? 0) * 100).toFixed(1),
      netAmount: line.revenue + commission + shippingCost + line.otherFees,
      estimateNote: `Predicted, no settled history for this SKU: referral fee at ${((referral.rate ?? 0) * 100).toFixed(1)}% (${referral.note}); shipping ${shipping.note}${confidence}`,
    };
  });
}
