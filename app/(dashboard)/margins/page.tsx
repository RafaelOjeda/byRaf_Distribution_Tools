"use client";

import { type FormEvent, useMemo, useState } from "react";
import { computeMargins, groupReconRows, sumMargins } from "@/lib/margin";
import type { ReconRow } from "@/lib/walmart/recon";
import { loadWalmartData } from "./actions";

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

export default function MarginsPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [rows, setRows] = useState<ReconRow[] | null>(null);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const numericCosts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [sku, value] of Object.entries(costs)) {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) out[sku] = n;
    }
    return out;
  }, [costs]);

  const margins = useMemo(
    () => computeMargins(lines, numericCosts),
    [lines, numericCosts]
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
            setCosts({});
          }}
          className="text-sm underline"
        >
          Start over
        </button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">1. Enter your cost per SKU</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Not saved — re-enter each session.
        </p>
        <div className="flex max-w-md flex-col gap-2">
          {skus.map((sku) => (
            <label
              key={sku}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate">{sku}</span>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={costs[sku] ?? ""}
                onChange={(e) =>
                  setCosts((c) => ({ ...c, [sku]: e.target.value }))
                }
                className="w-28 rounded border border-black/15 px-2 py-1 text-right dark:border-white/20"
              />
            </label>
          ))}
          {skus.length === 0 && (
            <p className="text-sm text-black/60 dark:text-white/60">
              No SKUs found in the returned data.
            </p>
          )}
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
                  <td className="py-1 pr-3 text-right">
                    {m.hasCost ? (
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
                  <td className="py-2 pr-3 text-right">
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
