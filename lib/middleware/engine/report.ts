import type {
  CostInputs,
  Report,
  ReportView,
  Snapshot,
  SnapshotData,
  SourceStatus,
} from "../contract";
import { assignSaleDates, computeMargins, stockValue, summarizeBySku, sumMargins } from "./margins";
import type { SkuInputs } from "./margins";
import { buildAliasIndex, resolveSku } from "./identity";
import { priceSeriesBySku } from "./prices";
import type { OrderLineSummary } from "./types";

function toSkuInputs(costs: CostInputs): Record<string, SkuInputs> {
  const out: Record<string, SkuInputs> = {};
  for (const [sku, c] of Object.entries(costs)) {
    out[sku] = {
      lots: c.lots,
      boxCost: c.boxCost,
      boxLength: c.boxLength,
      boxWidth: c.boxWidth,
      boxHeight: c.boxHeight,
      aliasSkus: c.aliasSkus,
    };
  }
  return out;
}

/** narrows the opaque Snapshot brand back to its real data - buildReport is the one place allowed to. */
function unwrap(snapshot: Snapshot): SnapshotData {
  return snapshot as unknown as SnapshotData;
}

/**
 * Turns a fetched snapshot + entered costs + view filters into finished,
 * display-ready figures. Pure: no network, no secrets, so the dashboard
 * can call this on every cost edit and it's still instant - see
 * docs/multi-marketplace-plan.md, "Two steps: fetch, then compute".
 */
export function buildReport(
  snapshot: Snapshot,
  costs: CostInputs,
  view: ReportView
): Report {
  const data = unwrap(snapshot);
  const included =
    view.sourceFilter === "all"
      ? data.sources
      : data.sources.filter((s) => view.sourceFilter.includes(s.id));

  const sources: SourceStatus[] = data.sources.map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status,
    error: s.error,
  }));

  const notes: string[] = [];
  for (const s of data.sources) {
    if (s.status === "error") {
      notes.push(`${s.label} failed to load: ${s.error ?? "unknown error"}`);
    }
  }

  const orderDates: Record<string, string> = {};
  for (const s of included) Object.assign(orderDates, s.orderDates);

  // Alias resolution happens before any grouping - every SKU-keyed
  // lookup downstream (computeMargins, summarizeBySku, stockValue,
  // priceSeriesBySku) sees the resolved identity. See
  // docs/multi-marketplace-plan.md, "Product identity (phase 4, engine)".
  const aliasIndex = buildAliasIndex(costs);
  const resolveLine = (l: OrderLineSummary): OrderLineSummary =>
    l.sku ? { ...l, sku: resolveSku(l.sku, aliasIndex) } : l;

  const rawLines = included.flatMap((s) => s.lines).map(resolveLine);
  const lines = assignSaleDates(rawLines, orderDates);

  const skuInputs = toSkuInputs(costs);
  const margins = computeMargins(lines, skuInputs);
  const bySku = summarizeBySku(margins);
  const priceSeries = priceSeriesBySku(lines);

  const inventory = included
    .flatMap((s) => s.inventory)
    .map((i) => ({ ...i, sku: resolveSku(i.sku, aliasIndex) }));
  const catalog = included
    .flatMap((s) => s.catalog)
    .map((c) => ({ ...c, sku: resolveSku(c.sku, aliasIndex) }));
  const sold = Object.fromEntries(bySku.map((s) => [s.sku, s.units]));
  const stock = stockValue(inventory, catalog, skuInputs, sold);

  const marketplaceFees = included.flatMap((s) => s.charges);

  const settled = margins.filter((m) => m.status === "settled");
  const estimated = margins.filter((m) => m.status === "estimated" && !m.noEstimate);
  const settledTotals = sumMargins(settled);
  const estimatedTotals = sumMargins(estimated);

  const costedSettled = settled.filter((m) => m.hasCost);
  const costedEstimated = estimated.filter((m) => m.hasCost);

  const kpis = {
    revenue: margins.reduce((n, m) => n + m.revenue, 0),
    revenueSettled: settledTotals.revenue,
    units: margins.reduce((n, m) => n + m.qty, 0),
    netSettled: settledTotals.netAmount,
    netEstimated: estimatedTotals.netAmount,
    profitSettled: sumMargins(costedSettled).profit,
    profitEstimated: sumMargins(costedEstimated).profit,
    costedSettled: costedSettled.length,
    costedEstimated: costedEstimated.length,
    uncosted: margins.filter((m) => !m.noEstimate && !m.hasCost).length,
    stockValueAtCost: stock.totals.costedSkus > 0 ? stock.totals.atCost : null,
    stockedSkus: stock.totals.stockedSkus,
    costedSkus: stock.totals.costedSkus,
    stockValueAtPrice: stock.totals.pricedSkus > 0 ? stock.totals.atPrice : null,
    pricedSkus: stock.totals.pricedSkus,
  };

  return {
    sources,
    notes,
    kpis,
    bySku,
    orderLines: margins,
    priceSeries,
    stock,
    inventory,
    marketplaceFees,
    settledTotals,
    estimatedTotals,
    settledCount: settled.length,
    estimatedCount: estimated.length,
    noEstimateCount: margins.filter((m) => m.noEstimate).length,
  };
}
