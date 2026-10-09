import type { CostInputs, SkuCostInputs } from "../contract";

/** The per-SKU number fields typed in directly (everything but batches and aliases). */
export type CostField = Exclude<keyof SkuCostInputs, "lots" | "aliasSkus">;

const COST_FIELDS: CostField[] = ["boxCost"];

/** Costs exactly as typed into the dashboard, before parsing. Keyed by normalizeSku. */
export interface CostDrafts {
  fields: Record<string, Partial<Record<CostField, string>>>;
  lots: Record<string, { qty: string; unitCost: string }[]>;
  /** Comma- or semicolon-separated alias SKUs. */
  aliases: Record<string, string>;
}

/**
 * Turns what's typed into the cost inputs buildReport reads. The one
 * place typed text becomes numbers - nothing in the dashboard parses a
 * batch on its own, so a half-typed batch counts (or doesn't) the same
 * way everywhere.
 */
export function parseCostDrafts(drafts: CostDrafts): CostInputs {
  const out: CostInputs = {};
  for (const [sku, fields] of Object.entries(drafts.fields)) {
    const parsed: SkuCostInputs = {};
    for (const key of COST_FIELDS) {
      const n = parseFloat(fields[key] ?? "");
      if (!Number.isNaN(n)) parsed[key] = n;
    }
    out[sku] = parsed;
  }
  for (const [sku, lots] of Object.entries(drafts.lots)) {
    out[sku] = {
      ...out[sku],
      lots: lots
        .map((d) => ({ qty: parseFloat(d.qty), unitCost: parseFloat(d.unitCost) }))
        .filter((l) => !Number.isNaN(l.qty) && !Number.isNaN(l.unitCost)),
    };
  }
  for (const [sku, raw] of Object.entries(drafts.aliases)) {
    const aliasSkus = raw
      .split(/[;,]/)
      .map((a) => a.trim())
      .filter(Boolean);
    if (aliasSkus.length > 0) out[sku] = { ...out[sku], aliasSkus };
  }
  return out;
}
