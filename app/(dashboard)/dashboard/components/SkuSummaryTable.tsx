import { SHIPPING_PCT_ALERT, SHIPPING_PCT_WARN, type SkuSummary } from "@/lib/middleware";
import { money } from "../utils/format";
import { shipPctClass } from "../utils/shipping";
import { Fig } from "./shared/Fig";

export function SkuSummaryTable({ summaries }: { summaries: SkuSummary[] }) {
  const dash = <span className="text-sc-ink-2/70">—</span>;

  return (
    <>
    <ul className="flex flex-col gap-3 md:hidden">
      {summaries.map((s) => {
        const t = s.totals;
        const unknownProfit = s.hasMoney && s.missingCost;
        return (
          <li key={s.sku} className="rounded-lg border border-sc-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold break-words">{s.sku}</div>
                <div className="truncate text-xs text-sc-ink-2">{s.itemName}</div>
                {s.bySource.length > 1 && (
                  <div className="truncate text-xs text-sc-ink-2">
                    {s.bySource
                      .map((b) => `${b.sourceLabel} ${b.units}`)
                      .join(" · ")}
                  </div>
                )}
                {s.possibleDuplicates.length > 0 && (
                  <div
                    className="truncate text-xs text-amber-600"
                    title={`Might be the same product as: ${s.possibleDuplicates.join(", ")}. Add an alias under Inventory & costs to merge them.`}
                  >
                    possible duplicate of {s.possibleDuplicates.join(", ")}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-sc-ink-2">Profit</div>
                <div className="font-bold">
                  {!s.hasMoney ? (
                    dash
                  ) : unknownProfit ? (
                    <span className="text-amber-600">—</span>
                  ) : (
                    money(t.profit)
                  )}
                </div>
                <div className="text-xs">
                  {!s.hasMoney ? null : unknownProfit ? (
                    <span className="text-amber-600">no cost</span>
                  ) : s.margin === null ? null : (
                    `${(s.margin * 100).toFixed(1)}% margin`
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 text-xs text-sc-ink-2">
              {s.units} unit{s.units === 1 ? "" : "s"} · {s.lines} line
              {s.lines === 1 ? "" : "s"}
              {s.estimatedLines > 0 && ` (${s.estimatedLines} est.)`}
              {s.noEstimateLines > 0 && ` · ${s.noEstimateLines} not estimable`}
            </p>

            {s.hasMoney ? (
              <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                <Fig label="Revenue">{money(t.revenue)}</Fig>
                <Fig label="Avg price">
                  {s.avgPrice === null ? dash : money(s.avgPrice)}
                </Fig>
                <Fig label="Net">{money(t.netAmount)}</Fig>
                <Fig label="Commission">
                  <span className="text-red-600">{money(t.commission)}</span>
                </Fig>
                <Fig
                  label="Shipping"
                  title={`Amber above ${SHIPPING_PCT_WARN * 100}% of revenue, red above ${SHIPPING_PCT_ALERT * 100}%.`}
                >
                  <span className="text-red-600">{money(t.shipping)}</span>
                  {s.shippingPct !== null && (
                    <span className={`block text-xs ${shipPctClass(s.shippingPct) || "text-sc-ink-2"}`}>
                      {(s.shippingPct * 100).toFixed(1)}% of revenue
                    </span>
                  )}
                </Fig>
                <Fig label="Cost">
                  {s.missingCost ? (
                    <span className="text-amber-600">—</span>
                  ) : (
                    money(-t.costTotal)
                  )}
                </Fig>
              </dl>
            ) : (
              <p className="mt-2 text-xs text-sc-ink-2">
                No settled history for this SKU yet, so its fees can&apos;t be
                estimated.
              </p>
            )}
          </li>
        );
      })}
      {summaries.length === 0 && (
        <li className="text-sm text-sc-ink-2">No SKUs found.</li>
      )}
    </ul>

    <div className="hidden overflow-x-auto md:block">
      <table className="sc-table w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-sc-line text-left">
            <th className="pr-3">SKU</th>
            <th className="pr-3">Item</th>
            <th className="pr-3 text-right">Units</th>
            <th className="pr-3 text-right">Lines</th>
            <th className="pr-3 text-right">Avg price</th>
            <th className="pr-3 text-right">Revenue</th>
            <th className="pr-3 text-right">Commission</th>
            <th className="pr-3 text-right">Shipping</th>
            <th
              className="pr-3 text-right"
              title={`Shipping as a share of revenue. Amber above ${SHIPPING_PCT_WARN * 100}%, red above ${SHIPPING_PCT_ALERT * 100}%.`}
            >
              Ship %
            </th>
            <th className="pr-3 text-right">Net</th>
            <th className="pr-3 text-right">Cost</th>
            <th className="pr-3 text-right">Profit</th>
            <th className="pr-3 text-right">Margin</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const t = s.totals;
            const pct = s.shippingPct;
            const pctClass = shipPctClass(pct);
            const noMoneyTitle = s.hasMoney
              ? undefined
              : "No settled history for this SKU yet, so its fees can't be estimated";

            return (
              <tr
                key={s.sku}
                className="border-b border-sc-row"
              >
                <td
                  className="pr-3"
                  title={
                    s.bySource.length > 1
                      ? s.bySource.map((b) => `${b.sourceLabel}: ${b.units} units`).join(" · ")
                      : undefined
                  }
                >
                  {s.sku}
                  {s.bySource.length > 1 && (
                    <span className="text-sc-ink-2/70"> ({s.bySource.length} sources)</span>
                  )}
                </td>
                <td
                  className="max-w-[11rem] truncate pr-3"
                  title={
                    s.possibleDuplicates.length > 0
                      ? `${s.itemName} - possible duplicate of ${s.possibleDuplicates.join(", ")}`
                      : s.itemName
                  }
                >
                  {s.itemName}
                  {s.possibleDuplicates.length > 0 && (
                    <span className="ml-1 text-amber-600">⚠</span>
                  )}
                </td>
                <td className="pr-3 text-right">{s.units}</td>
                <td
                  className="pr-3 text-right"
                  title={`${s.settledLines} settled, ${s.estimatedLines} estimated${s.noEstimateLines > 0 ? `, ${s.noEstimateLines} not estimable` : ""}`}
                >
                  {s.lines}
                  {s.estimatedLines > 0 && (
                    <span className="text-sc-ink-2/70">
                      {" "}
                      ({s.estimatedLines} est.)
                    </span>
                  )}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {s.avgPrice === null ? dash : money(s.avgPrice)}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {s.hasMoney ? money(t.revenue) : dash}
                </td>
                <td
                  className="pr-3 text-right text-red-600"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.commission) : dash}
                </td>
                <td
                  className="pr-3 text-right text-red-600"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.shipping) : dash}
                </td>
                <td
                  className={`pr-3 text-right ${pctClass}`}
                  title={noMoneyTitle}
                >
                  {pct === null ? dash : `${(pct * 100).toFixed(1)}%`}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {s.hasMoney ? money(t.netAmount) : dash}
                </td>
                <td
                  className="pr-3 text-right"
                  title={
                    s.hasMoney
                      ? `Item ${money(t.itemCostTotal)} + box ${money(t.boxCostTotal)}`
                      : noMoneyTitle
                  }
                >
                  {!s.hasMoney ? (
                    dash
                  ) : s.missingCost ? (
                    <span className="text-amber-600">—</span>
                  ) : (
                    money(-t.costTotal)
                  )}
                </td>
                <td
                  className="pr-3 text-right font-medium"
                  title={noMoneyTitle}
                >
                  {!s.hasMoney ? (
                    dash
                  ) : s.missingCost ? (
                    <span
                      className="text-amber-600"
                      title="No cost entered for this SKU, so profit isn't known yet"
                    >
                      —
                    </span>
                  ) : (
                    money(t.profit)
                  )}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {!s.hasMoney ? (
                    dash
                  ) : s.missingCost ? (
                    <span className="text-amber-600">no cost</span>
                  ) : s.margin === null ? (
                    dash
                  ) : (
                    `${(s.margin * 100).toFixed(1)}%`
                  )}
                </td>
              </tr>
            );
          })}
          {summaries.length === 0 && (
            <tr>
              <td colSpan={13} className="py-3 text-sc-ink-2">
                No SKUs found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
