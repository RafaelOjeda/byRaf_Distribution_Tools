import type { SkuCostInputs } from "@/lib/middleware";

export type SkuField = Exclude<keyof SkuCostInputs, "lots" | "aliasSkus">;

export const BOX_FIELDS: { key: SkuField; label: string; step: string }[] = [
  { key: "boxCost", label: "Box cost", step: "0.01" },
  { key: "boxLength", label: "L (in)", step: "0.1" },
  { key: "boxWidth", label: "W (in)", step: "0.1" },
  { key: "boxHeight", label: "H (in)", step: "0.1" },
];

/** A purchase batch as typed, before parsing. */
export type LotDraft = { qty: string; unitCost: string };

export type Step = "connect" | "periods" | "data";

export type Tab = "sku" | "orders" | "price" | "inventory" | "stock" | "fees";
