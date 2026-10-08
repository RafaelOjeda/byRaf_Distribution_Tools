import { Button, Card } from "@/components/ui";
import type { PortableImportResult } from "@/lib/gateway";

const FORMAT_LABEL = { xlsx: "workbook", zip: "CSV bundle", csv: "CSV" } as const;

export function ImportPreviewCard({
  preview,
  existingSkuCount,
  onApply,
  onCancel,
}: {
  preview: PortableImportResult;
  existingSkuCount: number;
  onApply: (mode: "merge" | "replace") => void;
  onCancel: () => void;
}) {
  const { stats, diff, warnings, errors, hasSettings } = preview;
  const nothingToApply = stats.skus === 0 && !hasSettings;
  const periodCount = Object.values(preview.data.settings.selectedPeriods).reduce(
    (n, p) => n + p.length,
    0
  );
  return (
    <Card className="flex flex-col gap-3 border-2 border-sc-line p-4">
      <h3 className="text-base font-bold">
        Review import <span className="font-normal">({FORMAT_LABEL[preview.format]})</span>
      </h3>
      <p className="text-sm text-sc-ink-2">
        {stats.skus} SKU{stats.skus === 1 ? "" : "s"} — {stats.batches}{" "}
        purchase batch{stats.batches === 1 ? "" : "es"}, {stats.boxed} with
        box info, {stats.aliased} with alias SKUs.
        {hasSettings &&
          ` Also saved: ${periodCount} selected period${periodCount === 1 ? "" : "s"}.`}
        {stats.skippedRows > 0 &&
          ` ${stats.skippedRows} row${stats.skippedRows === 1 ? "" : "s"} skipped, see below.`}
      </p>
      {existingSkuCount > 0 && stats.skus > 0 && (
        <p className="text-sm">
          Compared with your current entries: {diff.added.length} new,{" "}
          {diff.changed.length} changed, {diff.unchanged.length} unchanged.
          <span className="block text-xs text-sc-ink-2">
            <b>Merge</b> updates the SKUs in the file and keeps the rest.{" "}
            <b>Replace</b> clears everything first.
          </span>
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
              {e.table && e.row > 0 ? `${e.table} row ${e.row}: ` : e.table ? `${e.table}: ` : ""}
              {e.message}
            </li>
          ))}
          {errors.length > 20 && <li>…and {errors.length - 20} more</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {existingSkuCount > 0 && stats.skus > 0 ? (
          <>
            <Button variant="primary" onClick={() => onApply("merge")}>
              Merge
            </Button>
            <Button onClick={() => onApply("replace")}>Replace</Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() => onApply("replace")}
            disabled={nothingToApply}
          >
            Apply import
          </Button>
        )}
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
