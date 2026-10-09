import { Button, Input, Table, TextButton } from "@/components/ui";
import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import type { ProductRecord, Report } from "@/lib/gateway";
import { BOX_FIELDS, type LotDraft, type SkuField } from "../../types";
import { money } from "../../utils/format";
import { reportedPhrase, reportedTitle, valuedAtTitle } from "../../utils/stock";
import { PanelHeader } from "../shared/PanelHeader";
import { InventoryCard } from "../InventoryCard";
import { CostLotsEditor } from "../CostLotsEditor";
import { StockTotals } from "../StockTotals";

const VALUE_COLS_KEY = "byraf-inventory-value-cols";
const VALUE_COLS = 3; // Listed price, Value @ cost, Value @ price

/** Remembered per browser; the tab only renders client-side, after data loads. */
function readShowValues(): boolean {
  try {
    return localStorage.getItem(VALUE_COLS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function InventoryTab({
  products,
  stockTotals,
  inputs,
  lotDrafts,
  expanded,
  aliasDrafts,
  setField,
  addLot,
  updateLot,
  removeLot,
  toggleExpanded,
  setAliasDrafts,
}: {
  /** Every figure shown here comes from these records - this tab works nothing out itself. */
  products: ProductRecord[];
  stockTotals: Report["stock"]["totals"];
  inputs: Record<string, Partial<Record<SkuField, string>>>;
  lotDrafts: Record<string, LotDraft[]>;
  expanded: Set<string>;
  aliasDrafts: Record<string, string>;
  setField: (sku: string, field: SkuField, value: string) => void;
  addLot: (sku: string) => void;
  updateLot: (sku: string, index: number, field: keyof LotDraft, value: string) => void;
  removeLot: (sku: string, index: number) => void;
  toggleExpanded: (sku: string) => void;
  setAliasDrafts: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const [showValues, setShowValues] = useState(readShowValues);
  function toggleValues() {
    const next = !showValues;
    setShowValues(next);
    try {
      localStorage.setItem(VALUE_COLS_KEY, next ? "1" : "0");
    } catch {
      // private mode: the choice just isn't remembered
    }
  }

  // What a source reports in stock comes first - that's what this tab is
  // mostly opened for. Keyed on the source's count, not your own batches,
  // so a row doesn't jump while you type a batch into it.
  const ordered = [
    ...products.filter((p) => (p.stock.reported ?? 0) > 0),
    ...products.filter((p) => !((p.stock.reported ?? 0) > 0)),
  ];

  return (
    <>
      <PanelHeader
        title="Inventory"
        action={
          <Button
            onClick={toggleValues}
            aria-pressed={showValues}
            variant={showValues ? "primary" : "default"}
            className="hidden md:inline-flex"
          >
            Show value columns
          </Button>
        }
      >
        Not saved automatically — use Export above to keep a file, and
        Import to load it back next session. Add a batch for each price you
        bought an item at, including units already sold; cost per unit is
        the quantity-weighted average across batches. &ldquo;Left&rdquo;
        is purchased − sold and should match the source&apos;s on-hand
        count. Stock is valued at &ldquo;Left&rdquo; once you&apos;ve
        entered batches, and at the source&apos;s count (an estimate)
        until then. The same units are never added up across sources.
      </PanelHeader>
      <StockTotals totals={stockTotals} />
      {/* Phone: one card per SKU. Tables take over from md up. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {ordered.map((p) => {
          const sku = p.sku;
          return (
            <InventoryCard
              key={sku}
              product={p}
              boxValues={inputs[sku] ?? {}}
              onBoxChange={(field, value) => setField(sku, field, value)}
              drafts={lotDrafts[sku] ?? []}
              isOpen={expanded.has(sku)}
              onToggle={() => toggleExpanded(sku)}
              onAdd={() => addLot(sku)}
              onUpdate={(i, field, value) => updateLot(sku, i, field, value)}
              onRemove={(i) => removeLot(sku, i)}
              aliasValue={aliasDrafts[sku] ?? ""}
              onAliasChange={(value) =>
                setAliasDrafts((prev) => ({ ...prev, [sku]: value }))
              }
            />
          );
        })}
        {products.length === 0 && (
          <li className="text-sm text-sc-ink-2">No SKUs found in the returned data.</li>
        )}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <Table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-sc-line text-left">
              <th className="pr-3">Item</th>
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
              {showValues && (
                <>
                  <th className="pr-3 text-right">Listed price</th>
                  <th className="pr-3 text-right">Value @ cost</th>
                  <th className="pr-3 text-right">Value @ price</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {ordered.map((p) => {
              const { sku, stock } = p;
              const name = p.name || sku;
              const drafts = lotDrafts[sku] ?? [];
              const avg = p.cost.avgCost;
              const isOpen = expanded.has(sku);

              return (
                <Fragment key={sku}>
                  <tr className="border-b border-sc-row">
                    <td className="pr-3">
                      <TextButton
                        onClick={() => toggleExpanded(sku)}
                        className="text-left"
                        title={
                          drafts.length > 0
                            ? `${drafts.length} batch${drafts.length === 1 ? "" : "es"}`
                            : "Add a purchase batch"
                        }
                      >
                        <span className="text-sc-ink-2/70">
                          {isOpen ? "▾ " : "▸ "}
                        </span>
                        {name}
                        {drafts.length > 0 && (
                          <span className="text-sc-ink-2/70">
                            {" "}
                            ({drafts.length})
                          </span>
                        )}
                      </TextButton>
                    </td>
                    <td className="pr-3 text-right">
                      {stock.reported !== null ? (
                        <span title={reportedTitle(stock)}>{stock.reported}</span>
                      ) : (
                        <span className="text-sc-ink-2/70">
                          —
                        </span>
                      )}
                    </td>
                    <td className="pr-3 text-right">
                      {stock.sold}
                    </td>
                    <td className="pr-3 text-right">
                      {stock.purchased || (
                        <span className="text-sc-ink-2/70">
                          —
                        </span>
                      )}
                    </td>
                    <td
                      className={`pr-3 text-right ${stock.discrepancy ? "text-amber-600" : ""}`}
                      title={
                        stock.discrepancy
                          ? `Your batches imply ${stock.left} left, ${reportedPhrase(stock)}. Off by ${stock.discrepancy > 0 ? "+" : ""}${stock.discrepancy} — likely a missing or mistyped batch.`
                          : undefined
                      }
                    >
                      {stock.left === null ? (
                        <span className="text-sc-ink-2/70">
                          —
                        </span>
                      ) : (
                        stock.left
                      )}
                    </td>
                    <td className="pr-3 text-right font-medium">
                      {avg === null ? (
                        <span className="text-amber-600">—</span>
                      ) : (
                        money(avg)
                      )}
                    </td>
                    {BOX_FIELDS.map((f) => (
                      <td key={f.key} className="pr-3">
                        <Input
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
                          className="w-24 text-right"
                        />
                      </td>
                    ))}
                    {showValues && <ValueCells stock={stock} />}
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-sc-row bg-sc-head">
                      <td colSpan={BOX_FIELDS.length + 6 + (showValues ? VALUE_COLS : 0)} className="px-3 py-3">
                        <CostLotsEditor
                          sku={sku}
                          name={name}
                          cost={p.cost}
                          drafts={drafts}
                          onAdd={() => addLot(sku)}
                          onUpdate={(i, field, value) =>
                            updateLot(sku, i, field, value)
                          }
                          onRemove={(i) => removeLot(sku, i)}
                          aliasValue={aliasDrafts[sku] ?? ""}
                          onAliasChange={(value) =>
                            setAliasDrafts((prev) => ({ ...prev, [sku]: value }))
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td
                  colSpan={BOX_FIELDS.length + 6 + (showValues ? VALUE_COLS : 0)}
                  className="py-3 text-sc-ink-2"
                >
                  No SKUs found in the returned data.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    </>
  );
}

/**
 * Listed price and stock value for one row. Values only show for rows the
 * stock totals above count (`inStock`), so the column always adds up to
 * the total.
 */
function ValueCells({ stock }: { stock: ProductRecord["stock"] }) {
  const dash = <span className="text-sc-ink-2/70">—</span>;
  const title = stock.inStock ? valuedAtTitle(stock) : "Not in stock";
  return (
    <>
      <td className="pr-3 text-right">
        {stock.listedPrice === null ? dash : money(stock.listedPrice)}
      </td>
      <td className="pr-3 text-right" title={title}>
        {!stock.inStock || stock.valueAtCost === null ? dash : money(stock.valueAtCost)}
      </td>
      <td
        className="pr-3 text-right"
        title={
          stock.inStock && stock.valueAtPrice !== null && !stock.isPublished
            ? `Not currently sellable: listing status is ${stock.publishedStatus}. Left out of the at-price total.`
            : title
        }
      >
        {!stock.inStock || stock.valueAtPrice === null ? (
          dash
        ) : stock.isPublished ? (
          money(stock.valueAtPrice)
        ) : (
          <span className="text-amber-600">{money(stock.valueAtPrice)} unpublished</span>
        )}
      </td>
    </>
  );
}
