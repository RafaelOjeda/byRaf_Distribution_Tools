import {
  bigserial,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Raw, append-only. One row per Walmart recon report money line.
 * Never updated or deleted — see walmart-margin-tracker-plan.md for why
 * (late-arriving refunds, and `raw` lets classification bugs be fixed
 * with a query change instead of a re-download).
 */
export const walmartReconRows = pgTable(
  "walmart_recon_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transactionKey: text("transaction_key").notNull().unique(),
    reportDate: date("report_date").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    customerOrderNo: text("customer_order_no"),
    customerOrderLine: text("customer_order_line"),
    purchaseOrderNo: text("purchase_order_no"),
    purchaseOrderLine: text("purchase_order_line"),
    partnerItemId: text("partner_item_id"),
    partnerItemName: text("partner_item_name"),
    transactionType: text("transaction_type"),
    amountType: text("amount_type"),
    transactionDesc: text("transaction_desc"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    shipQty: integer("ship_qty"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    raw: jsonb("raw").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("recon_rows_po_line_idx").on(
      table.purchaseOrderNo,
      table.purchaseOrderLine
    ),
    index("recon_rows_partner_item_id_idx").on(table.partnerItemId),
    index("recon_rows_report_date_idx").on(table.reportDate),
  ]
);

/** Effective-dated so a cost change never rewrites history. */
export const skuCosts = pgTable(
  "sku_costs",
  {
    id: serial("id").primaryKey(),
    partnerItemId: text("partner_item_id").notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 4 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("sku_costs_item_effective_unique").on(
      table.partnerItemId,
      table.effectiveFrom
    ),
  ]
);

/** Observability + prevents overlapping sync runs. */
export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull(), // 'manual' | 'cron'
  status: text("status").notNull(), // 'running' | 'success' | 'error'
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  reportDates: text("report_dates").array(),
  rowsIngested: integer("rows_ingested"),
  error: text("error"),
});
