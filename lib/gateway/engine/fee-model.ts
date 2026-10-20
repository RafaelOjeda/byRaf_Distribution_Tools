/**
 * The shape of a marketplace's published fee schedules. Pure data types,
 * so a connector can ship its tables and the dashboard can read them
 * without either importing the other. The prediction math that consumes
 * them is in fee-predict.ts.
 */

/** One step of a rate schedule. upTo is the price this band runs to, inclusive; null = no ceiling. */
export interface RateBand {
  upTo: number | null;
  rate: number; // fraction, e.g. 0.15
}

export interface ReferralCategory {
  id: string;
  label: string;
  /**
   * Lowercase fragments matched against a catalog item's category text, so
   * a SKU's category can be suggested without the user picking one. A hint
   * that matches nothing just leaves the category for the user to choose.
   */
  aliases: string[];
  /**
   * "flat": one rate on the whole price (one band).
   * "tiered": the band the price falls in sets the rate for the whole price.
   * "marginal": each band's rate applies only to the slice of price inside it.
   */
  mode: "flat" | "tiered" | "marginal";
  bands: RateBand[];
  /** Smallest referral fee charged per item, when the schedule has one. */
  minFee?: number;
}

export interface ReferralTable {
  sourceUrl: string;
  /** ISO date the figures were last checked against the source; null = never. */
  lastVerified: string | null;
  categories: ReferralCategory[];
  /** Plain-language caveat shown beside predictions that use this table, e.g. what the fee is charged on. */
  note?: string;
}

/**
 * Fee for a marketplace-managed fulfillment service (a warehouse that
 * ships for you), by billable weight. Unlike a seller's own label cost it
 * is a published rate card, not something to learn from history.
 */
export interface ManagedFulfillmentTable {
  sourceUrl: string;
  lastVerified: string | null;
  /** Ascending. A weight takes the first tier whose upToLb it does not exceed. */
  tiers: { upToLb: number | null; fee: number; perLbOver?: { fromLb: number; rate: number } }[];
  note?: string;
}

export interface FeeModel {
  /** Which connected source this schedule belongs to. */
  sourceId: string;
  sourceLabel: string;
  /** fulfillmentType strings on order lines that mean "the marketplace ships it". */
  managedFulfillmentLabels: string[];
  referral: ReferralTable;
  managed: ManagedFulfillmentTable | null;
}
