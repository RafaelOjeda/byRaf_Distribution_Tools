/**
 * The one definition of the portable save/load file: which tables exist,
 * their columns, and how a table's rows turn into (and back out of) the
 * user-entered inputs. The XLSX and zipped-CSV encoders (xlsx.ts, zip.ts)
 * only move cells in and out of a file - nothing here knows about either
 * format, so the two can't drift apart.
 * See docs/import-export-plan.md.
 */
import { guardFormula, stripApostrophe, type Cell } from "../csv";
import type { SkuInputs } from "../margins";
import { normalizeSku } from "../types";

export const SCHEMA_VERSION = 1;
export const MAX_TABLE_ROWS = 5000;

export type { Cell };

export interface PortableSettings {
  /** Period ids to pre-select per source on the next connect. */
  selectedPeriods: Record<string, string[]>;
  sourceFilter: string[] | "all";
}

export interface PortableData {
  inputs: Record<string, SkuInputs>; // keyed by normalizeSku
  settings: PortableSettings;
}

/** A table on its way out: typed cells, header row separate. */
export interface TableOut {
  headers: string[];
  rows: Cell[][];
}

/** A table on its way in: every cell is text, whichever format it came from. */
export interface RawTable {
  headers: string[];
  rows: string[][];
  /** The file was a ";"-delimited CSV, so "3,5" means 3.5. */
  decimalComma?: boolean;
}

/** Keyed by lowercase table name ("costs", "boxes", ...). */
export type RawTables = Record<string, RawTable>;

export type PortableFormat = "xlsx" | "zip" | "csv";

export interface PortableImportError {
  table: string;
  row: number; // 1 = header, first data row = 2; 0 = whole table / file
  message: string;
}

export interface PortableDiff {
  added: string[];
  changed: string[];
  unchanged: string[];
}

export interface PortableImportResult {
  data: PortableData;
  format: PortableFormat;
  schemaVersion: number;
  warnings: string[];
  errors: PortableImportError[];
  stats: {
    skus: number;
    batches: number;
    boxed: number;
    aliased: number;
    skippedRows: number;
  };
  /** Only filled when the caller passes the current inputs. */
  diff: PortableDiff;
}

export const EMPTY_SETTINGS: PortableSettings = {
  selectedPeriods: {},
  sourceFilter: "all",
};

export const COSTS_HEADERS = ["SKU", "Batch Qty", "Batch Unit Cost"];
export const BOXES_HEADERS = [
  "SKU",
  "Box Cost",
  "Box Length",
  "Box Width",
  "Box Height",
];
export const ALIASES_HEADERS = ["SKU", "Alias SKU"];
export const SETTINGS_HEADERS = ["Key", "Source", "Value"];
export const META_HEADERS = ["Key", "Value"];

const BOX_FIELDS = [
  { key: "boxCost", label: "Box Cost" },
  { key: "boxLength", label: "Box Length" },
  { key: "boxWidth", label: "Box Width" },
  { key: "boxHeight", label: "Box Height" },
] as const;

// ---------------------------------------------------------------------
// Export: data -> tables
// ---------------------------------------------------------------------

const text = (s: string): string => guardFormula(s);

export function dataToTables(
  data: PortableData,
  exportedAt: string = new Date().toISOString()
): Record<string, TableOut> {
  const costs: Cell[][] = [];
  const boxes: Cell[][] = [];
  const aliases: Cell[][] = [];

  for (const sku of Object.keys(data.inputs).sort()) {
    const inp = data.inputs[sku];
    for (const lot of inp.lots ?? []) {
      costs.push([sku, lot.qty, lot.unitCost]);
    }
    if (BOX_FIELDS.some((f) => inp[f.key] !== undefined)) {
      boxes.push([sku, ...BOX_FIELDS.map((f) => inp[f.key] ?? null)]);
    }
    for (const alias of inp.aliasSkus ?? []) aliases.push([sku, alias]);
  }

  const settings: Cell[][] = [];
  const { sourceFilter, selectedPeriods } = data.settings;
  if (sourceFilter === "all") settings.push(["source_filter", null, "all"]);
  else for (const id of sourceFilter) settings.push(["source_filter", null, id]);
  for (const source of Object.keys(selectedPeriods).sort()) {
    for (const period of selectedPeriods[source]) {
      settings.push(["period", source, period]);
    }
  }

  return {
    Costs: { headers: COSTS_HEADERS, rows: costs },
    Boxes: { headers: BOXES_HEADERS, rows: boxes },
    Aliases: { headers: ALIASES_HEADERS, rows: aliases },
    Settings: { headers: SETTINGS_HEADERS, rows: settings },
    Meta: {
      headers: META_HEADERS,
      rows: [
        ["schema_version", SCHEMA_VERSION],
        ["exported_at", exportedAt],
        ["app", "byRaf Distribution Tools"],
      ],
    },
  };
}

/** Strings headed for a file cell: SKUs, IDs, names. Blocks formula execution. */
export function guardTables(
  tables: Record<string, TableOut>
): Record<string, TableOut> {
  const out: Record<string, TableOut> = {};
  for (const [name, t] of Object.entries(tables)) {
    out[name] = {
      headers: t.headers,
      rows: t.rows.map((r) =>
        r.map((c) => (typeof c === "string" ? text(c) : c))
      ),
    };
  }
  return out;
}

// ---------------------------------------------------------------------
// Import: tables -> data
// ---------------------------------------------------------------------

const headerKey = (h: string) => stripApostrophe(h).trim().toLowerCase();

/** Blank -> undefined. Non-numeric -> throws. Tolerates "$" and thousands separators. */
export function parseNumber(
  raw: string,
  label: string,
  decimalComma = false
): number | undefined {
  let s = stripApostrophe(raw).trim().replace(/^\$/, "");
  if (s === "") return undefined;
  if (decimalComma) {
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${label} "${raw}" is not a number`);
  return n;
}

interface Collector {
  inputs: Record<string, SkuInputs>;
  warnings: string[];
  errors: PortableImportError[];
  skippedRows: number;
  batches: number;
  settings: PortableSettings;
  schemaVersion: number;
}

function columnLookup(
  table: string,
  t: RawTable,
  required: string[],
  c: Collector
): ((label: string) => number) | null {
  const headers = t.headers.map(headerKey);
  const idx = (label: string) => headers.indexOf(label.toLowerCase());
  for (const label of required) {
    if (idx(label) === -1) {
      c.errors.push({
        table,
        row: 1,
        message: `Missing required "${label}" column.`,
      });
      return null;
    }
  }
  return idx;
}

function eachRow(
  table: string,
  t: RawTable,
  c: Collector,
  fn: (cells: string[], rowNum: number) => void
) {
  let rows = t.rows;
  if (rows.length > MAX_TABLE_ROWS) {
    c.errors.push({
      table,
      row: 0,
      message: `Table has ${rows.length} rows; only the first ${MAX_TABLE_ROWS} were read.`,
    });
    rows = rows.slice(0, MAX_TABLE_ROWS);
  }
  rows.forEach((cells, i) => {
    if (cells.every((x) => x.trim() === "")) return; // a fully blank row is not an error
    fn(cells, i + 2);
  });
}

function readSku(
  table: string,
  cells: string[],
  col: number,
  rowNum: number,
  c: Collector
): string | null {
  const raw = (cells[col] ?? "").trim();
  if (!raw) {
    c.skippedRows++;
    c.errors.push({ table, row: rowNum, message: "Blank SKU." });
    return null;
  }
  return normalizeSku(stripApostrophe(raw));
}

function readCosts(t: RawTable, c: Collector) {
  const idx = columnLookup("Costs", t, ["SKU", "Batch Qty", "Batch Unit Cost"], c);
  if (!idx) return;
  eachRow("Costs", t, c, (cells, rowNum) => {
    const sku = readSku("Costs", cells, idx("SKU"), rowNum, c);
    if (!sku) return;
    try {
      const dc = t.decimalComma;
      const qty = parseNumber(cells[idx("Batch Qty")] ?? "", "Batch Qty", dc);
      const unitCost = parseNumber(
        cells[idx("Batch Unit Cost")] ?? "",
        "Batch Unit Cost",
        dc
      );
      if (qty === undefined && unitCost === undefined) return; // SKU-only row
      if (qty === undefined || unitCost === undefined) {
        throw new Error(
          "Batch Qty and Batch Unit Cost must both be filled in, or both left blank"
        );
      }
      if (qty <= 0) throw new Error(`Batch Qty ${qty} must be greater than 0`);
      if (unitCost < 0) throw new Error(`Batch Unit Cost ${unitCost} can't be negative`);
      const entry = (c.inputs[sku] ??= {});
      entry.lots = [...(entry.lots ?? []), { qty, unitCost }];
      c.batches++;
    } catch (e) {
      c.skippedRows++;
      c.errors.push({ table: "Costs", row: rowNum, message: `SKU ${sku}: ${(e as Error).message}` });
    }
  });
}

function readBoxes(t: RawTable, c: Collector) {
  const idx = columnLookup("Boxes", t, ["SKU"], c);
  if (!idx) return;
  eachRow("Boxes", t, c, (cells, rowNum) => {
    const sku = readSku("Boxes", cells, idx("SKU"), rowNum, c);
    if (!sku) return;
    try {
      const values = BOX_FIELDS.map((f) => {
        const col = idx(f.label);
        const v =
          col === -1 ? undefined : parseNumber(cells[col] ?? "", f.label, t.decimalComma);
        if (v !== undefined && v < 0) throw new Error(`${f.label} ${v} can't be negative`);
        return { ...f, value: v };
      });
      const entry = (c.inputs[sku] ??= {});
      for (const { key, label, value } of values) {
        if (value === undefined) continue;
        const prev = entry[key];
        if (prev !== undefined && prev !== value) {
          c.warnings.push(
            `SKU ${sku}: conflicting ${label} values in the file (${prev} vs ${value}); using ${value}.`
          );
        }
        entry[key] = value;
      }
    } catch (e) {
      c.skippedRows++;
      c.errors.push({ table: "Boxes", row: rowNum, message: `SKU ${sku}: ${(e as Error).message}` });
    }
  });
}

function readAliases(t: RawTable, c: Collector) {
  const idx = columnLookup("Aliases", t, ["SKU", "Alias SKU"], c);
  if (!idx) return;
  eachRow("Aliases", t, c, (cells, rowNum) => {
    const sku = readSku("Aliases", cells, idx("SKU"), rowNum, c);
    if (!sku) return;
    const alias = normalizeSku(stripApostrophe(cells[idx("Alias SKU")] ?? ""));
    if (!alias) return; // SKU-only row
    const entry = (c.inputs[sku] ??= {});
    if (!(entry.aliasSkus ?? []).includes(alias)) {
      entry.aliasSkus = [...(entry.aliasSkus ?? []), alias];
    }
  });
}

function readSettings(t: RawTable, c: Collector) {
  const idx = columnLookup("Settings", t, ["Key", "Value"], c);
  if (!idx) return;
  const sourceCol = idx("Source");
  const filter: string[] = [];
  let all = false;
  let sawFilter = false;
  eachRow("Settings", t, c, (cells, rowNum) => {
    const key = stripApostrophe(cells[idx("Key")] ?? "").trim().toLowerCase();
    const value = stripApostrophe(cells[idx("Value")] ?? "").trim();
    const source = sourceCol === -1 ? "" : stripApostrophe(cells[sourceCol] ?? "").trim();
    if (key === "source_filter") {
      sawFilter = true;
      if (value.toLowerCase() === "all") all = true;
      else if (value) filter.push(value);
    } else if (key === "period") {
      if (!source || !value) {
        c.errors.push({ table: "Settings", row: rowNum, message: 'A "period" row needs both Source and Value.' });
        return;
      }
      (c.settings.selectedPeriods[source] ??= []).push(value);
    } else if (key) {
      c.warnings.push(`Settings row ${rowNum}: unknown key "${key}" ignored.`);
    }
  });
  if (sawFilter) c.settings.sourceFilter = all || filter.length === 0 ? "all" : filter;
}

function readMeta(t: RawTable, c: Collector) {
  const idx = columnLookup("Meta", t, ["Key", "Value"], c);
  if (!idx) return;
  eachRow("Meta", t, c, (cells) => {
    const key = stripApostrophe(cells[idx("Key")] ?? "").trim().toLowerCase();
    if (key !== "schema_version") return;
    const v = Number.parseInt(cells[idx("Value")] ?? "", 10);
    if (Number.isFinite(v)) c.schemaVersion = v;
  });
}

export function tablesToData(
  tables: RawTables
): Omit<PortableImportResult, "format" | "diff"> {
  const c: Collector = {
    inputs: {},
    warnings: [],
    errors: [],
    skippedRows: 0,
    batches: 0,
    settings: { selectedPeriods: {}, sourceFilter: "all" },
    schemaVersion: 1, // a file with no Meta is treated as v1
  };
  // Meta first: a newer file than we understand is rejected outright.
  if (tables.meta) readMeta(tables.meta, c);
  if (c.schemaVersion > SCHEMA_VERSION) {
    return finish({
      ...c,
      errors: [
        {
          table: "Meta",
          row: 0,
          message: `This file is schema version ${c.schemaVersion}; this app reads up to version ${SCHEMA_VERSION}. Update the app, or re-export from this version.`,
        },
      ],
    });
  }
  if (tables.costs) readCosts(tables.costs, c);
  if (tables.boxes) readBoxes(tables.boxes, c);
  if (tables.aliases) readAliases(tables.aliases, c);
  if (tables.settings) readSettings(tables.settings, c);
  if (!tables.costs && !tables.boxes && !tables.aliases && !tables.settings) {
    c.errors.push({
      table: "",
      row: 0,
      message: "No Costs, Boxes, Aliases or Settings table found in the file.",
    });
  }
  return finish(c);
}

function finish(c: Collector): Omit<PortableImportResult, "format" | "diff"> {
  const boxed = Object.values(c.inputs).filter((i) =>
    BOX_FIELDS.some((f) => i[f.key] !== undefined)
  ).length;
  const aliased = Object.values(c.inputs).filter((i) => i.aliasSkus?.length).length;
  return {
    data: { inputs: c.inputs, settings: c.settings },
    schemaVersion: c.schemaVersion,
    warnings: c.warnings,
    errors: c.errors,
    stats: {
      skus: Object.keys(c.inputs).length,
      batches: c.batches,
      boxed,
      aliased,
      skippedRows: c.skippedRows,
    },
  };
}

// ---------------------------------------------------------------------
// Diff / merge against what's already entered
// ---------------------------------------------------------------------

/** Canonical form for comparing two SKUs' inputs; null when nothing is entered. */
function fingerprint(inp: SkuInputs | undefined): string | null {
  if (!inp) return null;
  const lots = (inp.lots ?? []).map((l) => [l.qty, l.unitCost]);
  const box = BOX_FIELDS.map((f) => inp[f.key] ?? null);
  const aliases = [...(inp.aliasSkus ?? [])].sort();
  if (lots.length === 0 && aliases.length === 0 && box.every((b) => b === null)) {
    return null;
  }
  return JSON.stringify([lots, box, aliases]);
}

export function diffInputs(
  current: Record<string, SkuInputs>,
  incoming: Record<string, SkuInputs>
): PortableDiff {
  const diff: PortableDiff = { added: [], changed: [], unchanged: [] };
  for (const sku of Object.keys(incoming).sort()) {
    const next = fingerprint(incoming[sku]);
    if (next === null) continue;
    const prev = fingerprint(current[sku]);
    if (prev === null) diff.added.push(sku);
    else if (prev === next) diff.unchanged.push(sku);
    else diff.changed.push(sku);
  }
  return diff;
}

/**
 * Merge: the file wins for the SKUs and fields it carries - a batch list
 * or alias list in the file *replaces* that SKU's list (appending would
 * double-count batches on every re-import); box fields are per-field.
 * Anything the file doesn't mention is kept. Replace: just the file.
 */
export function applyImport(
  current: Record<string, SkuInputs>,
  incoming: Record<string, SkuInputs>,
  mode: "merge" | "replace"
): Record<string, SkuInputs> {
  if (mode === "replace") return structuredClone(incoming);
  const out: Record<string, SkuInputs> = structuredClone(current);
  for (const [sku, inp] of Object.entries(incoming)) {
    const entry = (out[sku] ??= {});
    if (inp.lots?.length) entry.lots = inp.lots;
    if (inp.aliasSkus?.length) entry.aliasSkus = inp.aliasSkus;
    for (const f of BOX_FIELDS) {
      if (inp[f.key] !== undefined) entry[f.key] = inp[f.key];
    }
  }
  return out;
}
