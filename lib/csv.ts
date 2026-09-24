import type { CostLot, MarginRow, SkuInputs, SkuSummary } from "./margin";
import { normalizeSku } from "./margin";

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

// ---------------------------------------------------------------------
// Cost import / export (purchase batches + box cost & dimensions)
// ---------------------------------------------------------------------

export const COST_IMPORT_HEADERS = [
  "SKU",
  "Batch Qty",
  "Batch Unit Cost",
  "Box Cost",
  "Box Length",
  "Box Width",
  "Box Height",
];

/**
 * One row per purchase batch. A SKU with several batches gets several
 * rows; box fields are only written on its first row so re-entering them
 * per batch isn't required. A SKU with no batches yet (box info only)
 * gets a single row with the batch columns blank.
 *
 * Doubles as the import template: exporting with no costs entered yet
 * still lists every currently loaded SKU, ready to fill in.
 */
export function costsToCsv(
  skus: string[],
  inputs: Record<string, SkuInputs>
): string {
  const rows: Cell[][] = [];
  for (const sku of skus) {
    const inp = inputs[sku];
    const lots = inp?.lots ?? [];
    const box: Cell[] = [
      inp?.boxCost ?? null,
      inp?.boxLength ?? null,
      inp?.boxWidth ?? null,
      inp?.boxHeight ?? null,
    ];
    if (lots.length === 0) {
      rows.push([sku, null, null, ...box]);
    } else {
      lots.forEach((lot, i) => {
        rows.push([
          sku,
          lot.qty,
          lot.unitCost,
          ...(i === 0 ? box : [null, null, null, null]),
        ]);
      });
    }
  }
  return toCsv(COST_IMPORT_HEADERS, rows);
}

/**
 * Parses CSV text into raw string cells per RFC 4180: quoted fields,
 * embedded commas/newlines, and doubled quotes escaping a literal quote.
 * Strips a leading BOM. Blank trailing lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r") {
      i++; // CRLF: the \n below ends the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export interface CostImportRowError {
  row: number; // 1 = header, first data row = 2
  message: string;
}

export interface CostImportResult {
  inputs: Record<string, SkuInputs>; // keyed by normalizeSku
  warnings: string[];
  errors: CostImportRowError[];
  stats: { skus: number; batches: number; boxed: number; skippedRows: number };
}

const COST_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const COST_IMPORT_MAX_ROWS = 5000;

const empty = (
  errors: CostImportRowError[],
  warnings: string[] = []
): CostImportResult => ({
  inputs: {},
  warnings,
  errors,
  stats: { skus: 0, batches: 0, boxed: 0, skippedRows: 0 },
});

/** A cell our own export prefixed with `'` to block spreadsheet formula
 *  execution (see `guardFormula`). Strip it back off before parsing. */
function stripApostrophe(cell: string): string {
  return cell.startsWith("'") ? cell.slice(1) : cell;
}

/** Blank -> not provided (undefined). Non-blank non-numeric -> throws. */
function parseNumericCell(raw: string, label: string): number | undefined {
  const s = stripApostrophe(raw).trim();
  if (s === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${label} "${raw}" is not a number`);
  return n;
}

type BoxKey = "boxCost" | "boxLength" | "boxWidth" | "boxHeight";
const BOX_COLUMNS: { key: BoxKey; label: string }[] = [
  { key: "boxCost", label: "Box Cost" },
  { key: "boxLength", label: "Box Length" },
  { key: "boxWidth", label: "Box Width" },
  { key: "boxHeight", label: "Box Height" },
];

/**
 * Parses a cost-import CSV (see `COST_IMPORT_HEADERS`) into per-SKU
 * purchase batches and box info, plus row-level errors so bad rows are
 * surfaced rather than silently dropped. Nothing here touches state -
 * the caller decides whether/how to apply the result.
 */
export function parseCostImportCsv(text: string): CostImportResult {
  if (text.length > COST_IMPORT_MAX_BYTES) {
    return empty([
      {
        row: 0,
        message: `File is larger than ${COST_IMPORT_MAX_BYTES / (1024 * 1024)}MB.`,
      },
    ]);
  }

  const rows = parseCsv(text);
  if (rows.length === 0) {
    return empty([{ row: 0, message: "File is empty." }]);
  }

  const header = rows[0].map((h) => stripApostrophe(h).trim().toLowerCase());
  const colIndex = (label: string) => header.indexOf(label.toLowerCase());
  const skuCol = colIndex("SKU");
  if (skuCol === -1) {
    return empty([{ row: 1, message: 'Missing required "SKU" column.' }]);
  }
  const qtyCol = colIndex("Batch Qty");
  const unitCostCol = colIndex("Batch Unit Cost");
  const boxCols = BOX_COLUMNS.map((b) => ({ ...b, col: colIndex(b.label) }));

  let dataRows = rows.slice(1);
  const errors: CostImportRowError[] = [];
  if (dataRows.length > COST_IMPORT_MAX_ROWS) {
    errors.push({
      row: 0,
      message: `File has ${dataRows.length} rows; only the first ${COST_IMPORT_MAX_ROWS} were read.`,
    });
    dataRows = dataRows.slice(0, COST_IMPORT_MAX_ROWS);
  }

  const warnings: string[] = [];
  const inputs: Record<string, SkuInputs> = {};
  let skippedRows = 0;
  let batchCount = 0;

  dataRows.forEach((cells, i) => {
    const rowNum = i + 2; // header is row 1
    const rawSku = (cells[skuCol] ?? "").trim();
    if (!rawSku) {
      skippedRows++;
      errors.push({ row: rowNum, message: "Blank SKU." });
      return;
    }
    const sku = normalizeSku(stripApostrophe(rawSku));

    try {
      const qty =
        qtyCol !== -1 ? parseNumericCell(cells[qtyCol] ?? "", "Batch Qty") : undefined;
      const unitCost =
        unitCostCol !== -1
          ? parseNumericCell(cells[unitCostCol] ?? "", "Batch Unit Cost")
          : undefined;
      if ((qty !== undefined) !== (unitCost !== undefined)) {
        throw new Error(
          "Batch Qty and Batch Unit Cost must both be filled in, or both left blank"
        );
      }
      if (qty !== undefined && qty <= 0) {
        throw new Error(`Batch Qty ${qty} must be greater than 0`);
      }
      if (unitCost !== undefined && unitCost < 0) {
        throw new Error(`Batch Unit Cost ${unitCost} can't be negative`);
      }

      const boxValues = boxCols.map(({ key, label, col }) => ({
        key,
        value:
          col !== -1 ? parseNumericCell(cells[col] ?? "", label) : undefined,
        label,
      }));
      for (const { value, label } of boxValues) {
        if (value !== undefined && value < 0) {
          throw new Error(`${label} ${value} can't be negative`);
        }
      }

      const entry = (inputs[sku] ??= {});
      if (qty !== undefined && unitCost !== undefined) {
        const lot: CostLot = { qty, unitCost };
        entry.lots = [...(entry.lots ?? []), lot];
        batchCount++;
      }
      for (const { key, value, label } of boxValues) {
        if (value === undefined) continue;
        const prev = entry[key];
        if (prev !== undefined && prev !== value) {
          warnings.push(
            `SKU ${sku}: conflicting ${label} values in the file (${prev} vs ${value}); using ${value}.`
          );
        }
        entry[key] = value;
      }
    } catch (e) {
      skippedRows++;
      errors.push({ row: rowNum, message: `SKU ${sku}: ${(e as Error).message}` });
    }
  });

  const boxed = Object.values(inputs).filter((i) =>
    BOX_COLUMNS.some((b) => i[b.key] !== undefined)
  ).length;

  return {
    inputs,
    warnings,
    errors,
    stats: {
      skus: Object.keys(inputs).length,
      batches: batchCount,
      boxed,
      skippedRows,
    },
  };
}
