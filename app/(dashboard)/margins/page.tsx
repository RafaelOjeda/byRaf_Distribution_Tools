"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  DIM_DIVISOR,
  computeMargins,
  cubicInches,
  dimWeight,
  groupReconRows,
  sumMargins,
  type SkuInputs,
} from "@/lib/margin";
import type { ReconRow } from "@/lib/walmart/recon";
import { loadWalmartData } from "./actions";

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

type SkuField = keyof SkuInputs;

const SKU_FIELDS: { key: SkuField; label: string; step: string }[] = [
  { key: "unitCost", label: "Unit cost", step: "0.01" },
  { key: "boxCost", label: "Box cost", step: "0.01" },
  { key: "boxLength", label: "L (in)", step: "0.1" },
  { key: "boxWidth", label: "W (in)", step: "0.1" },
  { key: "boxHeight", label: "H (in)", step: "0.1" },
];

export default function MarginsPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [rows, setRows] = useState<ReconRow[] | null>(null);
  // Raw strings keyed by SKU then field, so a half-typed "1." doesn't fight the input.
  const [inputs, setInputs] = useState<
    Record<string, Partial<Record<SkuField, string>>>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(sku: string, field: SkuField, value: string) {
    setInputs((prev) => ({
      ...prev,
      [sku]: { ...prev[sku], [field]: value },
    }));
  }

  async function handleLoad(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await loadWalmartData(clientId, clientSecret);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRows(result.rows);
  }

  const lines = useMemo(() => (rows ? groupReconRows(rows) : []), [rows]);

  const parsedInputs = useMemo(() => {
    const out: Record<string, SkuInputs> = {};
    for (const [sku, fields] of Object.entries(inputs)) {
      const parsed: SkuInputs = {};
      for (const { key } of SKU_FIELDS) {
        const n = parseFloat(fields[key] ?? "");
        if (!Number.isNaN(n)) parsed[key] = n;
      }
      out[sku] = parsed;
    }
    return out;
  }, [inputs]);

  const margins = useMemo(
    () => computeMargins(lines, parsedInputs),
    [lines, parsedInputs]
  );

  const skus = useMemo(
    () => [...new Set(lines.map((l) => l.sku))].filter(Boolean).sort(),
    [lines]
  );

  const totals = useMemo(() => sumMargins(margins), [margins]);

  if (!rows) {
    return (
      <div className="flex max-w-md flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">Margins</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Paste your Walmart Marketplace API credentials to pull your real
            settlement data. Nothing is saved anywhere — refresh this page
            and it&apos;s gone.
          </p>
        </div>
        <form onSubmit={handleLoad} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Client ID
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded border border-black/15 px-2 py-1 dark:border-white/20"
              autoComplete="off"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Client Secret
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className="rounded border border-black/15 px-2 py-1 dark:border-white/20"
              autoComplete="off"
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {loading ? "Loading…" : "Load my data"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Margins</h1>
        <button
          onClick={() => {
            setRows(null);
            setInputs({});
          }}
          className="text-sm underline"
        >
          Start over
        </button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">1. Enter your costs and box per SKU</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Not saved — re-enter each session. Box cost counts once per
          shipment; unit cost is multiplied by quantity.
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="py-1 pr-3">SKU</th>
                {SKU_FIELDS.map((f) => (
                  <th key={f.key} className="py-1 pr-3 text-right">
                    {f.label}
                  </th>
                ))}
                <th className="py-1 pr-3 text-right">Cu in</th>
                <th
                  className="py-1 pr-3 text-right"
                  title={`Volume ÷ ${DIM_DIVISOR}. An estimate of billable dimensional weight — not what Walmart actually charged.`}
                >
                  Dim wt
                </th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => {
                const parsed = parsedInputs[sku] ?? {};
                const cu = cubicInches(parsed);
                const dim = dimWeight(parsed);
                return (
                  <tr
                    key={sku}
                    className="border-b border-black/5 dark:border-white/5"
                  >
                    <td className="py-1 pr-3">{sku}</td>
                    {SKU_FIELDS.map((f) => (
                      <td key={f.key} className="py-1 pr-3">
                        <input
                          type="number"
                          step={f.step}
                          min="0"
                          placeholder="—"
                          aria-label={`${f.label} for ${sku}`}
                          value={inputs[sku]?.[f.key] ?? ""}
                          onChange={(e) =>
                            setField(sku, f.key, e.target.value)
                          }
                          className="w-24 rounded border border-black/15 px-2 py-1 text-right dark:border-white/20"
                        />
                      </td>
                    ))}
                    <td className="py-1 pr-3 text-right text-black/60 dark:text-white/60">
                      {cu === null ? "—" : cu.toFixed(0)}
                    </td>
                    <td className="py-1 pr-3 text-right text-black/60 dark:text-white/60">
                      {dim === null ? "—" : `${dim.toFixed(1)} lb`}
                    </td>
                  </tr>
                );
              })}
              {skus.length === 0 && (
                <tr>
                  <td
                    colSpan={SKU_FIELDS.length + 3}
                    className="py-3 text-black/60 dark:text-white/60"
                  >
                    No SKUs found in the returned data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">2. Margins</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Revenue − commission − shipping − other − your cost = profit. Fee
          columns are shown as Walmart reports them (negative = money out).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Item</th>
                <th className="py-1 pr-3">Fulfillment</th>
                <th className="py-1 pr-3 text-right">Qty</th>
                <th className="py-1 pr-3 text-right">Revenue</th>
                <th className="py-1 pr-3 text-right">Commission</th>
                <th className="py-1 pr-3 text-right">Shipping</th>
                <th className="py-1 pr-3 text-right">Other</th>
                <th className="py-1 pr-3 text-right">Net</th>
                <th className="py-1 pr-3 text-right">Cost</th>
                <th className="py-1 pr-3 text-right">Profit</th>
                <th className="py-1 pr-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {margins.map((m) => (
                <tr
                  key={`${m.purchaseOrderNo}-${m.purchaseOrderLine}`}
                  className="border-b border-black/5 dark:border-white/5"
                >
                  <td className="py-1 pr-3">{m.sku}</td>
                  <td
                    className="max-w-[16rem] truncate py-1 pr-3"
                    title={m.itemName}
                  >
                    {m.itemName}
                  </td>
                  <td className="py-1 pr-3">{m.fulfillmentType}</td>
                  <td className="py-1 pr-3 text-right">{m.qty}</td>
                  <td className="py-1 pr-3 text-right">{money(m.revenue)}</td>
                  <td
                    className="py-1 pr-3 text-right text-red-600 dark:text-red-400"
                    title={
                      m.commissionRate
                        ? `Commission rate: ${m.commissionRate}%`
                        : undefined
                    }
                  >
                    {money(m.commission)}
                  </td>
                  <td className="py-1 pr-3 text-right text-red-600 dark:text-red-400">
                    {money(m.shipping)}
                  </td>
                  <td
                    className="py-1 pr-3 text-right"
                    title={`Tax collected/withheld: ${money(m.tax)}`}
                  >
                    {money(m.tax + m.otherFees)}
                  </td>
                  <td className="py-1 pr-3 text-right">{money(m.netAmount)}</td>
                  <td
                    className="py-1 pr-3 text-right"
                    title={`Item ${money(m.itemCostTotal)} + box ${money(m.boxCostTotal)}`}
                  >
                    {m.costTotal !== 0 || m.hasCost ? (
                      money(-m.costTotal)
                    ) : (
                      <span className="text-amber-600">—</span>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-right font-medium">
                    {money(m.profit)}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {!m.hasCost ? (
                      <span className="text-amber-600">no cost</span>
                    ) : m.margin === null ? (
                      "—"
                    ) : (
                      `${(m.margin * 100).toFixed(1)}%`
                    )}
                  </td>
                </tr>
              ))}
              {margins.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="py-3 text-black/60 dark:text-white/60"
                  >
                    No order lines found.
                  </td>
                </tr>
              )}
            </tbody>
            {margins.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-black/20 font-medium dark:border-white/20">
                  <td className="py-2 pr-3" colSpan={4}>
                    {margins.length} order line
                    {margins.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {money(totals.revenue)}
                  </td>
                  <td className="py-2 pr-3 text-right text-red-600 dark:text-red-400">
                    {money(totals.commission)}
                  </td>
                  <td className="py-2 pr-3 text-right text-red-600 dark:text-red-400">
                    {money(totals.shipping)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {money(totals.tax + totals.otherFees)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {money(totals.netAmount)}
                  </td>
                  <td
                    className="py-2 pr-3 text-right"
                    title={`Item ${money(totals.itemCostTotal)} + box ${money(totals.boxCostTotal)}`}
                  >
                    {money(-totals.costTotal)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {money(totals.profit)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {totals.revenue !== 0
                      ? `${((totals.profit / totals.revenue) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
