export const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** A fraction (0.153) as a 1-decimal percent string ("15.3%"). No sign handling - see PriceChart's pctText for that. */
export const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

/**
 * "{n} {word}" with the right plural form. Pass an explicit `pluralForm`
 * for irregulars (`plural(n, "batch", "batches")`); regular nouns just
 * take the default `${singular}s`. Doesn't handle verb agreement
 * ("has"/"have") - callers combining that with a count keep their own
 * inline ternary rather than forcing it through this.
 */
export const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  `${n} ${n === 1 ? singular : pluralForm}`;

/** Hands a string to the browser as a file. Nothing leaves the page. */
export function downloadCsv(prefix: string, csv: string) {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-${local}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
