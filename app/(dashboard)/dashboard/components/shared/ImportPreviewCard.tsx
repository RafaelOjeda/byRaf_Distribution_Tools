import type { CostImportResult } from "@/lib/middleware";

export function ImportPreviewCard({
  preview,
  existingSkuCount,
  onApply,
  onCancel,
}: {
  preview: CostImportResult;
  existingSkuCount: number;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { stats, warnings, errors } = preview;
  return (
    <div className="sc-card flex flex-col gap-3 border-2 border-sc-line p-4">
      <h3 className="text-base font-bold">Review import</h3>
      <p className="text-sm text-sc-ink-2">
        {stats.skus} SKU{stats.skus === 1 ? "" : "s"} — {stats.batches}{" "}
        purchase batch{stats.batches === 1 ? "" : "es"}, {stats.boxed} with
        box info, {stats.aliased} with alias SKUs.
        {stats.skippedRows > 0 &&
          ` ${stats.skippedRows} row${stats.skippedRows === 1 ? "" : "s"} skipped, see below.`}
      </p>
      {existingSkuCount > 0 && (
        <p className="text-sm text-amber-600">
          This replaces your current entries for {existingSkuCount} SKU
          {existingSkuCount === 1 ? "" : "s"}.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-amber-600">
          {warnings.slice(0, 20).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {warnings.length > 20 && <li>…and {warnings.length - 20} more</li>}
        </ul>
      )}
      {errors.length > 0 && (
        <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-red-600">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>
              {e.row > 0 ? `Row ${e.row}: ` : ""}
              {e.message}
            </li>
          ))}
          {errors.length > 20 && <li>…and {errors.length - 20} more</li>}
        </ul>
      )}
      <div className="flex gap-2">
        <button
          onClick={onApply}
          disabled={stats.skus === 0}
          className="sc-btn-primary"
        >
          Apply import
        </button>
        <button onClick={onCancel} className="sc-btn">
          Cancel
        </button>
      </div>
    </div>
  );
}
