import type { SkuStockRecord } from "@/lib/gateway";

/** Tooltip for a product's reported on-hand count: each source's own split. */
export function reportedTitle(stock: SkuStockRecord): string | undefined {
  const parts = stock.bySource.map((b) => {
    const split =
      b.availToSell !== null && b.reserved !== null
        ? `${b.availToSell} available to sell + ${b.reserved} ordered but not shipped`
        : `${b.onHand} on hand`;
    return stock.bySource.length > 1 ? `${b.sourceLabel}: ${split}` : split;
  });
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** "the source says 8", or with several sources "the highest source count is 8". */
export function reportedPhrase(stock: SkuStockRecord): string {
  return stock.bySource.length > 1
    ? `the highest source count is ${stock.reported}`
    : `the source says ${stock.reported}`;
}
