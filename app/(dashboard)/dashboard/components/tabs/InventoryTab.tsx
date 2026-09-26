import { Fragment, type ChangeEvent, type RefObject } from "react";
import {
  DIM_DIVISOR,
  averageUnitCost,
  costsToCsv,
  cubicInches,
  dimWeight,
  reconcileStock,
  type CostImportResult,
  type CostInputs,
  type Report,
  type SkuInputs,
} from "@/lib/middleware";
import { BOX_FIELDS, type LotDraft, type SkuField } from "../../types";
import { downloadCsv, money, plural } from "../../utils/format";
import { PanelHeader } from "../shared/PanelHeader";
import { ImportPreviewCard } from "../shared/ImportPreviewCard";
import { Unset } from "../shared/Unset";
import { InventoryCard } from "../InventoryCard";
import { CostLotsEditor } from "../CostLotsEditor";

export function InventoryTab({
  skus,
  parsedInputs,
  inventoryBySku,
  soldBySku,
  inputs,
  lotDrafts,
  expanded,
  aliasDrafts,
  importPreview,
  importFileRef,
  setField,
  addLot,
  updateLot,
  removeLot,
  toggleExpanded,
  updateAliasDraft,
  handleImportFile,
  applyImport,
  cancelImport,
}: {
  skus: string[];
  parsedInputs: CostInputs;
  inventoryBySku: Map<string, Report["inventory"][number]>;
  soldBySku: Map<string, number>;
  inputs: Record<string, Partial<Record<SkuField, string>>>;
  lotDrafts: Record<string, LotDraft[]>;
  expanded: Set<string>;
  aliasDrafts: Record<string, string>;
  importPreview: CostImportResult | null;
  importFileRef: RefObject<HTMLInputElement | null>;
  setField: (sku: string, field: SkuField, value: string) => void;
  addLot: (sku: string) => void;
  updateLot: (sku: string, index: number, field: keyof LotDraft, value: string) => void;
  removeLot: (sku: string, index: number) => void;
  toggleExpanded: (sku: string) => void;
  updateAliasDraft: (sku: string, value: string) => void;
  handleImportFile: (e: ChangeEvent<HTMLInputElement>) => void;
  applyImport: () => void;
  cancelImport: () => void;
}) {
  return (
    <>
      <PanelHeader
        title="Inventory and costs"
        action={
          <div className="flex gap-2">
            <button
              onClick={() =>
                downloadCsv("costs", costsToCsv(skus, parsedInputs as Record<string, SkuInputs>))
              }
              disabled={skus.length === 0}
              className="sc-btn"
              title="Downloads every SKU's purchase batches and box info as a CSV - blank if nothing entered yet, so it also works as a fill-in template."
            >
              Export costs
            </button>
            <button
              onClick={() => importFileRef.current?.click()}
              className="sc-btn"
            >
              Import CSV
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>
        }
      >
        Not saved — re-enter each session. Add a batch for each price you
        bought an item at, including units already sold; cost per unit is
        the quantity-weighted average across batches. &ldquo;Left&rdquo;
        is purchased − sold and should match the source&apos;s on-hand
        count.
      </PanelHeader>
      {importPreview && (
        <ImportPreviewCard
          preview={importPreview}
          existingSkuCount={
            new Set([...Object.keys(inputs), ...Object.keys(lotDrafts)]).size
          }
          onApply={applyImport}
          onCancel={cancelImport}
        />
      )}

      {/* Phone: one card per SKU. Tables take over from md up. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {skus.map((sku) => {
          const parsed = parsedInputs[sku] ?? {};
          const inv = inventoryBySku.get(sku);
          return (
            <InventoryCard
              key={sku}
              sku={sku}
              onHand={inv ? inv.onHand : null}
              onHandTitle={
                inv
                  ? `${inv.availToSell} available to sell + ${inv.reserved} ordered but not shipped`
                  : undefined
              }
              stock={reconcileStock(parsed.lots, soldBySku.get(sku) ?? 0, inv ? inv.onHand : null)}
              avg={averageUnitCost(parsed.lots)}
              cu={cubicInches(parsed)}
              dim={dimWeight(parsed)}
              boxValues={inputs[sku] ?? {}}
              onBoxChange={(field, value) => setField(sku, field, value)}
              drafts={lotDrafts[sku] ?? []}
              isOpen={expanded.has(sku)}
              onToggle={() => toggleExpanded(sku)}
              onAdd={() => addLot(sku)}
              onUpdate={(i, field, value) => updateLot(sku, i, field, value)}
              onRemove={(i) => removeLot(sku, i)}
              aliasValue={aliasDrafts[sku] ?? ""}
              onAliasChange={(value) => updateAliasDraft(sku, value)}
            />
          );
        })}
        {skus.length === 0 && (
          <li className="text-sm text-sc-ink-2">No SKUs found in the returned data.</li>
        )}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="sc-table w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-sc-line text-left">
              <th className="pr-3">SKU</th>
              <th className="pr-3 text-right">On hand</th>
              <th className="pr-3 text-right">Sold</th>
              <th className="pr-3 text-right">Bought</th>
              <th
                className="pr-3 text-right"
                title="Purchased − sold. Amber when it disagrees with the source's on-hand count."
              >
                Left
              </th>
              <th className="pr-3 text-right">Avg cost</th>
              {BOX_FIELDS.map((f) => (
                <th key={f.key} className="pr-3 text-right">
                  {f.label}
                </th>
              ))}
              <th className="pr-3 text-right">Cu in</th>
              <th
                className="pr-3 text-right"
                title={`Volume ÷ ${DIM_DIVISOR}. An estimate of billable dimensional weight — not what the carrier actually charged.`}
              >
                Dim wt
              </th>
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => {
              const parsed = parsedInputs[sku] ?? {};
              const cu = cubicInches(parsed);
              const dim = dimWeight(parsed);
              const drafts = lotDrafts[sku] ?? [];
              const inv = inventoryBySku.get(sku);
              const stock = reconcileStock(
                parsed.lots,
                soldBySku.get(sku) ?? 0,
                inv ? inv.onHand : null
              );
              const avg = averageUnitCost(parsed.lots);
              const isOpen = expanded.has(sku);

              return (
                <Fragment key={sku}>
                  <tr className="border-b border-sc-row">
                    <td className="pr-3">
                      <button
                        onClick={() => toggleExpanded(sku)}
                        className="sc-link text-left"
                        title={
                          drafts.length > 0
                            ? plural(drafts.length, "batch", "batches")
                            : "Add a purchase batch"
                        }
                      >
                        <span className="text-sc-ink-2/70">
                          {isOpen ? "▾ " : "▸ "}
                        </span>
                        {sku}
                        {drafts.length > 0 && (
                          <span className="text-sc-ink-2/70">
                            {" "}
                            ({drafts.length})
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="pr-3 text-right">
                      {inv ? (
                        <span
                          title={`${inv.availToSell} available to sell + ${inv.reserved} ordered but not shipped.`}
                        >
                          {inv.onHand}
                        </span>
                      ) : (
                        <Unset />
                      )}
                    </td>
                    <td className="pr-3 text-right">
                      {soldBySku.get(sku) ?? 0}
                    </td>
                    <td className="pr-3 text-right">
                      {stock.purchased || <Unset />}
                    </td>
                    <td
                      className={`pr-3 text-right ${stock.discrepancy ? "text-amber-600" : ""}`}
                      title={
                        stock.discrepancy
                          ? `Your batches imply ${stock.impliedOnHand} left, the source says ${stock.onHand}. Off by ${stock.discrepancy > 0 ? "+" : ""}${stock.discrepancy} — likely a missing or mistyped batch.`
                          : undefined
                      }
                    >
                      {stock.purchased === 0 ? <Unset /> : stock.impliedOnHand}
                    </td>
                    <td className="pr-3 text-right font-medium">
                      {avg === null ? (
                        <Unset variant="warn" />
                      ) : (
                        money(avg)
                      )}
                    </td>
                    {BOX_FIELDS.map((f) => (
                      <td key={f.key} className="pr-3">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={f.step}
                          min="0"
                          placeholder="—"
                          aria-label={`${f.label} for ${sku}`}
                          value={inputs[sku]?.[f.key] ?? ""}
                          onChange={(e) =>
                            setField(sku, f.key, e.target.value)
                          }
                          className="w-24 sc-input text-right"
                        />
                      </td>
                    ))}
                    <td className="pr-3 text-right text-sc-ink-2">
                      {cu === null ? "—" : cu.toFixed(0)}
                    </td>
                    <td className="pr-3 text-right text-sc-ink-2">
                      {dim === null ? "—" : `${dim.toFixed(1)} lb`}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-sc-row bg-sc-head">
                      <td colSpan={BOX_FIELDS.length + 8} className="px-3 py-3">
                        <CostLotsEditor
                          sku={sku}
                          drafts={drafts}
                          onAdd={() => addLot(sku)}
                          onUpdate={(i, field, value) =>
                            updateLot(sku, i, field, value)
                          }
                          onRemove={(i) => removeLot(sku, i)}
                          aliasValue={aliasDrafts[sku] ?? ""}
                          onAliasChange={(value) => updateAliasDraft(sku, value)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {skus.length === 0 && (
              <tr>
                <td
                  colSpan={BOX_FIELDS.length + 8}
                  className="py-3 text-sc-ink-2"
                >
                  No SKUs found in the returned data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
