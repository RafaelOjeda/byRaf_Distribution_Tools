import type { MarginRow, SkuSummary } from "./margin";

type Cell = string | number | null;

const BOM = "﻿"; // so Excel reads UTF-8 (accented item names) correctly

/**
 * Spreadsheets execute a cell starting with = + - @ tab or CR as a
 * formula. SKUs and item names come from Walmart's catalog, so string
 * cells get a leading apostrophe. Numbers are exempt: a legitimate
 * -12.50 must stay a number, not become text.
 */
function guardFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function encode(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  const s = guardFormula(cell);
  // RFC 4180: quote when the field holds a comma, quote, CR or LF.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return (
    BOM +
    [headers, ...rows].map((r) => r.map(encode).join(",")).join("\r\n") +
    "\r\n"
  );
}

/** 2-decimal number, or null. Keeps cents from becoming 0.1 + 0.2 noise. */
const money = (n: number): number => Math.round(n * 100) / 100;
const pct = (fraction: number | null): number | null =>
  fraction === null ? null : Math.round(fraction * 1000) / 10;

function lineStatus(r: MarginRow): string {
  if (r.status === "settled") return "Settled";
  return r.noEstimate ? "Not estimable" : "Estimated";
}

export const ORDER_LINE_HEADERS = [
  "Status",
  "Order date",
  "Settlement posted date",
  "Purchase order #",
  "SKU",
  "Item",
  "Fulfillment",
  "Qty",
  "Revenue",
  "Commission",
  "Shipping",
  "Tax",
  "Other fees",
  "Net",
  "Item cost",
  "Box cost",
  "Total cost",
  "Profit",
  "Margin %",
];

/**
 * Blank, never 0, wherever a figure isn't actually known:
 * - not-estimable lines carry placeholder zeros for fees and net;
 * - a line with no cost entered would otherwise export a profit that
 *   silently assumed cost = 0, and a file has no amber "no cost" marker.
 */
export function orderLinesToCsv(rows: MarginRow[]): string {
  return toCsv(
    ORDER_LINE_HEADERS,
    rows.map((r) => {
      const fees = !r.noEstimate;
      const costed = r.hasCost && !r.noEstimate;
      return [
        lineStatus(r),
        r.orderDate ?? null,
        r.postedDate ?? null,
        r.purchaseOrderNo,
        r.sku,
        r.itemName,
        r.fulfillmentType,
        r.qty,
        money(r.revenue),
        fees ? money(r.commission) : null,
        fees ? money(r.shipping) : null,
        fees ? money(r.tax) : null,
        fees ? money(r.otherFees) : null,
        fees ? money(r.netAmount) : null,
        costed ? money(r.itemCostTotal) : null,
        costed ? money(r.boxCostTotal) : null,
        costed ? money(r.costTotal) : null,
        costed ? money(r.profit) : null,
        costed ? pct(r.margin) : null,
      ];
    })
  );
}

export const SKU_SUMMARY_HEADERS = [
  "SKU",
  "Item",
  "Units",
  "Lines",
  "Settled lines",
  "Estimated lines",
  "Not estimable lines",
  "Avg price",
  "Revenue",
  "Commission",
  "Shipping",
  "Ship %",
  "Net",
  "Total cost",
  "Profit",
  "Margin %",
];

export function skuSummaryToCsv(rows: SkuSummary[]): string {
  return toCsv(
    SKU_SUMMARY_HEADERS,
    rows.map((s) => {
      const m = s.hasMoney;
      const costed = m && !s.missingCost;
      const t = s.totals;
      return [
        s.sku,
        s.itemName,
        s.units,
        s.lines,
        s.settledLines,
        s.estimatedLines,
        s.noEstimateLines,
        s.avgPrice === null ? null : money(s.avgPrice),
        m ? money(t.revenue) : null,
        m ? money(t.commission) : null,
        m ? money(t.shipping) : null,
        pct(s.shippingPct),
        m ? money(t.netAmount) : null,
        costed ? money(t.costTotal) : null,
        costed ? money(t.profit) : null,
        costed ? pct(s.margin) : null,
      ];
    })
  );
}
