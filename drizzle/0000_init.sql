CREATE TABLE "sku_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_item_id" text NOT NULL,
	"unit_cost" numeric(12, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sku_costs_item_effective_unique" UNIQUE("partner_item_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"report_dates" text[],
	"rows_ingested" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "walmart_recon_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_key" text NOT NULL,
	"report_date" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"customer_order_no" text,
	"customer_order_line" text,
	"purchase_order_no" text,
	"purchase_order_line" text,
	"partner_item_id" text,
	"partner_item_name" text,
	"transaction_type" text,
	"amount_type" text,
	"transaction_desc" text,
	"amount" numeric(12, 2) NOT NULL,
	"ship_qty" integer,
	"posted_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "walmart_recon_rows_transaction_key_unique" UNIQUE("transaction_key")
);
--> statement-breakpoint
CREATE INDEX "recon_rows_po_line_idx" ON "walmart_recon_rows" USING btree ("purchase_order_no","purchase_order_line");--> statement-breakpoint
CREATE INDEX "recon_rows_partner_item_id_idx" ON "walmart_recon_rows" USING btree ("partner_item_id");--> statement-breakpoint
CREATE INDEX "recon_rows_report_date_idx" ON "walmart_recon_rows" USING btree ("report_date");