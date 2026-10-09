import type { ReactNode } from "react";
import { Table } from "@/components/ui";
import type { MarginRow } from "@/lib/gateway";
import { money } from "../utils/format";
import { OrderLineCard } from "./OrderLineCard";

/**
 * Order lines as phone cards and a desktop table, from the report's own
 * rows. Used flat (Sales → All lines) and, with `compact`, inside an
 * expanded product row - the same MarginRow objects either way, so a
 * product's lines can't disagree with its rollup.
 */
export function OrderLinesTable({
  lines,
  compact = false,
  layout = "both",
  footerRows,
  footerCards,
}: {
  lines: MarginRow[];
  /** Inside a product row: no Item column, cards drawn without their own border. */
  compact?: boolean;
  /** Which half to render; a nested table only needs the one its parent is showing. */
  layout?: "both" | "cards" | "table";
  footerRows?: ReactNode;
  footerCards?: ReactNode;
}) {
  const columns = compact ? 12 : 13;
  return (
    <>
      {layout !== "table" && (
        <ul className={`flex flex-col gap-3 ${layout === "both" ? "md:hidden" : ""}`}>
          {lines.map((m) => (
            <OrderLineCard
              key={`${m.status}-${m.purchaseOrderNo}-${m.purchaseOrderLine}`}
              m={m}
              nested={compact}
            />
          ))}
          {lines.length === 0 && (
            <li className="text-sm text-sc-ink-2">No order lines found.</li>
          )}
          {footerCards}
        </ul>
      )}

      {layout !== "cards" && (
      <div className={`overflow-x-auto ${layout === "both" ? "hidden md:block" : ""}`}>
        <Table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-sc-line text-left">
              <th className="pr-3">Status</th>
              <th className="pr-3">Source</th>
              {!compact && <th className="pr-3">Item</th>}
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
            {lines.map((m) => {
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
                  {!compact && (
                    <td
                      className="max-w-[11rem] truncate pr-3"
                      title={m.itemName}
                    >
                      {m.itemName}
                    </td>
                  )}
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
            {lines.length === 0 && (
              <tr>
                <td colSpan={columns} className="py-3 text-sc-ink-2">
                  No order lines found.
                </td>
              </tr>
            )}
          </tbody>
          {footerRows && lines.length > 0 && <tfoot>{footerRows}</tfoot>}
        </Table>
      </div>
      )}
    </>
  );
}
