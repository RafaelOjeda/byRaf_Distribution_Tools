import { reconcileStock } from "@/lib/middleware";
import { BOX_FIELDS, type LotDraft, type SkuField } from "../types";
import { money } from "../utils/format";
import { Fig } from "./shared/Fig";
import { CostLotsEditor } from "./CostLotsEditor";

export function InventoryCard({
  sku,
  onHand,
  onHandTitle,
  stock,
  avg,
  cu,
  dim,
  boxValues,
  onBoxChange,
  drafts,
  isOpen,
  onToggle,
  onAdd,
  onUpdate,
  onRemove,
  aliasValue,
  onAliasChange,
}: {
  sku: string;
  onHand: number | null;
  onHandTitle?: string;
  stock: ReturnType<typeof reconcileStock>;
  avg: number | null;
  cu: number | null;
  dim: number | null;
  boxValues: Partial<Record<SkuField, string>>;
  onBoxChange: (field: SkuField, value: string) => void;
  drafts: LotDraft[];
  isOpen: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onUpdate: (index: number, field: keyof LotDraft, value: string) => void;
  onRemove: (index: number) => void;
  aliasValue: string;
  onAliasChange: (value: string) => void;
}) {
  const muted = <span className="text-sc-ink-2/70">—</span>;
  return (
    <li className="rounded-lg border border-sc-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-bold break-words">{sku}</div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-sc-ink-2">Avg cost</div>
          <div className="font-bold">
            {avg === null ? <span className="text-amber-600">no cost</span> : money(avg)}
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2">
        <Fig label="On hand" title={onHandTitle}>
          {onHand ?? muted}
        </Fig>
        <Fig label="Sold">{stock.sold}</Fig>
        <Fig label="Bought">{stock.purchased || muted}</Fig>
        <Fig
          label="Left"
          title={
            stock.discrepancy
              ? `Your batches imply ${stock.impliedOnHand} left, the source says ${stock.onHand}.`
              : undefined
          }
        >
          {stock.purchased === 0 ? (
            muted
          ) : (
            <span className={stock.discrepancy ? "text-amber-600" : ""}>
              {stock.impliedOnHand}
            </span>
          )}
        </Fig>
      </dl>
      {stock.discrepancy ? (
        <p className="mt-1 text-xs text-amber-600">
          Batches imply {stock.impliedOnHand} left; the source says {stock.onHand}.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {BOX_FIELDS.map((f) => (
          <label key={f.key} className="flex min-w-0 flex-col gap-1 text-xs text-sc-ink-2">
            {f.label}
            <input
              type="number"
              inputMode="decimal"
              step={f.step}
              min="0"
              placeholder="—"
              aria-label={`${f.label} for ${sku}`}
              value={boxValues[f.key] ?? ""}
              onChange={(e) => onBoxChange(f.key, e.target.value)}
              className="sc-input w-full min-w-0 text-right text-sc-ink"
            />
          </label>
        ))}
      </div>
      {(cu !== null || dim !== null) && (
        <p className="mt-1 text-xs text-sc-ink-2">
          {cu?.toFixed(0)} cu in · {dim?.toFixed(1)} lb dim wt (estimate)
        </p>
      )}

      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="sc-btn mt-3 w-full justify-between"
      >
        <span>
          Purchase batches{drafts.length > 0 ? ` (${drafts.length})` : ""}
        </span>
        <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
      </button>
      {isOpen && (
        <div className="mt-2 rounded-lg bg-sc-head p-3">
          <CostLotsEditor
            sku={sku}
            drafts={drafts}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onRemove={onRemove}
            aliasValue={aliasValue}
            onAliasChange={onAliasChange}
          />
        </div>
      )}
    </li>
  );
}
