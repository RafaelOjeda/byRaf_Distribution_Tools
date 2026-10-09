import type { CostField } from "@/lib/gateway";

export type SkuField = CostField;

export const BOX_FIELDS: { key: SkuField; label: string; step: string }[] = [
  { key: "boxCost", label: "Box cost", step: "0.01" },
];

/** A purchase batch as typed, before parsing. */
export type LotDraft = { qty: string; unitCost: string };

export type Step = "connect" | "periods" | "data";

export type Tab = "sku" | "orders" | "price" | "inventory" | "stock" | "fees";
