import type { MarginRow } from "@/lib/middleware";
import { money } from "../utils/format";
import { Fig } from "./shared/Fig";

export function OrderLineCard({ m }: { m: MarginRow }) {
  const est = m.status === "estimated";
  const noEst = <span className="text-amber-600">no estimate</span>;
  return (
    <li
      className={`rounded-lg border border-sc-line p-3 ${est ? "bg-sc-head/60" : ""}`}
      title={est ? m.estimateNote : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-xs ${est ? "italic text-sc-ink-2" : "text-sc-ink-2"}`}>
            {m.sourceLabel ? `${m.sourceLabel} · ` : ""}
            {est ? `Estimated · ordered ${m.orderDate}` : `Settled · ${m.postedDate ?? ""}`}
          </div>
          <div className="font-bold break-words">{m.sku}</div>
          <div className="truncate text-xs text-sc-ink-2">
            {m.qty} × {m.itemName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-sc-ink-2">Profit</div>
          <div className="font-bold">
            {m.noEstimate ? (
              noEst
            ) : m.hasCost ? (
              money(m.profit)
            ) : (
              <span className="text-amber-600">—</span>
            )}
          </div>
          <div className="text-xs">
            {m.noEstimate ? null : !m.hasCost ? (
              <span className="text-amber-600">no cost</span>
            ) : m.margin === null ? null : (
              `${(m.margin * 100).toFixed(1)}% margin`
            )}
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
        <Fig label="Revenue">{money(m.revenue)}</Fig>
        <Fig label="Commission">
          {m.noEstimate ? noEst : <span className="text-red-600">{money(m.commission)}</span>}
        </Fig>
        <Fig label="Shipping">
          {m.noEstimate ? noEst : <span className="text-red-600">{money(m.shipping)}</span>}
        </Fig>
        <Fig label="Net">{m.noEstimate ? noEst : money(m.netAmount)}</Fig>
        <Fig label="Cost">
          {m.hasCost || m.costTotal !== 0 ? (
            money(-m.costTotal)
          ) : (
            <span className="text-amber-600">—</span>
          )}
        </Fig>
        <Fig label="Other">{money(m.tax + m.otherFees)}</Fig>
      </dl>
      {est && m.estimateNote && (
        <p className="mt-2 text-xs text-sc-ink-2">{m.estimateNote}</p>
      )}
    </li>
  );
}
