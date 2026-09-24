/**
 * Working line-item shape shared by every connector's normalization code
 * and by the engine math below. Not yet the fully marketplace-neutral
 * `OrderLine` the plan's canonical model calls for (see
 * docs/multi-marketplace-plan.md, "Inside the middleware") - that lands
 * once a second connector exists and forces the vocabulary to generalize.
 * For now this is exactly what `lib/margin.ts`'s `OrderLineSummary` was.
 */
export interface OrderLineSummary {
  /** Set by MarketplaceConnector.snapshot() - which connected source this line came from. */
  source?: string;
  sourceLabel?: string;
  purchaseOrderNo: string;
  purchaseOrderLine: string;
  sku: string;
  itemName: string;
  qty: number;
  fulfillmentType: string;
  commissionRate: string;

  // "settled" = exact figures from a recon report. "estimated" = an
  // order Walmart hasn't settled yet; commission and shipping are
  // projected from that SKU's settled history.
  status: "settled" | "estimated";
  // Estimated line whose SKU has no settled history to project from.
  // Its commission/shipping/net are placeholders and must not be shown
  // or summed.
  noEstimate: boolean;
  estimateNote?: string;
  orderDate?: string; // YYYY-MM-DD, estimated lines only
  postedDate?: string; // YYYY-MM-DD settlement posting date, settled lines only
  /**
   * The date a sale is placed on for trend charts: the real order date
   * where the Orders API has it, else the settlement posting date (which
   * runs a couple of days after the sale). saleDateBasis says which.
   * Kept separate from orderDate/postedDate so the CSV export's meaning
   * of those two columns doesn't change.
   */
  saleDate?: string;
  saleDateBasis?: "order" | "posted";

  // Components. Every row lands in exactly one of these, so they always
  // sum to netAmount - nothing is silently dropped.
  revenue: number; // "Product Price"
  commission: number; // "Commission on Product" (negative)
  shipping: number; // shipping label charges (negative)
  tax: number; // tax collected + withheld, normally nets to 0
  otherFees: number; // anything not matched above

  netAmount: number;
}

/**
 * Every SKU-keyed lookup goes through this so the same product doesn't
 * silently split in two over casing/whitespace differences between a
 * marketplace's own APIs (or between marketplaces).
 */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}
