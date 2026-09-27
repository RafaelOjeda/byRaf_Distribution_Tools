import { normalizeSku } from "./types";

/** SkuCostInputs, structurally - avoids a contract -> engine -> contract import cycle. */
interface AliasedCostInputs {
  [sku: string]: { aliasSkus?: string[] } | undefined;
}

/**
 * Maps every declared alias SKU (normalized) to its canonical SKU key
 * (also normalized - CostInputs keys already are). Default identity: a
 * SKU with no alias resolves to itself, so calling code doesn't need a
 * fallback branch. See docs/multi-marketplace-plan.md, "Product identity
 * (phase 4, engine)".
 */
export function buildAliasIndex(costs: AliasedCostInputs): Map<string, string> {
  const index = new Map<string, string>();
  for (const [canonicalKey, input] of Object.entries(costs)) {
    for (const alias of input?.aliasSkus ?? []) {
      const normalized = normalizeSku(alias);
      if (normalized) index.set(normalized, canonicalKey);
    }
  }
  return index;
}

/**
 * Resolves a raw SKU to its canonical identity before any grouping -
 * every SKU-keyed lookup downstream (computeMargins, summarizeBySku,
 * stockValue, priceSeriesBySku) sees the resolved value, because
 * buildReport rewrites every line/inventory/catalog SKU with this before
 * calling any of them.
 */
export function resolveSku(sku: string, index: Map<string, string>): string {
  return index.get(normalizeSku(sku)) ?? sku;
}

/**
 * Flags SKUs that look like the same product but weren't explicitly
 * aliased - near-matches are surfaced, never merged silently. Two rules:
 * stripped of case/punctuation they're identical, or they share an exact
 * item name. Only compares distinct canonical SKUs (post alias
 * resolution), so an already-aliased pair is never flagged against
 * itself.
 */
export function findPossibleDuplicates(
  skus: { sku: string; itemName: string }[]
): Map<string, string[]> {
  const strip = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const byStripped = new Map<string, Set<string>>();
  const byItemName = new Map<string, Set<string>>();
  for (const { sku, itemName } of skus) {
    const strippedKey = strip(sku);
    if (strippedKey) {
      const set = byStripped.get(strippedKey) ?? new Set();
      set.add(sku);
      byStripped.set(strippedKey, set);
    }
    const nameKey = itemName.trim().toLowerCase();
    if (nameKey) {
      const set = byItemName.get(nameKey) ?? new Set();
      set.add(sku);
      byItemName.set(nameKey, set);
    }
  }

  const flagged = new Map<string, Set<string>>();
  const merge = (groups: Map<string, Set<string>>) => {
    for (const group of groups.values()) {
      if (group.size < 2) continue;
      for (const sku of group) {
        const others = flagged.get(sku) ?? new Set();
        for (const other of group) if (other !== sku) others.add(other);
        flagged.set(sku, others);
      }
    }
  };
  merge(byStripped);
  merge(byItemName);

  return new Map([...flagged.entries()].map(([sku, set]) => [sku, [...set]]));
}
