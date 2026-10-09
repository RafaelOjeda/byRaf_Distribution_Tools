/**
 * The public, client-safe surface of the gateway. Pure: no network, no
 * secrets. Code in app/ may import this module and ./actions - nothing
 * else under lib/gateway/ (see docs/multi-marketplace-plan.md,
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
  EMPTY_SETTINGS,
  applyImport,
  diffInputs,
  exportCsvBundle,
  exportWorkbook,
  parseImportFile,
  type ExportOptions,
  type PortableData,
  type PortableDiff,
  type PortableFormat,
  type PortableImportError,
  type PortableImportResult,
  type PortableSettings,
} from "./engine/portable";

// Calculation helpers (averageUnitCost, stockValue, ...) are deliberately
// not exported: the dashboard reads figures from Report, never works one
// out itself - see docs/tab-consolidation-plan.md, "Rule: one source,
// many views".
export {
  SHIPPING_PCT_ALERT,
  SHIPPING_PCT_WARN,
  type MarginRow,
  type SkuCost,
  type SkuInputs,
  type SkuStockRecord,
  type SkuSummary,
} from "./engine/margins";

export type { ProductRecord } from "./engine/products";

export {
  parseCostDrafts,
  type CostDrafts,
  type CostField,
} from "./engine/drafts";

export type { PricePoint, PriceSeries } from "./engine/prices";

export { normalizeSku } from "./engine/types";
