import type { ChangeEvent, RefObject } from "react";
import { Button, Card, useButtonClass } from "@/components/ui";

export type ExportKind = "xlsx" | "zip" | "costs-csv";

/**
 * Export menu + Import button for the portable save file. Export is
 * optional because the connect screen can only load a file, not save one.
 */
export function SaveLoadControls({
  fileRef,
  onFile,
  onExport,
}: {
  fileRef: RefObject<HTMLInputElement | null>;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onExport?: (kind: ExportKind) => void;
}) {
  const buttonClass = useButtonClass();
  return (
    <div className="flex gap-2">
      {onExport && (
        <details className="relative">
          <summary className={`${buttonClass()} cursor-pointer list-none`}>Export ▾</summary>
          <Card className="absolute right-0 z-10 mt-1 flex w-64 flex-col p-1">
            {(
              [
                ["xlsx", "Workbook (.xlsx)", "One sheet per table - easiest to edit in Excel."],
                ["zip", "CSV bundle (.zip)", "One CSV per table - easiest to script."],
                ["costs-csv", "Costs only (.csv)", "Every loaded SKU's batches and box info, blank if none entered."],
              ] as [ExportKind, string, string][]
            ).map(([kind, label, hint]) => (
              <button
                key={kind}
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  onExport(kind);
                }}
                className="flex flex-col items-start px-3 py-2 text-left text-sm hover:bg-sc-head"
              >
                <span className="font-bold">{label}</span>
                <span className="text-xs text-sc-ink-2">{hint}</span>
              </button>
            ))}
          </Card>
        </details>
      )}
      <Button onClick={() => fileRef.current?.click()}>Import file</Button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.zip,.csv,text/csv"
        onChange={onFile}
        className="hidden"
        aria-label="Import a saved .xlsx, .zip or .csv file"
      />
    </div>
  );
}
