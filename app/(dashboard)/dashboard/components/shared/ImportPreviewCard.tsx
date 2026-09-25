import type { CostImportResult } from "@/lib/middleware";
import { plural } from "../../utils/format";

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
        {plural(stats.skus, "SKU")} — {plural(stats.batches, "purchase batch", "purchase batches")}, {stats.boxed} with
        box info, {stats.aliased} with alias SKUs.
        {stats.skippedRows > 0 &&
          ` ${plural(stats.skippedRows, "row")} skipped, see below.`}
      </p>
      {existingSkuCount > 0 && (
        <p className="text-sm text-amber-600">
          This replaces your current entries for {plural(existingSkuCount, "SKU")}.
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
