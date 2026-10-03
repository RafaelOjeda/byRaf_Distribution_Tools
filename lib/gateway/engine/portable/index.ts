/**
 * Save/load the user-entered inputs as a file: a zipped CSV bundle, an
 * XLSX workbook, or a single CSV (including the original cost CSV).
 * See docs/import-export-plan.md.
 */
import { parseCostImportCsv } from "../csv";
import {
  EMPTY_SETTINGS,
  dataToTables,
  diffInputs,
  guardTables,
  tablesToData,
  type PortableData,
  type PortableFormat,
  type PortableImportResult,
  type RawTables,
} from "./schema";
import type { SkuInputs } from "../margins";
import { classifyTable, csvToRawTable, sniffDelimiter } from "./tabular";
import { MAX_FILE_BYTES, tablesToZip, zipNames, zipToRawTables } from "./zip";

export {
  EMPTY_SETTINGS,
  applyImport,
  diffInputs,
  type PortableData,
  type PortableDiff,
  type PortableFormat,
  type PortableImportError,
  type PortableImportResult,
  type PortableSettings,
} from "./schema";

export async function exportCsvBundle(
  data: PortableData,
  exportedAt?: string
): Promise<Uint8Array> {
  return tablesToZip(guardTables(dataToTables(data, exportedAt)));
}

function failure(
  format: PortableFormat,
  message: string
): PortableImportResult {
  return {
    data: { inputs: {}, settings: EMPTY_SETTINGS },
    format,
    schemaVersion: 1,
    warnings: [],
    errors: [{ table: "", row: 0, message }],
    stats: { skus: 0, batches: 0, boxed: 0, aliased: 0, skippedRows: 0 },
    diff: { added: [], changed: [], unchanged: [] },
  };
}

const looksBinary = (bytes: Uint8Array) =>
  bytes.subarray(0, 1024).includes(0);
const isZip = (b: Uint8Array) =>
  b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function withDiff(
  r: Omit<PortableImportResult, "diff" | "format">,
  format: PortableFormat,
  current: Record<string, SkuInputs>
): PortableImportResult {
  return { ...r, format, diff: diffInputs(current, r.data.inputs) };
}

/** Auto-detects xlsx / zip bundle / csv. Never throws - problems come back as `errors`. */
export async function parseImportFile(
  bytes: Uint8Array,
  current: Record<string, SkuInputs> = {}
): Promise<PortableImportResult> {
  if (bytes.length === 0) return failure("csv", "File is empty.");
  if (bytes.length > MAX_FILE_BYTES) {
    return failure("csv", `File is larger than ${MAX_FILE_BYTES / (1024 * 1024)}MB.`);
  }

  try {
    if (isZip(bytes)) {
      const names = await zipNames(bytes);
      if (names.includes("xl/workbook.xml")) {
        return failure("xlsx", "XLSX import is not available yet.");
      }
      const { tables, problems } = await zipToRawTables(bytes);
      const r = withDiff(tablesToData(tables), "zip", current);
      return { ...r, errors: [...problems.map((message) => ({ table: "", row: 0, message })), ...r.errors] };
    }
    if (looksBinary(bytes)) {
      return failure("csv", "This isn't an .xlsx, .zip or .csv file.");
    }
    return parseSingleCsv(new TextDecoder().decode(bytes), current);
  } catch (e) {
    return failure("csv", `Couldn't read the file: ${(e as Error).message}`);
  }
}

function parseSingleCsv(
  text: string,
  current: Record<string, SkuInputs>
): PortableImportResult {
  const table = csvToRawTable(text);
  if (!table) return failure("csv", "File is empty.");
  const kind = classifyTable(table.headers);
  if (kind === null) {
    return failure(
      "csv",
      'Unrecognized columns. Expected a Costs, Boxes, Aliases or Settings table (or the original cost CSV with "SKU" and "Batch Qty").'
    );
  }

  if (kind === "legacy") {
    const legacy = parseCostImportCsv(text, sniffDelimiter(text));
    return withDiff(
      {
        data: { inputs: legacy.inputs, settings: EMPTY_SETTINGS },
        schemaVersion: 1,
        warnings: legacy.warnings,
        errors: legacy.errors.map((e) => ({ table: "Costs", ...e })),
        stats: legacy.stats,
      },
      "csv",
      current
    );
  }

  const tables: RawTables = { [kind]: table };
  return withDiff(tablesToData(tables), "csv", current);
}
