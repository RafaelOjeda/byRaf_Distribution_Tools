/**
 * XLSX workbook: one sheet per table. The two libraries load on first
 * use so they stay out of the dashboard's initial bundle.
 *
 * Text cells are written as typed strings, which a spreadsheet never
 * executes, so unlike CSV there's no formula guard here - and SKUs such
 * as "00123" stay text instead of becoming 123.
 */
import type { Cell, RawTable, RawTables, TableOut } from "./schema";

export async function tablesToXlsx(
  tables: Record<string, TableOut>
): Promise<Uint8Array> {
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const sheets = Object.entries(tables).map(([name, t]) => ({
    sheet: name,
    columns: t.headers.map((h) => ({ width: Math.max(14, h.length + 4) })),
    data: [
      t.headers.map((h) => ({ value: h, fontWeight: "bold" as const })),
      ...t.rows.map((r) => r.map(toCell)),
    ],
  }));
  const blob = await writeExcelFile(sheets).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

function toCell(c: Cell) {
  if (c === null) return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  return { value: c, type: String };
}

const asText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

export async function xlsxToRawTables(bytes: Uint8Array): Promise<RawTables> {
  const { default: readExcelFile } = await import("read-excel-file/universal");
  const sheets = await readExcelFile(new Blob([bytes as BlobPart]));
  const tables: RawTables = {};
  for (const { sheet, data } of sheets) {
    if (data.length === 0) continue;
    const t: RawTable = {
      headers: data[0].map(asText),
      rows: data.slice(1).map((r) => r.map(asText)),
    };
    tables[sheet.trim().toLowerCase()] = t;
  }
  return tables;
}
