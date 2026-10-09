import { findPossibleDuplicates } from "./identity";
import { normalizeSku, type OrderLineSummary } from "./types";

export interface SkuHistory {
  commissionRate: number; // effective fraction of revenue, e.g. 0.064
  avgShipping: number; // per shipment, negative
  shipments: number;
}

/**
 * Per-SKU averages from settled lines. Commission is the effective rate
 * actually charged, not a flat category rate: incentive programs and
 * similar can make the two differ.
 */
export function buildSkuHistory(
  settled: OrderLineSummary[]
): Record<string, SkuHistory> {
  const acc: Record<
    string,
    { revenue: number; commission: number; shipping: number; n: number }
  > = {};
  for (const line of settled) {
    if (!line.sku || line.revenue === 0) continue;
    const key = normalizeSku(line.sku);
    const a = (acc[key] ??= { revenue: 0, commission: 0, shipping: 0, n: 0 });
    a.revenue += line.revenue;
    a.commission += line.commission;
    a.shipping += line.shipping;
    a.n += 1;
  }

  const out: Record<string, SkuHistory> = {};
  for (const [sku, a] of Object.entries(acc)) {
    out[sku] = {
      commissionRate: -a.commission / a.revenue,
      avgShipping: a.shipping / a.n,
      shipments: a.n,
    };
  }
  return out;
}

/**
 * Match key between a settlement/recon report and a source's own order
 * list. Not just PO + line number: connectors have been seen to disagree
 * with themselves on line numbers for the same order. Trade-off: an order
 * with the same SKU on two lines that settle in different periods would
 * count as settled once either does.
 */
export function settlementKey(purchaseOrderNo: string, sku: string): string {
  return `${purchaseOrderNo}::${normalizeSku(sku)}`;
}

/**
 * Places every line on a sale date. Estimated lines already carry their
 * real order date. Settled lines look theirs up in orderDates (keyed with
 * settlementKey); ones older than the order-list window fall back to the
 * settlement posting date and are marked "posted" so the approximation is
 * visible, not silent.
 */
export function assignSaleDates(
  lines: OrderLineSummary[],
  orderDates: Record<string, string>
): OrderLineSummary[] {
  return lines.map((l) => {
    const fromOrders = orderDates[settlementKey(l.purchaseOrderNo, l.sku)];
    const date = l.orderDate ?? fromOrders;
    if (date) return { ...l, saleDate: date, saleDateBasis: "order" as const };
    if (l.postedDate) {
      return { ...l, saleDate: l.postedDate, saleDateBasis: "posted" as const };
    }
    return l;
  });
}

/**
 * One purchase batch: how many units, at what price each. The same item
 * gets bought at different prices over time, so cost per SKU is the
 * quantity-weighted average across batches rather than a single number.
 */
export interface CostLot {
  qty: number;
  unitCost: number;
}

/** What you enter per SKU. All optional - the math degrades gracefully. */
export interface SkuInputs {
  lots?: CostLot[];
  boxCost?: number;
  /** Other SKUs (on any source) that are this same physical product. Resolved before grouping - see engine/identity.ts. */
  aliasSkus?: string[];
}

function validLots(lots: CostLot[] | undefined): CostLot[] {
  return (lots ?? []).filter(
    (l) =>
      Number.isFinite(l.qty) &&
      l.qty > 0 &&
      Number.isFinite(l.unitCost) &&
      l.unitCost >= 0
  );
}

/**
 * Everything about one SKU's cost, worked out from what was entered for
 * it. This is the one place these figures are calculated: margins, stock
 * value and the product record all call it, so a cost shown in two
 * places can never disagree.
 */
export interface SkuCost {
  /** Quantity-weighted average across batches; null when nothing usable is entered. */
  avgCost: number | null;
  /** Per shipment; null when not entered. */
  boxCost: number | null;
  /** Total units across every usable batch. */
  purchased: number;
  /** Total paid across every usable batch. */
  spent: number;
  /** Usable batches - a half-typed or zero-quantity batch doesn't count. */
  batches: number;
}

export function skuCost(inputs: SkuInputs | undefined): SkuCost {
  const lots = validLots(inputs?.lots);
  const purchased = lots.reduce((n, l) => n + l.qty, 0);
  const spent = lots.reduce((n, l) => n + l.qty * l.unitCost, 0);
  const boxCost = inputs?.boxCost;
  return {
    avgCost: purchased === 0 ? null : spent / purchased,
    boxCost: typeof boxCost === "number" && !Number.isNaN(boxCost) ? boxCost : null,
    purchased,
    spent,
    batches: lots.length,
  };
}

/** Total units purchased across every batch. */
export function totalPurchased(lots: CostLot[] | undefined): number {
  return skuCost({ lots }).purchased;
}

/** Quantity-weighted average cost, or null when nothing usable is entered. */
export function averageUnitCost(lots: CostLot[] | undefined): number | null {
  return skuCost({ lots }).avgCost;
}

export interface StockValueRow {
  sku: string;
  /**
   * The quantity valuation is based on: the pool figure (purchased −
   * sold, from cost batches) once any batch is entered, else the
   * largest count reported by a single source - see `onHandIsEstimate`.
   */
  onHand: number;
  /** true => `onHand` is a fallback (no cost batches entered yet), not the real pool figure. */
  onHandIsEstimate: boolean;
  /** Every source's own reported count - never summed, because it's the same physical units seen twice. */
  bySource: {
    source: string;
    sourceLabel: string;
    onHand: number;
    /** null when the source didn't split its count. */
    availToSell: number | null;
    reserved: number | null;
  }[];
  /** A source reports more on hand than your own purchase records support. */
  oversellRisk: boolean;
  avgCost: number | null; // null = no batches entered
  listedPrice: number | null; // null = catalog gave no price
  publishedStatus: string | null; // null = SKU not found in the catalog
  isPublished: boolean;
  valueAtCost: number | null;
  valueAtPrice: number | null;
}

export interface StockValueTotals {
  stockedSkus: number;
  costedSkus: number;
  atCost: number; // over costedSkus only
  pricedSkus: number;
  atPrice: number; // over pricedSkus only - published SKUs with a price
  unpublishedSkus: number; // stocked, priced, but can't currently sell
  oversellSkus: number;
}

/**
 * What the stock on hand is worth, at what it cost and at what it's
 * listed for. Only SKUs actually in stock appear.
 *
 * Merchant stock is one pool, never summed across sources - the same
 * physical units are what every source's own inventory count describes.
 * `bySource` shows each source's count; `onHand` (the valuation
 * quantity) is the pool figure - purchased minus sold, from the cost
 * batches entered - once any batch exists for the SKU. With none
 * entered it falls back to the largest count across sources, marked
 * `onHandIsEstimate`. A source claiming more than the pool implies is
 * `oversellRisk`, advisory only (see docs/multi-marketplace-plan.md,
 * "Stock across channels").
 *
 * Cost is the quantity-weighted average across every batch entered, not
 * FIFO: batches carry no dates, and an average is what's wanted.
 *
 * A missing figure is null, never 0, and the totals cover only the SKUs
 * that have one - the counts say how many, so a total can't silently
 * understate. Unpublished SKUs (e.g. blocked by a policy violation) show
 * their price but are left out of the at-price total: that stock can't
 * sell right now, so counting it would overstate what's realisable.
 */
export function stockValue(
  inventory: StockInput[],
  catalog: CatalogInput[],
  inputs: Record<string, SkuInputs>,
  sold: Record<string, number> = {}
): { rows: SkuStockRecord[]; totals: StockValueTotals } {
  return summarizeStock(stockRecords(inventory, catalog, inputs, sold).values());
}

type StockInput = {
  sku: string;
  onHand: number;
  availToSell?: number;
  reserved?: number;
  source?: string;
  sourceLabel?: string;
};
type CatalogInput = { sku: string; price: number | null; publishedStatus: string };

/**
 * One SKU's stock as every view sees it: the valuation row plus the
 * reconciliation figures (bought, left, mismatch) the inventory view
 * shows. Built once per SKU by stockRecords - the stock value table and
 * the product record hold the same object.
 */
export interface SkuStockRecord extends StockValueRow {
  /**
   * The largest count any single source reports, or null when no source
   * reports this SKU. Not a sum - see stockValue.
   */
  reported: number | null;
  purchased: number; // from the cost batches entered
  sold: number; // units on settled + estimated order lines
  /** purchased − sold: what your own records imply is left. null with no batches entered. */
  left: number | null;
  /**
   * left − reported. Non-zero means the two disagree - usually a missing
   * or mistyped batch. Null when either side is unknown. Deliberately
   * advisory: real drift happens (damage, returns, stock held but not
   * listed), so this never blocks entry.
   */
  discrepancy: number | null;
}

/**
 * A stock record for every SKU the sources report, plus any in
 * `extraSkus` (e.g. sold but not in any inventory feed), keyed by
 * normalizeSku. The pooling rules are the ones documented on stockValue.
 */
export function stockRecords(
  inventory: StockInput[],
  catalog: CatalogInput[],
  inputs: Record<string, SkuInputs>,
  sold: Record<string, number> = {},
  extraSkus: string[] = []
): Map<string, SkuStockRecord> {
  const cat = new Map(catalog.map((c) => [normalizeSku(c.sku), c]));

  const bySku = new Map<string, { display: string; items: StockInput[] }>();
  for (const i of inventory) {
    const key = normalizeSku(i.sku);
    const group = bySku.get(key);
    if (group) group.items.push(i);
    else bySku.set(key, { display: i.sku, items: [i] });
  }
  for (const sku of extraSkus) {
    const key = normalizeSku(sku);
    if (!bySku.has(key)) bySku.set(key, { display: sku, items: [] });
  }

  const out = new Map<string, SkuStockRecord>();
  for (const [key, { display, items }] of bySku) {
    const bySource = items.map((i) => ({
      source: i.source ?? "unknown",
      sourceLabel: i.sourceLabel ?? i.source ?? "unknown",
      onHand: i.onHand,
      availToSell: i.availToSell ?? null,
      reserved: i.reserved ?? null,
    }));
    const reported =
      bySource.length > 0 ? Math.max(0, ...bySource.map((b) => b.onHand)) : null;

    const cost = skuCost(inputs[key]);
    const soldUnits = sold[key] ?? 0;
    const poolOnHand = cost.purchased - soldUnits;
    const onHandIsEstimate = cost.purchased === 0;
    const onHand = onHandIsEstimate ? (reported ?? 0) : poolOnHand;
    const left = onHandIsEstimate ? null : poolOnHand;

    const item = cat.get(key);
    const listedPrice = item?.price ?? null;
    out.set(key, {
      sku: display,
      onHand,
      onHandIsEstimate,
      bySource,
      oversellRisk: !onHandIsEstimate && reported !== null && reported > poolOnHand,
      avgCost: cost.avgCost,
      listedPrice,
      publishedStatus: item?.publishedStatus ?? null,
      isPublished: item?.publishedStatus === "PUBLISHED",
      valueAtCost: cost.avgCost === null ? null : onHand * cost.avgCost,
      valueAtPrice: listedPrice === null ? null : onHand * listedPrice,
      reported,
      purchased: cost.purchased,
      sold: soldUnits,
      left,
      discrepancy: left === null || reported === null ? null : left - reported,
    });
  }
  return out;
}

/** The stock value table and its totals: the in-stock subset of the records, biggest money first. */
export function summarizeStock(
  records: Iterable<SkuStockRecord>
): { rows: SkuStockRecord[]; totals: StockValueTotals } {
  const rows = [...records]
    // Only SKUs a source reports - a SKU missing from every inventory
    // feed has no count to value.
    .filter((r) => r.bySource.length > 0)
    .filter((r) => r.onHand > 0 || r.bySource.some((b) => b.onHand > 0))
    // Biggest money first; SKUs with no figure sink to the bottom.
    .sort(
      (a, b) =>
        (b.valueAtPrice ?? b.valueAtCost ?? -1) -
          (a.valueAtPrice ?? a.valueAtCost ?? -1) || a.sku.localeCompare(b.sku)
    );

  const costed = rows.filter((r) => r.valueAtCost !== null);
  const priced = rows.filter((r) => r.valueAtPrice !== null && r.isPublished);

  return {
    rows,
    totals: {
      stockedSkus: rows.length,
      costedSkus: costed.length,
      atCost: costed.reduce((n, r) => n + (r.valueAtCost ?? 0), 0),
      pricedSkus: priced.length,
      atPrice: priced.reduce((n, r) => n + (r.valueAtPrice ?? 0), 0),
      unpublishedSkus: rows.filter(
        (r) => r.valueAtPrice !== null && !r.isPublished
      ).length,
      oversellSkus: rows.filter((r) => r.oversellRisk).length,
    },
  };
}

export interface MarginRow extends OrderLineSummary {
  hasCost: boolean;
  itemCostTotal: number;
  boxCostTotal: number;
  costTotal: number;
  profit: number;
  margin: number | null;
}

/**
 * profit is correct even for a SKU with nothing entered yet (costs fall
 * back to 0) or an unrecognized fee category, since netAmount already
 * sums every row for the line regardless of category. Only the margin
 * percentage needs the revenue split.
 *
 * Item cost scales with qty; box cost does not - one shipment, one box.
 */
export function computeMargins(
  lines: OrderLineSummary[],
  inputs: Record<string, SkuInputs>
): MarginRow[] {
  const costs = new Map<string, SkuCost>();
  return lines.map((line) => {
    const key = normalizeSku(line.sku);
    let cost = costs.get(key);
    if (!cost) costs.set(key, (cost = skuCost(inputs[key])));
    const unitCost = cost.avgCost;
    const hasCost = unitCost !== null;

    const itemCostTotal = hasCost ? unitCost * line.qty : 0;
    const boxCostTotal = cost.boxCost ?? 0;
    const costTotal = itemCostTotal + boxCostTotal;

    const profit = line.netAmount - costTotal;
    const margin = line.revenue !== 0 ? profit / line.revenue : null;
    return {
      ...line,
      hasCost,
      itemCostTotal,
      boxCostTotal,
      costTotal,
      profit,
      margin,
    };
  });
}

/** Shipping cost as a share of revenue, past which a SKU gets flagged. */
export const SHIPPING_PCT_WARN = 0.15;
export const SHIPPING_PCT_ALERT = 0.25;

export interface SkuSummary {
  sku: string;
  itemName: string;
  units: number; // every line, including non-estimable ones
  lines: number;
  settledLines: number;
  estimatedLines: number;
  noEstimateLines: number;
  /** false => every money column must render "—", never $0.00. */
  hasMoney: boolean;
  unitsCounted: number; // units behind the money figures
  avgPrice: number | null;
  shippingPct: number | null;
  margin: number | null;
  missingCost: boolean;
  totals: ReturnType<typeof sumMargins>;
  /** How many units/how much revenue each connected source contributed. Sorted units descending. */
  bySource: { source: string; sourceLabel: string; units: number; revenue: number }[];
  /** Other SKUs that look like the same product but aren't aliased together - see findPossibleDuplicates. */
  possibleDuplicates: string[];
}

/**
 * One row per SKU, for "how is this product actually doing" rather than
 * per-order detail.
 *
 * Lines flagged noEstimate carry real revenue but placeholder zeros for
 * commission/shipping/net, so every money figure and ratio here comes
 * from the same filtered basis. Mixing an all-rows revenue with a
 * filtered profit would silently corrupt the margin. Unit and line
 * counts still cover everything, so a SKU's real activity stays visible
 * even when its fees can't be estimated.
 */
export function summarizeBySku(rows: MarginRow[]): SkuSummary[] {
  const bySku = new Map<string, MarginRow[]>();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = normalizeSku(row.sku);
    const group = bySku.get(key);
    if (group) group.push(row);
    else bySku.set(key, [row]);
  }

  const summaries: SkuSummary[] = [];
  for (const [sku, group] of bySku) {
    const counted = group.filter((r) => !r.noEstimate);
    const totals = sumMargins(counted);
    const unitsCounted = counted.reduce((n, r) => n + r.qty, 0);
    const hasMoney = counted.length > 0;

    const bySourceMap = new Map<
      string,
      { source: string; sourceLabel: string; units: number; revenue: number }
    >();
    for (const r of group) {
      const source = r.source ?? "unknown";
      const entry = bySourceMap.get(source) ?? {
        source,
        sourceLabel: r.sourceLabel ?? source,
        units: 0,
        revenue: 0,
      };
      entry.units += r.qty;
      entry.revenue += r.revenue;
      bySourceMap.set(source, entry);
    }
    const bySource = [...bySourceMap.values()].sort((a, b) => b.units - a.units);

    summaries.push({
      sku,
      itemName: group.find((r) => r.itemName)?.itemName ?? "",
      units: group.reduce((n, r) => n + r.qty, 0),
      lines: group.length,
      settledLines: group.filter((r) => r.status === "settled").length,
      estimatedLines: group.filter(
        (r) => r.status === "estimated" && !r.noEstimate
      ).length,
      noEstimateLines: group.length - counted.length,
      hasMoney,
      unitsCounted,
      avgPrice: unitsCounted > 0 ? totals.revenue / unitsCounted : null,
      shippingPct:
        totals.revenue !== 0 ? -totals.shipping / totals.revenue : null,
      margin: totals.revenue !== 0 ? totals.profit / totals.revenue : null,
      missingCost: counted.some((r) => !r.hasCost),
      totals,
      bySource,
      possibleDuplicates: [],
    });
  }

  const duplicates = findPossibleDuplicates(summaries);
  for (const s of summaries) {
    s.possibleDuplicates = duplicates.get(s.sku) ?? [];
  }

  // Revenue descending. Not profit: unentered costs inflate profit, so
  // that ordering would shuffle as costs get typed in.
  return summaries.sort((a, b) => b.totals.revenue - a.totals.revenue);
}

export function sumMargins(rows: MarginRow[]) {
  return rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      commission: acc.commission + r.commission,
      shipping: acc.shipping + r.shipping,
      tax: acc.tax + r.tax,
      otherFees: acc.otherFees + r.otherFees,
      netAmount: acc.netAmount + r.netAmount,
      itemCostTotal: acc.itemCostTotal + r.itemCostTotal,
      boxCostTotal: acc.boxCostTotal + r.boxCostTotal,
      costTotal: acc.costTotal + r.costTotal,
      profit: acc.profit + r.profit,
    }),
    {
      revenue: 0,
      commission: 0,
      shipping: 0,
      tax: 0,
      otherFees: 0,
      netAmount: 0,
      itemCostTotal: 0,
      boxCostTotal: 0,
      costTotal: 0,
      profit: 0,
    }
  );
}
