/**
 * Zipped CSV bundle: one `<table>.csv` per table. fflate is loaded on
 * first use so it stays out of the dashboard's initial bundle.
 */
import type { RawTables, TableOut } from "./schema";
import { csvToRawTable, tableToCsv } from "./tabular";

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // compressed upload
export const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024; // zip-bomb guard
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 50;

/** Lists a zip's entries and their inflated size without inflating anything. */
export async function zipInfo(
  bytes: Uint8Array
): Promise<{ names: string[]; totalBytes: number }> {
  const { unzipSync } = await import("fflate");
  const names: string[] = [];
  let totalBytes = 0;
  unzipSync(bytes, {
    filter: (f) => {
      names.push(f.name);
      totalBytes += f.originalSize;
      return false; // list only, inflate nothing
    },
  });
  return { names, totalBytes };
}

export async function tablesToZip(
  tables: Record<string, TableOut>
): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (const [name, t] of Object.entries(tables)) {
    files[`${name.toLowerCase()}.csv`] = strToU8(tableToCsv(t));
  }
  return zipSync(files);
}

export async function zipToRawTables(
  bytes: Uint8Array
): Promise<{ tables: RawTables; problems: string[] }> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const problems: string[] = [];
  let total = 0;
  let entries = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (++entries > MAX_ENTRIES) throw new Error("Zip has too many files.");
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("Zip expands to too much data.");
        if (f.originalSize > MAX_CSV_BYTES && f.name.toLowerCase().endsWith(".csv")) {
          throw new Error(`${f.name} is larger than ${MAX_CSV_BYTES / (1024 * 1024)}MB.`);
        }
        return true;
      },
    });
  } catch (e) {
    return { tables: {}, problems: [(e as Error).message] };
  }

  const tables: RawTables = {};
  for (const [path, data] of Object.entries(files)) {
    const base = path.split("/").pop() ?? "";
    // macOS "Compress" adds __MACOSX/._name.csv resource forks; skip dotfiles.
    if (path.startsWith("__MACOSX/") || base.startsWith(".")) continue;
    if (!base.toLowerCase().endsWith(".csv")) continue;
    const name = base.slice(0, -4).toLowerCase();
    const table = csvToRawTable(strFromU8(data));
    if (table) tables[name] = table;
    else problems.push(`${base} is empty.`);
  }
  return { tables, problems };
}
