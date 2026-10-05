/** CSV text <-> tables. Shared by the single-CSV and zipped-CSV paths. */
import { parseCsv, toCsv } from "../csv";
import type { RawTable, TableOut } from "./schema";

/** Some Excel locales save "a;b;c". Pick the delimiter that the header row uses more. */
export function sniffDelimiter(text: string): "," | ";" {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

export function csvToRawTable(text: string): RawTable | null {
  const delimiter = sniffDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return null;
  return {
    headers: rows[0],
    rows: rows.slice(1),
    decimalComma: delimiter === ";",
  };
}

export function tableToCsv(t: TableOut): string {
  return toCsv(t.headers, t.rows);
}

/** Which table a lone CSV is, judged by its headers (case-insensitive). */
export function classifyTable(
  headers: string[]
): "costs" | "boxes" | "aliases" | "settings" | "meta" | "legacy" | null {
  const h = new Set(headers.map((x) => x.replace(/^'/, "").trim().toLowerCase()));
  if (!h.has("sku")) {
    if (h.has("key") && h.has("source") && h.has("value")) return "settings";
    if (h.has("key") && h.has("value")) return "meta";
    return null;
  }
  const costs = h.has("batch qty") || h.has("batch unit cost");
  const boxes = h.has("box cost");
  const aliases = h.has("alias sku") || h.has("alias skus");
  // The pre-portable cost CSV: batches + box + a joined "Alias SKUs" cell in one table.
  if (h.has("alias skus") || (costs && boxes)) return "legacy";
  if (costs) return "costs";
  if (boxes) return "boxes";
  if (aliases) return "aliases";
  return null;
}
