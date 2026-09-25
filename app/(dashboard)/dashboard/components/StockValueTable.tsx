import type { Report } from "@/lib/middleware";
import { money, plural } from "../utils/format";
import { Fig } from "./shared/Fig";

export function StockValueTable({ stock }: { stock: Report["stock"] }) {
  const { rows, totals: t } = stock;
  const dash = <span className="text-sc-ink-2/70">—</span>;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-sc-ink-2">
        Nothing in stock right now.
      </p>
    );
  }

  const uncosted = t.stockedSkus - t.costedSkus;
  const unlisted = t.stockedSkus - t.pricedSkus - t.unpublishedSkus;

  return (
    <div className="flex flex-col gap-3">
      {t.oversellSkus > 0 && (
        <p className="text-sm text-amber-600">
          {plural(t.oversellSkus, "SKU")} where a source
          reports more on hand than your purchase records support - see
          &ldquo;On hand&rdquo; below.
        </p>
      )}
      {/* Totals say how many SKUs they cover, so a partial total can't
          read as the whole picture. */}
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <div className="text-sc-ink-2">At cost</div>
          <div className="text-lg font-semibold">
            {t.costedSkus > 0 ? money(t.atCost) : "—"}
          </div>
          <div className="text-xs text-sc-ink-2">
            {t.costedSkus} of {plural(t.stockedSkus, "stocked SKU")}
            {uncosted > 0 && (
              <span className="text-amber-600">
                {" "}
                · {uncosted} with no cost entered
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-sc-ink-2">
            At current price
          </div>
          <div className="text-lg font-semibold">
            {t.pricedSkus > 0 ? money(t.atPrice) : "—"}
          </div>
          <div className="text-xs text-sc-ink-2">
            {t.pricedSkus} of {plural(t.stockedSkus, "stocked SKU")}
            {t.unpublishedSkus > 0 && (
              <span className="text-amber-600">
                {" "}
                · excludes {t.unpublishedSkus} unpublished (can&apos;t sell
                right now)
              </span>
            )}
            {unlisted > 0 && (
              <span className="text-amber-600">
                {" "}
                · {unlisted} with no listed price
              </span>
            )}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.sku} className="rounded-lg border border-sc-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-bold break-words">{r.sku}</div>
              <div
                className={`shrink-0 text-sm ${r.oversellRisk ? "text-amber-600" : "text-sc-ink-2"}`}
                title={r.onHandIsEstimate ? "No cost batches entered - falling back to the largest source count" : undefined}
              >
                {r.onHand} on hand{r.onHandIsEstimate ? " (est.)" : ""}
              </div>
            </div>
            {r.bySource.length > 0 && (
              <p className="mt-1 text-xs text-sc-ink-2">
                {r.bySource.map((b) => `${b.sourceLabel} ${b.onHand}`).join(" · ")}
              </p>
            )}
            {r.oversellRisk && (
              <p className="mt-1 text-xs text-amber-600">
                A source reports more on hand than your purchase records support.
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <Fig label="Avg cost">
                {r.avgCost === null ? (
                  <span className="text-amber-600">no cost</span>
                ) : (
                  money(r.avgCost)
                )}
              </Fig>
              <Fig label="Listed price">
                {r.listedPrice === null ? dash : money(r.listedPrice)}
              </Fig>
              <Fig label="Value at cost">
                {r.valueAtCost === null ? dash : money(r.valueAtCost)}
              </Fig>
              <Fig label="Value at price">
                {r.valueAtPrice === null ? (
                  dash
                ) : r.isPublished ? (
                  money(r.valueAtPrice)
                ) : (
                  <span className="text-amber-600">{money(r.valueAtPrice)}</span>
                )}
              </Fig>
            </dl>
            {r.valueAtPrice !== null && !r.isPublished && (
              <p className="mt-2 text-xs text-amber-600">
                Unpublished ({r.publishedStatus}) — can&apos;t sell right now, so
                it&apos;s left out of the at-price total.
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="sc-table w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-sc-line text-left">
              <th className="pr-3">SKU</th>
              <th className="pr-3 text-right">On hand</th>
              <th className="pr-3 text-right">Avg cost</th>
              <th className="pr-3 text-right">Listed price</th>
              <th className="pr-3 text-right">Value at cost</th>
              <th className="pr-3 text-right">Value at price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.sku}
                className="border-b border-sc-row"
              >
                <td className="pr-3">{r.sku}</td>
                <td
                  className={`pr-3 text-right ${r.oversellRisk ? "text-amber-600" : ""}`}
                  title={
                    r.oversellRisk
                      ? `A source reports more on hand than your purchase records support: ${r.bySource.map((b) => `${b.sourceLabel} ${b.onHand}`).join(", ")}`
                      : r.onHandIsEstimate
                        ? "No cost batches entered - falling back to the largest source count"
                        : r.bySource.length > 0
                          ? r.bySource.map((b) => `${b.sourceLabel}: ${b.onHand}`).join(" · ")
                          : undefined
                  }
                >
                  {r.onHand}
                  {r.onHandIsEstimate ? " (est.)" : ""}
                </td>
                <td
                  className="pr-3 text-right"
                  title={
                    r.avgCost === null
                      ? "No purchase batches entered for this SKU"
                      : undefined
                  }
                >
                  {r.avgCost === null ? (
                    <span className="text-amber-600">no cost</span>
                  ) : (
                    money(r.avgCost)
                  )}
                </td>
                <td className="pr-3 text-right">
                  {r.listedPrice === null ? dash : money(r.listedPrice)}
                </td>
                <td className="pr-3 text-right">
                  {r.valueAtCost === null ? dash : money(r.valueAtCost)}
                </td>
                <td
                  className="pr-3 text-right"
                  title={
                    r.valueAtPrice !== null && !r.isPublished
                      ? `Not currently sellable: listing status is ${r.publishedStatus}. Left out of the at-price total.`
                      : undefined
                  }
                >
                  {r.valueAtPrice === null ? (
                    dash
                  ) : r.isPublished ? (
                    money(r.valueAtPrice)
                  ) : (
                    <span className="text-amber-600">
                      {money(r.valueAtPrice)} unpublished
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
