# Import / Export (XLSX + CSV) — Plan

Status: **proposed, 2026-10-03.** Not started. Decisions so far are recorded at the bottom.

## Goal

The app is stateless (see [Data Model](./systems/data-model.md)): every cost, box size and alias SKU typed in is lost on refresh. Until persistence exists, the seller needs to **save a session's inputs to a file and load them back**. The file must work for both of these:

- **Editing by hand:** opened, edited and saved in Excel, Numbers or Google Sheets.
- **Editing by script:** read and written by a Python/`pandas` or Node script with no special handling.

So there are two formats over **one schema**:

| Format | Shape | Best for |
|---|---|---|
| **XLSX** | One workbook, one sheet per table | Hand-editing; keeps SKUs as text and numbers as numbers |
| **CSV bundle** | One `.csv` per table, zipped together | Scripts, diffs, git, `pandas.read_csv` |
| **Single CSV** (existing) | Today's cost CSV, unchanged | Quick bulk cost entry, as now |

## What exists today

- `lib/gateway/engine/csv.ts`: a hand-written RFC 4180 writer (`toCsv`, with BOM and formula guard) and parser (`parseCsv`). Also `costsToCsv` and `parseCostImportCsv` for the cost CSV, plus size and row caps (2 MB, 5,000 rows).
- `InventoryTab`: **Export costs** and **Import CSV** buttons.
- `ImportPreviewCard`: a confirm step showing stats, warnings and errors. Apply **replaces** all cost inputs.
- `DashboardClient` holds the user-entered state: `inputs` (box fields), `lotDrafts`, `aliasDrafts`, `selectedPeriods`, `sourceFilter` and `connections` (credentials).
- `scripts/test-csv-import.ts`: plain `tsx` fixture checks, run with `npm run test:csv`.

The existing cost CSV stays fully supported. Its columns are unchanged, so older files keep importing.

## Scope

**In the file (round-trips):**

| Table | Rows | Columns |
|---|---|---|
| `Costs` | One per purchase batch | `SKU`, `Batch Qty`, `Batch Unit Cost` |
| `Boxes` | One per SKU with any box info | `SKU`, `Box Cost`, `Box Length`, `Box Width`, `Box Height` |
| `Aliases` | One per SKU→alias pair | `SKU`, `Alias SKU` |
| `Settings` | Key/value | `Key`, `Value` (selected periods per source, source filter) |
| `Meta` | Key/value | `schema_version`, `exported_at`, `app` |

These are long/tidy tables: one fact per row, no merged cells, no `"; "`-joined lists. That is what makes them easy for scripts. `Aliases` changes from the cost CSV's joined cell to one pair per row for this reason.

**Export-only (ignored on import):** `Report – By SKU`, `Report – Order lines`, `Report – Stock value`. They reuse the existing report CSV builders and are always recalculated from the data.

**Never in the file:**
- **API credentials** (`connections`). A spreadsheet is easy to email or upload by mistake, and these keys give full API access.
- **The fetched marketplace snapshot.** That data changes, and you can re-fetch it.

## Library choice

| Option | Verdict |
|---|---|
| `xlsx` (SheetJS) from npm | **No.** The npm build is stuck at 0.18.5, which has known CVEs (prototype pollution, ReDoS). Fixed builds ship only from SheetJS's own CDN. |
| `exceljs` | **No.** About 21 MB unpacked, Node-oriented dependencies (`archiver`, `tmp`, streams), and last released in 2023. |
| **`read-excel-file` + `write-excel-file`** | **Yes.** Small, actively maintained, browser-first. Both are built on **`fflate`**. |
| **`fflate`** (direct) | **Yes.** Zips and unzips the CSV bundle. It's already a transitive dependency of the two above, so the zip support is close to free. |

That's three packages, all small and sharing `fflate`. All three load **lazily** with `await import()` the first time someone clicks Export or Import, so the dashboard's first load doesn't grow. Before writing that code, read the lazy-loading guide in `node_modules/next/dist/docs/`, per `AGENTS.md`.

## Architecture

```
app/ (dashboard)                              lib/gateway/ (engine)
───────────────────                           ─────────────────────────────────
InventoryTab / header menu                    engine/portable/
  Export ▸ Workbook (.xlsx)  ───────────────▶   schema.ts   table defs: name, columns, types,
           CSV bundle (.zip)                                 toRows(state), fromRows(rows)
           Costs only (.csv)  (existing)        xlsx.ts     workbook ⇄ tables   (lazy lib)
  Import ▸ any of the above  ───────────────▶   zip.ts      zip ⇄ CSV tables    (lazy fflate)
                                                detect.ts   sniff .xlsx / .zip / .csv
ImportPreviewCard  ◀── PortableImportResult     index.ts    exportWorkbook, exportCsvBundle,
  (diff + Merge/Replace)                                     parseImportFile
```

- **The boundary holds:** `app/` imports only `@/lib/gateway`. The new functions are re-exported from `lib/gateway/index.ts`, next to `parseCostCsv`. The libraries are imported only inside `engine/portable/`.
- **One schema, two encoders:** `schema.ts` is the only place that knows column names and types. `xlsx.ts` and `zip.ts` only move a `Record<tableName, Cell[][]>` in and out of a file, so the two formats can't drift.
- **Shared validation:** a table's rows are validated the same way whichever format they came from. That logic is lifted out of today's `parseCostImportCsv`, which then becomes a thin adapter onto the new schema.

### Public API (sketch)

```ts
// lib/gateway/index.ts
export interface PortableData {
  inputs: CostInputs;                          // costs, boxes, aliases
  settings: { selectedPeriods: Record<string, string[]>; sourceFilter: string[] | "all" };
}
export function exportWorkbook(data: PortableData, report?: Report): Promise<Blob>;
export function exportCsvBundle(data: PortableData, report?: Report): Promise<Blob>;
export function parseImportFile(file: File): Promise<PortableImportResult>;

export interface PortableImportResult {
  data: PortableData;
  format: "xlsx" | "zip" | "csv";
  schemaVersion: number;
  warnings: string[];
  errors: { table: string; row: number; message: string }[];
  diff: { added: string[]; changed: string[]; unchanged: string[] };   // vs current state
}
```

## File format rules

- **Versioning:** `Meta.schema_version` starts at `1`. Import rejects a newer major version with a clear message. A file without `Meta` (the old cost CSV, or a hand-made CSV) is treated as v1.
- **Headers are matched case-insensitively and by name, not position.** Extra columns are ignored, and missing optional columns are treated as blank. This is the same rule as today.
- **SKUs are always text.** XLSX writes them as string cells, so `00123` survives. CSV quotes nothing extra, but import never coerces SKUs to numbers.
- **Numbers:** plain decimals with a `.` separator, and no currency symbols in the file. Import tolerates a leading `$` and thousands commas, with a warning.
- **Formula guard:** the same `guardFormula` rule applies to XLSX text cells as to CSV. Import strips the leading `'`.
- **CSV bundle:** files are named after their table (`costs.csv`, `boxes.csv`, `aliases.csv`, `settings.csv`, `meta.csv`), UTF-8 with BOM and CRLF, as now.
- **Single-table CSV import:** the table is detected from its headers, so a lone `costs.csv` or the legacy cost CSV both work.
- **Limits:** 2 MB per CSV and 5,000 rows per table, as today. An XLSX or zip upload is capped at 5 MB compressed. Unzipping is bounded, with total uncompressed size ≤ 20 MB, to stop zip bombs.

## Import UX

1. One **Import** button accepts `.xlsx,.zip,.csv`.
2. The file is parsed and validated with no state change.
3. `ImportPreviewCard` shows:
   - format and schema version
   - per-table counts
   - the **diff** against what's loaded now (N new SKUs, N changed, N unchanged)
   - warnings and errors (the existing lists)
4. The user picks one of:
   - **Merge:** the file's values win for SKUs in the file, and everything else is kept.
   - **Replace:** all inputs are cleared first, which is today's behavior.
   - **Cancel.**
5. **Settings:** if marketplace data is already loaded, the source filter applies immediately. Selected periods only apply on the next connect: they are stored as a pending selection and used instead of "select all" when `listPeriods` returns. Periods the source no longer offers are dropped with a warning.

## Export UX

An **Export** menu, in the dashboard header so it's reachable from any tab:
- **Workbook (.xlsx):** all tables, plus report sheets when data is loaded.
- **CSV bundle (.zip):** the same tables.
- **Costs only (.csv):** today's button, unchanged.

The filename is `byraf-YYYY-MM-DD.xlsx` or `.zip`. Export also works before any marketplace data is loaded, since costs typed from an import or by hand are still worth saving.

## Phases

| # | Phase | Output | Check |
|---|---|---|---|
| 1 | **Schema + CSV bundle** | `engine/portable/schema.ts`, `zip.ts`, `detect.ts`. Refactor `parseCostImportCsv` onto the schema. Add `fflate`. | `test:csv` still green, plus new round-trip and legacy-file fixtures |
| 2 | **XLSX** | `xlsx.ts`. Add `read-excel-file` and `write-excel-file`. | Round-trip fixtures: export → import gives identical `PortableData`. A file saved by Excel imports correctly. |
| 3 | **Dashboard wiring** | Export menu, a single Import accepting all three formats, Merge/Replace in `ImportPreviewCard`, pending period selection | Manual run with the Demo source. `lint` and `check:boundary` pass. |
| 4 | **Report sheets** | Export-only report sheets in both formats | Open in Excel, and load with `pandas` |
| 5 | **Docs** | Update README ("Known limitations"), `docs/systems/frontend.md`, `engine.md`, `testing-and-deployment.md`, `docs/index.md` | n/a |

Each phase is a separate PR-sized commit. Phase 1 is useful on its own: it delivers scriptable save/restore with no XLSX dependency.

## Tests (`scripts/test-csv-import.ts`, then a new `scripts/test-portable.ts`)

- Round trip for each format: `PortableData` → file → `PortableData` gives deep-equal output, including multi-batch SKUs, aliases, and SKUs with leading zeros or unicode.
- The legacy cost CSV, including the `"; "` alias cell, still imports.
- A single-table CSV is detected by its headers.
- Formula-guarded cells (`=`, `+`, `-`, `@`) are escaped on export and restored on import.
- Rejections: unknown `schema_version`, oversized file, zip bomb, a non-xlsx file renamed `.xlsx`, missing `SKU` column.
- Merge vs Replace produce the expected state and diff.
- Report sheets are present on export and ignored on import.

## Risks

- **Bundle size:** mitigated by lazy loading. Measure the chunk sizes after phase 2.
- **Excel locale quirks:** some locales save CSVs with `;` and decimal commas. Phase 1 handles this for CSV by sniffing the delimiter from the header row. XLSX is immune, which is one reason to steer hand-editors to it.
- **Library drift:** if `read-excel-file`/`write-excel-file` stalls, `xlsx.ts` is the only file that touches it, so swapping it out is a one-file change.
- **Persistence later:** when the database is revived, `PortableData` is the natural shape for its save/load API. This is not throwaway work.

## Decisions

| Date | Decision |
|---|---|
| 2026-10-03 | Support **both** XLSX (hand-editing) and CSV (scripting), over one shared schema |
| 2026-10-03 | The CSV form of a multi-table export is a **zip of per-table CSVs**. The existing single cost CSV stays. |
| 2026-10-03 | **Credentials are never exported** |
| 2026-10-03 | The fetched marketplace snapshot is **not** exported for re-import, only as report sheets |
| 2026-10-03 | Import shows a diff and offers **Merge or Replace** |

## Open questions

- Should the Export menu live in the dashboard header (proposed) or stay on the Inventory & costs tab?
- Should a **blank template** export (headers only, every loaded SKU pre-listed, like today's cost CSV) be offered separately, or is "export with nothing entered" enough?
