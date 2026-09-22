"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { commitCostsCsv, previewCostsCsv, type CsvPreviewRow } from "../actions";

export function CsvImport() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<CsvPreviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setParseError(null);
    try {
      const text = await file.text();
      const rows = await previewCostsCsv(text);
      setPreview(rows);
    } catch (err) {
      setPreview(null);
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setCommitting(true);
    try {
      const { imported } = await commitCostsCsv(preview);
      setResult(`Imported ${imported} of ${preview.length} row(s).`);
      setPreview(null);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } finally {
      setCommitting(false);
    }
  }

  const validCount = preview?.filter((r) => r.valid).length ?? 0;
  const invalidCount = (preview?.length ?? 0) - validCount;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">CSV import</label>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="text-sm"
        />
        <span className="text-xs text-black/50 dark:text-white/50">
          columns: sku, unit_cost, effective_from, note (optional)
        </span>
      </div>

      {parseError && <p className="text-sm text-red-600">{parseError}</p>}
      {result && <p className="text-sm text-black/70 dark:text-white/70">{result}</p>}

      {preview && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {validCount} valid, {invalidCount} invalid — review before importing.
          </p>
          <div className="max-h-64 overflow-auto rounded border border-black/10 dark:border-white/15">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left dark:bg-white/10">
                <tr>
                  <th className="px-2 py-1">Line</th>
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 py-1">Unit cost</th>
                  <th className="px-2 py-1">Effective from</th>
                  <th className="px-2 py-1">Note</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr
                    key={row.line}
                    className={row.valid ? "" : "bg-red-500/10"}
                  >
                    <td className="px-2 py-1">{row.line}</td>
                    <td className="px-2 py-1">{row.partnerItemId}</td>
                    <td className="px-2 py-1">{row.unitCost}</td>
                    <td className="px-2 py-1">{row.effectiveFrom}</td>
                    <td className="px-2 py-1">{row.note}</td>
                    <td className="px-2 py-1">
                      {row.valid ? "OK" : row.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={committing || validCount === 0}
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {committing ? "Importing…" : `Import ${validCount} row(s)`}
            </button>
            <button
              onClick={() => {
                setPreview(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
              disabled={committing}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
