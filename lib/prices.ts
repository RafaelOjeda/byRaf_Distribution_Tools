import { normalizeSku, type OrderLineSummary } from "./margin";

/** One day's selling price for one SKU. */
export interface PricePoint {
  date: string; // YYYY-MM-DD
  avg: number; // unit-weighted average price that day
  min: number;
  max: number;
  orders: number;
  units: number;
}

export interface PriceSeries {
  sku: string; // display casing, first seen
  itemName: string;
  points: PricePoint[]; // ascending by date, one per day with sales
  units: number;
  first: PricePoint;
  last: PricePoint;
  /** last.avg vs first.avg as a percent; null with a single sale day. */
  changePct: number | null;
  /** Points placed on the settlement posting date instead of the order date. */
  approxPoints: number;
}

/**
 * Selling price per unit over time, one series per SKU, one point per
 * day that had sales.
 *
 * Price is revenue / qty, taken from the order itself, so it is exact for
 * every line - including ones whose fees can't be estimated. (Those are
 * excluded from fee-derived figures elsewhere; price doesn't depend on
 * fees.) Lines with no date, no quantity or no revenue are skipped.
 *
 * Sorted by units sold, so a caller that caps the number of charted
 * series keeps the products that matter most.
 */
export function priceSeriesBySku(lines: OrderLineSummary[]): PriceSeries[] {
  type Day = { prices: number[]; units: number; revenue: number; approx: boolean };
  const bySku = new Map<
    string,
    { sku: string; itemName: string; days: Map<string, Day> }
  >();

  for (const l of lines) {
    if (!l.sku || !l.saleDate || l.qty <= 0 || l.revenue <= 0) continue;

    const key = normalizeSku(l.sku);
    let s = bySku.get(key);
    if (!s) {
      s = { sku: l.sku, itemName: l.itemName, days: new Map() };
      bySku.set(key, s);
    }
    if (!s.itemName && l.itemName) s.itemName = l.itemName;

    const day = s.days.get(l.saleDate) ?? {
      prices: [],
      units: 0,
      revenue: 0,
      approx: false,
    };
    day.prices.push(l.revenue / l.qty);
    day.units += l.qty;
    day.revenue += l.revenue;
    if (l.saleDateBasis === "posted") day.approx = true;
    s.days.set(l.saleDate, day);
  }

  const out: PriceSeries[] = [];
  for (const s of bySku.values()) {
    const points: PricePoint[] = [...s.days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        avg: d.revenue / d.units,
        min: Math.min(...d.prices),
        max: Math.max(...d.prices),
        orders: d.prices.length,
        units: d.units,
      }));

    const first = points[0];
    const last = points[points.length - 1];
    out.push({
      sku: s.sku,
      itemName: s.itemName,
      points,
      units: points.reduce((n, p) => n + p.units, 0),
      first,
      last,
      changePct:
        points.length > 1 && first.avg > 0
          ? ((last.avg - first.avg) / first.avg) * 100
          : null,
      approxPoints: [...s.days.values()].filter((d) => d.approx).length,
    });
  }

  return out.sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku));
}
