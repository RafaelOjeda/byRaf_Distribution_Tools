/**
 * Everything the dashboard can see. Plain serializable JSON throughout,
 * so the middleware could later move to its own service with no
 * redesign here - see docs/multi-marketplace-plan.md, "Later: a
 * separate service".
 */

/** A connectable data source. The dashboard renders these; it never names one. */
export interface SourceDescriptor {
  id: string; // opaque to the dashboard ("walmart", "demo", ...)
  label: string; // "Walmart", shown as-is
  credentialFields: { key: string; label: string; secret: boolean; help?: string }[];
  capabilities: {
    settlements: boolean;
    recentOrders: boolean;
    stock: boolean;
    listings: boolean;
  };
}

/** What the user pasted, per source. The dashboard holds it and passes it through; it never reads it. */
export type Connections = Record<string /* source id */, Record<string, string>>;

/** One settlement/payout period a source can be asked for. */
export interface Period {
  id: string; // opaque, passed back to fetchSnapshot
  label: string; // pre-formatted for display - no MMDDYYYY in the UI
}

export interface PeriodList {
  periods: Period[];
  /** Set when this one source couldn't be reached; the others still list. */
  error?: string;
}

const SNAPSHOT_BRAND = Symbol("Snapshot");

/**
 * Everything fetchSnapshot pulled from every connected source, already
 * normalized and fee-estimated. Opaque to the dashboard: it stores this
 * and hands it back to buildReport, but never reads a field from it.
 * Still plain JSON underneath (see the module doc above) - the brand is
 * a compile-time-only guard, not a runtime wrapper.
 */
export type Snapshot = { readonly [SNAPSHOT_BRAND]: true };

/** Escape hatch for connector/engine code that legitimately builds or reads a Snapshot. */
export function brandSnapshot<T extends object>(data: T): Snapshot & T {
  return data as Snapshot & T;
}

/** One purchase batch: how many units, at what price each. */
export interface CostLot {
  qty: number;
  unitCost: number;
}

/** What's entered per product. Keyed by normalizeSku(sku), or a chosen alias key (phase 4). */
export interface SkuCostInputs {
  lots?: CostLot[];
  boxCost?: number;
  boxLength?: number;
  boxWidth?: number;
  boxHeight?: number;
  /** Other SKUs (on any source) that are the same physical product. Phase 4. */
  aliasSkus?: string[];
}

export type CostInputs = Record<string, SkuCostInputs>;

export interface ReportView {
  /** Which connected sources to include. "all" = every connected source. */
  sourceFilter: string[] | "all";
  dateRange?: { start: string; end: string };
}

export interface Money {
  amount: number;
  currency: string;
}

/** A source's own reported count for one SKU. See engine/margins.ts stockValue for the pooling rules. */
export interface StockItem {
  sku: string;
  onHand: number;
  availToSell: number;
  reserved: number;
  source?: string;
  sourceLabel?: string;
  /** Physically separate stock held in a marketplace's own fulfillment network (e.g. FBA/WFS) - added on top of the merchant pool, never compared against it. Omitted means merchant-fulfilled. */
  fulfillment?: "merchant" | "marketplace";
}

export interface SourceStatus {
  id: string;
  label: string;
  status: "ok" | "error" | "not-connected";
  error?: string;
}

/**
 * A charge that belongs to no single order line: storage, subscriptions,
 * ads, adjustments. See docs/multi-marketplace-plan.md, "AccountCharge
 * closes a known gap" - Walmart's recon report drops these today because
 * `groupReconRows` only keeps rows with a Purchase Order #.
 */
export interface AccountCharge {
  source: string;
  periodId: string;
  kind: "storage" | "subscription" | "advertising" | "adjustment" | "other";
  description: string;
  amount: number;
}

export interface ReportKpis {
  revenue: number;
  revenueSettled: number;
  units: number;
  netSettled: number;
  netEstimated: number;
  profitSettled: number;
  profitEstimated: number;
  costedSettled: number;
  costedEstimated: number;
  uncosted: number;
  stockValueAtCost: number | null;
  stockedSkus: number;
  costedSkus: number;
  stockValueAtPrice: number | null;
  pricedSkus: number;
}

/**
 * Shaped for display: every figure is already computed, every "unknown"
 * is null (rendered "—", never $0) and every total says what it covers.
 * `bySku`/`orderLines`/`stock` reuse the engine's own row types rather
 * than the flatter shape sketched in docs/multi-marketplace-plan.md -
 * that sketch is illustrative, and the engine's rows already carry
 * everything the dashboard renders.
 */
export interface Report {
  sources: SourceStatus[];
  notes: string[];
  kpis: ReportKpis;
  bySku: import("../engine/margins").SkuSummary[];
  orderLines: import("../engine/margins").MarginRow[];
  priceSeries: import("../engine/prices").PriceSeries[];
  stock: ReturnType<typeof import("../engine/margins").stockValue>;
  /** Every SKU any connected source reports, including SKUs with nothing in stock right now - unlike `stock.rows`, which only lists what's on hand. */
  inventory: StockItem[];
  marketplaceFees: AccountCharge[];
  settledTotals: ReturnType<typeof import("../engine/margins").sumMargins>;
  estimatedTotals: ReturnType<typeof import("../engine/margins").sumMargins>;
  settledCount: number;
  estimatedCount: number;
  noEstimateCount: number;
}

/**
 * Everything a source contributed, already normalized. This is the
 * concrete shape hidden behind the `Snapshot` brand - the dashboard never
 * imports this module's connector-facing types, but buildReport (engine
 * code) needs the real fields.
 */
export interface SnapshotSource {
  id: string;
  label: string;
  status: "ok" | "error";
  error?: string;
  lines: import("../engine/types").OrderLineSummary[];
  charges: AccountCharge[];
  orderDates: Record<string, string>;
  inventory: StockItem[];
  catalog: { sku: string; price: number | null; publishedStatus: string }[];
}

export interface SnapshotData {
  sources: SnapshotSource[];
}
