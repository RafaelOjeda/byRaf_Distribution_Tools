/**
 * Amount-type classification, kept separate from the query layer per
 * walmart-margin-tracker-plan.md's Data Model section.
 *
 * PROVISIONAL. The docs confirm the `Amount Type` / `Transaction Type`
 * fields exist and name "Sale" and "PaymentSummary" as example
 * Transaction Type values, but not the full taxonomy — Phase 3 exists
 * specifically to read the real distinct values from a synced period
 * (see `getDistinctAmountTypes` in lib/db/queries.ts) and correct these
 * lists. Nothing here is load-bearing for `profit`: `net_settlement`
 * sums every row regardless of classification, so profit is correct
 * even if these lists are wrong. Only `margin` (which divides by
 * `grossRevenue`) and `fulfillmentChannel` depend on them.
 */
export const REVENUE_TRANSACTION_TYPES: string[] = ["Sale"];
export const WFS_TRANSACTION_TYPES: string[] = [];
export const WFS_AMOUNT_TYPES: string[] = [];

export interface ReconLineForMargin {
  amount: number;
  amountType: string | null;
  transactionType: string | null;
}

export type FulfillmentChannel = "wfs" | "self";

export function classifyChannel(
  lines: ReconLineForMargin[]
): FulfillmentChannel {
  const isWfs = lines.some(
    (l) =>
      (l.amountType && WFS_AMOUNT_TYPES.includes(l.amountType)) ||
      (l.transactionType && WFS_TRANSACTION_TYPES.includes(l.transactionType))
  );
  return isWfs ? "wfs" : "self";
}

export interface LineMargin {
  fulfillmentChannel: FulfillmentChannel;
  netSettlement: number;
  grossRevenue: number;
  totalFees: number;
  unitCost: number | null;
  profit: number;
  /** null when grossRevenue is 0 (can't express a fee-only line as a % of nothing) */
  margin: number | null;
  missingCost: boolean;
}

/** Group by (purchase_order_no, purchase_order_line) before calling this. */
export function computeLineMargin(
  lines: ReconLineForMargin[],
  unitCost: number | null,
  shipQty: number
): LineMargin {
  const netSettlement = lines.reduce((sum, l) => sum + l.amount, 0);
  const grossRevenue = lines
    .filter(
      (l) =>
        l.transactionType && REVENUE_TRANSACTION_TYPES.includes(l.transactionType)
    )
    .reduce((sum, l) => sum + l.amount, 0);
  const totalFees = netSettlement - grossRevenue;
  const missingCost = unitCost === null;
  const profit = netSettlement - (unitCost ?? 0) * shipQty;
  const margin = grossRevenue !== 0 ? profit / grossRevenue : null;

  return {
    fulfillmentChannel: classifyChannel(lines),
    netSettlement,
    grossRevenue,
    totalFees,
    unitCost,
    profit,
    margin,
    missingCost,
  };
}
