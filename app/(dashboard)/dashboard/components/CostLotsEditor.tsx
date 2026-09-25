import { averageUnitCost, type CostLot } from "@/lib/middleware";
import type { LotDraft } from "../types";
import { money, plural } from "../utils/format";

export function CostLotsEditor({
  sku,
  drafts,
  onAdd,
  onUpdate,
  onRemove,
  aliasValue,
  onAliasChange,
}: {
  sku: string;
  drafts: LotDraft[];
  onAdd: () => void;
  onUpdate: (index: number, field: keyof LotDraft, value: string) => void;
  onRemove: (index: number) => void;
  aliasValue: string;
  onAliasChange: (value: string) => void;
}) {
  const parsed: CostLot[] = drafts
    .map((d) => ({ qty: parseFloat(d.qty), unitCost: parseFloat(d.unitCost) }))
    .filter((l) => !Number.isNaN(l.qty) && !Number.isNaN(l.unitCost));
  const avg = averageUnitCost(parsed);
  const units = parsed.reduce((n, l) => n + l.qty, 0);
  const spent = parsed.reduce((n, l) => n + l.qty * l.unitCost, 0);

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <span className="text-xs text-sc-ink-2">
        Purchase batches for {sku}
      </span>

      {drafts.map((lot, i) => (
        <div key={i} className="flex w-full items-center gap-2 sm:w-auto">
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Qty"
            aria-label={`Batch ${i + 1} quantity for ${sku}`}
            value={lot.qty}
            onChange={(e) => onUpdate(i, "qty", e.target.value)}
            inputMode="numeric"
            className="sc-input w-16 shrink-0 text-right sm:w-20"
          />
          <span className="text-sc-ink-2/70">×</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Price each"
            aria-label={`Batch ${i + 1} unit cost for ${sku}`}
            value={lot.unitCost}
            onChange={(e) => onUpdate(i, "unitCost", e.target.value)}
            inputMode="decimal"
            className="sc-input w-24 shrink-0 text-right sm:w-28"
          />
          <span className="hidden text-right text-sc-ink-2 sm:inline sm:w-24">
            {!Number.isNaN(parseFloat(lot.qty)) &&
            !Number.isNaN(parseFloat(lot.unitCost))
              ? money(parseFloat(lot.qty) * parseFloat(lot.unitCost))
              : ""}
          </span>
          <button
            onClick={() => onRemove(i)}
            className="ml-auto shrink-0 p-2 text-sc-ink-2/70 hover:text-red-600 sm:ml-0"
            aria-label={`Remove batch ${i + 1} for ${sku}`}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button onClick={onAdd} className="sc-link text-sm">
          + Add batch
        </button>
        {units > 0 && (
          <span className="text-sm text-sc-ink-2">
            {plural(units, "unit")} · {money(spent)} spent ·
            avg {avg === null ? "—" : money(avg)} each
          </span>
        )}
      </div>

      <label className="mt-1 flex w-full flex-col gap-1 text-xs text-sc-ink-2 sm:max-w-xs">
        Alias SKUs (other sources&apos; SKUs for this same product)
        <input
          type="text"
          placeholder="e.g. SRC2-SKU-01, SRC3-SKU-1"
          aria-label={`Alias SKUs for ${sku}`}
          value={aliasValue}
          onChange={(e) => onAliasChange(e.target.value)}
          className="sc-input w-full text-sc-ink"
        />
      </label>
    </div>
  );
}
