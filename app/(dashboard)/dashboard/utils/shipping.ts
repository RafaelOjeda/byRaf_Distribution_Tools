import { SHIPPING_PCT_ALERT, SHIPPING_PCT_WARN } from "@/lib/middleware";

export function shipPctClass(pct: number | null): string {
  if (pct === null) return "";
  if (pct > SHIPPING_PCT_ALERT) return "text-red-600 font-medium";
  if (pct > SHIPPING_PCT_WARN) return "text-amber-600";
  return "";
}
