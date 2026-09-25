import { orderLinesToCsv, type MarginRow, type Report } from "@/lib/middleware";
import { downloadCsv, money } from "../../utils/format";
import { PanelHeader } from "../shared/PanelHeader";
import { OrderLineCard } from "../OrderLineCard";
import { TotalsCard, TotalsRow } from "../TotalsRow";

export function OrdersTab({
  margins,
  settledTotals,
  estimatedTotals,
  settledCount,
  estimatedCount,
  noEstimateCount,
}: {
  margins: MarginRow[];
  settledTotals: Report["settledTotals"];
  estimatedTotals: Report["estimatedTotals"];
  settledCount: number;
  estimatedCount: number;
  noEstimateCount: number;
}) {
  return (
    <>
      <PanelHeader
        title="Order lines"
        action={
          <button
            onClick={() => downloadCsv("order-lines", orderLinesToCsv(margins))}
            disabled={margins.length === 0}
            className="sc-btn"
            title="Downloads this table as a CSV, one row per order line, with a Status column (Settled / Estimated / Not estimable)."
          >
            Download CSV
          </button>
        }
      />
      <p className="text-sm text-sc-ink-2">
        Revenue − commission − shipping − other − your cost = profit. Fee
        columns are shown as the source reports them (negative = money
        out). <span className="italic">Est.</span> rows are orders not
        yet settled: revenue is exact, but commission and shipping are
        projected from that SKU&apos;s settled history and switch to
        exact figures once the order settles.
      </p>

      <ul className="flex flex-col gap-3 md:hidden">
        {margins.map((m) => (
          <OrderLineCard
            key={`${m.status}-${m.purchaseOrderNo}-${m.purchaseOrderLine}`}
            m={m}
          />
        ))}
        {margins.length === 0 && (
          <li className="text-sm text-sc-ink-2">No order lines found.</li>
        )}
        {settledCount > 0 && (
          <TotalsCard
            label={`Settled · ${settledCount} line${settledCount === 1 ? "" : "s"}`}
            totals={settledTotals}
            uncosted={
              margins.filter((m) => m.status === "settled" && !m.hasCost).length
            }
          />
        )}
        {estimatedCount > 0 && (
          <TotalsCard
            label={`Estimated · ${estimatedCount} line${estimatedCount === 1 ? "" : "s"}${noEstimateCount > 0 ? ` (+${noEstimateCount} not estimable, excluded)` : ""}`}
            totals={estimatedTotals}
            uncosted={
              margins.filter(
                (m) => m.status === "estimated" && !m.noEstimate && !m.hasCost
              ).length
            }
            italic
          />
        )}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="sc-table w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-sc-line text-left">
              <th className="pr-3">Status</th>
              <th className="pr-3">Source</th>
              <th className="pr-3">SKU</th>
              <th className="pr-3">Item</th>
              <th className="pr-3">Fulfillment</th>
              <th className="pr-3 text-right">Qty</th>
              <th className="pr-3 text-right">Revenue</th>
              <th className="pr-3 text-right">Commission</th>
              <th className="pr-3 text-right">Shipping</th>
              <th className="pr-3 text-right">Other</th>
              <th className="pr-3 text-right">Net</th>
              <th className="pr-3 text-right">Cost</th>
              <th className="pr-3 text-right">Profit</th>
              <th className="pr-3 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {margins.map((m) => {
              const est = m.status === "estimated";
              const noEst = (
                <span
                  className="text-amber-600"
                  title={m.estimateNote}
                >
                  no estimate
                </span>
              );
              return (
                <tr
                  key={`${m.status}-${m.purchaseOrderNo}-${m.purchaseOrderLine}`}
                  className={`border-b border-sc-row ${est ? "italic text-sc-ink-2" : ""}`}
                >
                  <td
                    className="pr-3"
                    title={
                      est ? `Ordered ${m.orderDate} · ${m.estimateNote}` : undefined
                    }
                  >
                    {est ? `Est. · ${m.orderDate?.slice(5)}` : "Settled"}
                  </td>
                  <td className="pr-3">{m.sourceLabel ?? "—"}</td>
                  <td className="pr-3">{m.sku}</td>
                  <td
                    className="max-w-[11rem] truncate pr-3"
                    title={m.itemName}
                  >
                    {m.itemName}
                  </td>
                  <td className="pr-3">{m.fulfillmentType}</td>
                  <td className="pr-3 text-right">{m.qty}</td>
                  <td className="pr-3 text-right">{money(m.revenue)}</td>
                  <td
                    className="pr-3 text-right text-red-600"
                    title={
                      est
                        ? m.estimateNote
                        : m.commissionRate
                          ? `Commission rate: ${m.commissionRate}%`
                          : undefined
                    }
                  >
                    {m.noEstimate ? noEst : money(m.commission)}
                  </td>
                  <td
                    className="pr-3 text-right text-red-600"
                    title={est ? m.estimateNote : undefined}
                  >
                    {m.noEstimate ? noEst : money(m.shipping)}
                  </td>
                  <td
                    className="pr-3 text-right"
                    title={`Tax collected/withheld: ${money(m.tax)}`}
                  >
                    {money(m.tax + m.otherFees)}
                  </td>
                  <td className="pr-3 text-right">
                    {m.noEstimate ? noEst : money(m.netAmount)}
                  </td>
                  <td
                    className="pr-3 text-right"
                    title={`Item ${money(m.itemCostTotal)} + box ${money(m.boxCostTotal)}`}
                  >
                    {m.costTotal !== 0 || m.hasCost ? (
                      money(-m.costTotal)
                    ) : (
                      <span className="text-amber-600">—</span>
                    )}
                  </td>
                  <td
                    className="pr-3 text-right font-medium"
                    title={
                      !m.noEstimate && !m.hasCost
                        ? "No cost entered for this SKU, so profit isn't known yet"
                        : undefined
                    }
                  >
                    {m.noEstimate ? (
                      noEst
                    ) : m.hasCost ? (
                      money(m.profit)
                    ) : (
                      <span className="text-amber-600">—</span>
                    )}
                  </td>
                  <td className="pr-3 text-right">
                    {m.noEstimate ? (
                      noEst
                    ) : !m.hasCost ? (
                      <span className="text-amber-600">no cost</span>
                    ) : m.margin === null ? (
                      "—"
                    ) : (
                      `${(m.margin * 100).toFixed(1)}%`
                    )}
                  </td>
                </tr>
              );
            })}
            {margins.length === 0 && (
              <tr>
                <td
                  colSpan={14}
                  className="py-3 text-sc-ink-2"
                >
                  No order lines found.
                </td>
              </tr>
            )}
          </tbody>
          {margins.length > 0 && (
            <tfoot>
              {settledCount > 0 && (
                <TotalsRow
                  label={`Settled · ${settledCount} line${settledCount === 1 ? "" : "s"}`}
                  totals={settledTotals}
                  uncosted={
                    margins.filter((m) => m.status === "settled" && !m.hasCost)
                      .length
                  }
                  first
                />
              )}
              {estimatedCount > 0 && (
                <TotalsRow
                  label={`Estimated · ${estimatedCount} line${estimatedCount === 1 ? "" : "s"}${noEstimateCount > 0 ? ` (+${noEstimateCount} with no estimate, excluded)` : ""}`}
                  totals={estimatedTotals}
                  uncosted={
                    margins.filter(
                      (m) =>
                        m.status === "estimated" && !m.noEstimate && !m.hasCost
                    ).length
                  }
                  first={settledCount === 0}
                  italic
                />
              )}
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
