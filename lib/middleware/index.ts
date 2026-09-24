/**
 * The public, client-safe surface of the middleware. Pure: no network, no
 * secrets. Code in app/ may import this module and ./actions - nothing
 * else under lib/middleware/ (see docs/multi-marketplace-plan.md,
 * "Keeping the boundary honest", and eslint.config.mjs).
 */
export type {
  AccountCharge,
  Connections,
  CostInputs,
  CostLot,
  Money,
  Period,
  PeriodList,
  Report,
  ReportKpis,
  ReportView,
  SkuCostInputs,
  Snapshot,
  SourceDescriptor,
  SourceStatus,
} from "./contract";

export { buildReport } from "./engine/report";

export {
  costsToCsv,
  orderLinesToCsv,
  parseCostImportCsv as parseCostCsv,
  skuSummaryToCsv,
  type CostImportResult,
  type CostImportRowError,
} from "./engine/csv";

export {
  DIM_DIVISOR,
  SHIPPING_PCT_ALERT,
  SHIPPING_PCT_WARN,
  averageUnitCost,
  cubicInches,
  dimWeight,
  reconcileStock,
  type MarginRow,
  type SkuInputs,
  type SkuStock,
  type SkuSummary,
} from "./engine/margins";

export type { PricePoint, PriceSeries } from "./engine/prices";

export { normalizeSku } from "./engine/types";
