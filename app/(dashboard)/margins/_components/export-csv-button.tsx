"use client";

import type { MarginRow } from "@/lib/db/queries";

function toCsv(rows: MarginRow[]): string {
  const header = [
    "purchase_order_no",
    "purchase_order_line",
    "partner_item_id",
    "partner_item_name",
    "fulfillment_channel",
    "ship_qty",
    "net_settlement",
    "gross_revenue",
    "total_fees",
    "unit_cost",
    "profit",
    "margin",
    "missing_cost",
  ];
  const lines = rows.map((r) =>
    [
      r.purchaseOrderNo,
      r.purchaseOrderLine ?? "",
      r.partnerItemId ?? "",
      r.partnerItemName ?? "",
      r.fulfillmentChannel,
      r.shipQty,
      r.netSettlement.toFixed(2),
      r.grossRevenue.toFixed(2),
      r.totalFees.toFixed(2),
      r.unitCost != null ? r.unitCost.toFixed(4) : "",
      r.profit.toFixed(2),
      r.margin != null ? (r.margin * 100).toFixed(2) : "",
      r.missingCost ? "true" : "false",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export function ExportCsvButton({ rows }: { rows: MarginRow[] }) {
  function handleClick() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `margins-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleClick}
      disabled={rows.length === 0}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
    >
      Export CSV
    </button>
  );
}
