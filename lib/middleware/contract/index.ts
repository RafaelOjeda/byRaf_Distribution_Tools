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

export interface SourceStatus {
  id: string;
  label: string;
  status: "ok" | "error" | "not-connected";
  error?: string;
}

export interface ReportKpis {
  revenue: number;
  units: number;
  net: number;
  profit: number | null;
  stockValue: number | null;
  /** e.g. "settled" / "settled + estimated" - what the net/profit figures cover. */
  coverage: string;
}

/**
 * The Report shape is still evolving with the middleware build-out
 * (docs/multi-marketplace-plan.md, phases 2-4). What exists today:
 * sources + notes (phase 2 partial-failure visibility). bySku,
 * orderLines, priceSeries, stock and marketplaceFees land as buildReport
 * itself is implemented.
 */
export interface Report {
  sources: SourceStatus[];
  notes: string[];
}
