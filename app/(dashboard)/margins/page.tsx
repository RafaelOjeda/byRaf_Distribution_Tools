import { getMarginRows, getStorageFeeRollup, type MarginRow } from "@/lib/db/queries";
import { ExportCsvButton } from "./_components/export-csv-button";

// Reads live DB data; DATABASE_URL isn't available at build time, so this
// can't be statically prerendered.
export const dynamic = "force-dynamic";

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtPct(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

type SortKey = "profit" | "margin";

function sortRows(rows: MarginRow[], sort: SortKey): MarginRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "margin") return (b.margin ?? -Infinity) - (a.margin ?? -Infinity);
    return b.profit - a.profit;
  });
}

export default async function MarginsPage({
  searchParams,
}: PageProps<"/margins">) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : undefined;
  const to = typeof params.to === "string" ? params.to : undefined;
  const channel = typeof params.channel === "string" ? params.channel : "all";
  const sort: SortKey = params.sort === "margin" ? "margin" : "profit";

  const [allRows, storageFees] = await Promise.all([
    getMarginRows({ from, to }),
    getStorageFeeRollup(),
  ]);

  const filtered =
    channel === "wfs" || channel === "self"
      ? allRows.filter((r) => r.fulfillmentChannel === channel)
      : allRows;
  const rows = sortRows(filtered, sort);

  const missingCostCount = rows.filter((r) => r.missingCost).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Margins</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Per-order-line profit and margin, computed from synced Walmart
            settlement data and your SKU costs.
          </p>
        </div>
        <ExportCsvButton rows={rows} />
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-md border border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs text-black/60 dark:text-white/60">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs text-black/60 dark:text-white/60">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="channel" className="text-xs text-black/60 dark:text-white/60">
            Channel
          </label>
          <select
            id="channel"
            name="channel"
            defaultValue={channel}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          >
            <option value="all">All</option>
            <option value="wfs">WFS</option>
            <option value="self">Self-fulfilled</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-xs text-black/60 dark:text-white/60">
            Sort by
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={sort}
            className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          >
            <option value="profit">Profit</option>
            <option value="margin">Margin %</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Apply
        </button>
      </form>

      {missingCostCount > 0 && (
        <p className="rounded-md bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
          {missingCostCount} line(s) have no matching cost entry — profit
          for those assumes zero cost until one is added on the Costs page.
        </p>
      )}

      <div className="overflow-auto rounded-md border border-black/10 dark:border-white/15">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left dark:bg-white/10">
            <tr>
              <th className="px-3 py-2">Order line</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2 text-right">Ship qty</th>
              <th className="px-3 py-2 text-right">Net settlement</th>
              <th className="px-3 py-2 text-right">Gross revenue</th>
              <th className="px-3 py-2 text-right">Fees</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-black/50 dark:text-white/50">
                  No synced data yet. Run a sync from the header once Walmart
                  API keys are configured.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={`${r.purchaseOrderNo}-${r.purchaseOrderLine}`}
                className={`border-t border-black/5 dark:border-white/10 ${r.missingCost ? "bg-yellow-500/5" : ""}`}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  {r.purchaseOrderNo}
                  {r.purchaseOrderLine ? `-${r.purchaseOrderLine}` : ""}
                </td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{r.partnerItemId}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {r.partnerItemName}
                  </div>
                </td>
                <td className="px-3 py-2 uppercase text-xs">{r.fulfillmentChannel}</td>
                <td className="px-3 py-2 text-right">{r.shipQty}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(r.netSettlement)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(r.grossRevenue)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(r.totalFees)}</td>
                <td className="px-3 py-2 text-right">
                  {r.missingCost ? (
                    <span className="text-yellow-700 dark:text-yellow-400">missing</span>
                  ) : (
                    fmtMoney(r.unitCost ?? 0)
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium">{fmtMoney(r.profit)}</td>
                <td className="px-3 py-2 text-right">{fmtPct(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-sm font-semibold">WFS storage fees (monthly, per SKU)</h2>
        <p className="mb-2 text-xs text-black/50 dark:text-white/50">
          Account-level fees with no Purchase Order # — tracked here, not
          folded into any single order&apos;s margin above.
        </p>
        <div className="overflow-auto rounded-md border border-black/10 dark:border-white/15">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left dark:bg-white/10">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {storageFees.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-black/50 dark:text-white/50">
                    None yet.
                  </td>
                </tr>
              )}
              {storageFees.map((f) => (
                <tr key={`${f.month}-${f.partnerItemId}`} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2">{f.month}</td>
                  <td className="px-3 py-2 font-mono text-xs">{f.partnerItemId ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(f.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
