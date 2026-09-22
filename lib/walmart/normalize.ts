import type { walmartReconRows } from "@/lib/db/schema";
import type { WalmartReconLine } from "./recon";

type ReconRowInsert = typeof walmartReconRows.$inferInsert;

/** Walmart timestamps/dates may arrive as full ISO strings; `date` columns want just the date part. */
function toDateOnly(value: string | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

/** Raw JSON row -> typed insert. The untouched original row is kept in `raw`. */
export function normalizeReconLine(
  line: WalmartReconLine,
  reportDate: string
): ReconRowInsert {
  return {
    transactionKey: String(line["Transaction Key"]),
    reportDate,
    periodStart: toDateOnly(line["Period Start Date"]),
    periodEnd: toDateOnly(line["Period End Date"]),
    customerOrderNo: line["Customer Order #"] ?? null,
    customerOrderLine: line["Customer Order line #"] ?? null,
    purchaseOrderNo: line["Purchase Order #"] ?? null,
    purchaseOrderLine: line["Purchase Order line #"] ?? null,
    partnerItemId: line["Partner Item Id"] ?? null,
    partnerItemName: line["Partner Item Name"] ?? null,
    transactionType: line["Transaction Type"] ?? null,
    amountType: line["Amount Type"] ?? null,
    transactionDesc: line["Transaction Description"] ?? null,
    amount: String(line.Amount),
    shipQty:
      line["Ship Qty"] != null && line["Ship Qty"] !== ""
        ? Number(line["Ship Qty"])
        : null,
    postedAt: line["Transaction Posted Timestamp"]
      ? new Date(line["Transaction Posted Timestamp"])
      : null,
    raw: line,
  };
}
