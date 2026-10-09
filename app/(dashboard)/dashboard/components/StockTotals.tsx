import type { Report } from "@/lib/gateway";
import { money } from "../utils/format";

/**
 * What the stock on hand is worth, in total. Totals say how many SKUs
 * they cover, so a partial total can't read as the whole picture.
 */
export function StockTotals({ totals: t }: { totals: Report["stock"]["totals"] }) {
  if (t.stockedSkus === 0) {
    return <p className="text-sm text-sc-ink-2">Nothing in stock right now.</p>;
  }

  const uncosted = t.stockedSkus - t.costedSkus;
  const unlisted = t.stockedSkus - t.pricedSkus - t.unpublishedSkus;

  return (
    <div className="flex flex-col gap-3">
      {t.oversellSkus > 0 && (
        <p className="text-sm text-amber-600">
          {t.oversellSkus} SKU{t.oversellSkus === 1 ? "" : "s"} where a source
          reports more on hand than your purchase records support - see
          &ldquo;Left&rdquo; below.
        </p>
      )}
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <div className="text-sc-ink-2">Stock at cost</div>
          <div className="text-lg font-semibold">
            {t.costedSkus > 0 ? money(t.atCost) : "—"}
          </div>
          <div className="text-xs text-sc-ink-2">
            {t.costedSkus} of {t.stockedSkus} stocked SKU
            {t.stockedSkus === 1 ? "" : "s"}
            {uncosted > 0 && (
              <span className="text-amber-600">
                {" "}
                · {uncosted} with no cost entered
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-sc-ink-2">Stock at current price</div>
          <div className="text-lg font-semibold">
            {t.pricedSkus > 0 ? money(t.atPrice) : "—"}
          </div>
          <div className="text-xs text-sc-ink-2">
            {t.pricedSkus} of {t.stockedSkus} stocked SKU
            {t.stockedSkus === 1 ? "" : "s"}
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
    </div>
  );
}
