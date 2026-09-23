"use client";

import { type FormEvent, useMemo, useState } from "react";
import { computeMargins, groupReconRows } from "@/lib/margin";
import type { ReconRow } from "@/lib/walmart/recon";
import { loadWalmartData } from "./actions";

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Item</th>
                <th className="py-1 pr-3">Fulfillment</th>
                <th className="py-1 pr-3 text-right">Qty</th>
                <th className="py-1 pr-3 text-right">Revenue</th>
                <th className="py-1 pr-3 text-right">Net settlement</th>
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
                  <td className="max-w-xs truncate py-1 pr-3" title={m.itemName}>
                    {m.itemName}
                  </td>
                  <td className="py-1 pr-3">{m.fulfillmentType}</td>
                  <td className="py-1 pr-3 text-right">{m.qty}</td>
                  <td className="py-1 pr-3 text-right">
                    ${m.revenue.toFixed(2)}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    ${m.netAmount.toFixed(2)}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    ${m.profit.toFixed(2)}
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
                    colSpan={8}
                    className="py-3 text-black/60 dark:text-white/60"
                  >
                    No order lines found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
