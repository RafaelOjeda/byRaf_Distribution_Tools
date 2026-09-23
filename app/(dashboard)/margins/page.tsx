"use client";

import { Fragment, type FormEvent, useMemo, useState } from "react";
import {
  DIM_DIVISOR,
  SHIPPING_PCT_ALERT,
  SHIPPING_PCT_WARN,
  averageUnitCost,
  computeMargins,
  cubicInches,
  dimWeight,
  groupReconRows,
  normalizeSku,
  reconcileStock,
  sumMargins,
  summarizeBySku,
  type CostLot,
  type OrderLineSummary,
  type SkuInputs,
  type SkuSummary,
} from "@/lib/margin";
import { orderLinesToCsv, skuSummaryToCsv } from "@/lib/csv";
import type { InventoryItem } from "@/lib/walmart/inventory";
import type { ReconRow } from "@/lib/walmart/recon";
import {
  listAvailableReports,
  loadInventory,
  loadUnsettledOrders,
  loadWalmartData,
} from "./actions";

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

/** Hands a string to the browser as a file. Nothing leaves the page. */
function downloadCsv(prefix: string, csv: string) {
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

/** Walmart sends dates as MMDDYYYY. */
function formatReportDate(d: string): string {
  const m = d.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return d;
  const [, mm, dd, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" }
  );
}

type SkuField = Exclude<keyof SkuInputs, "lots">;

const BOX_FIELDS: { key: SkuField; label: string; step: string }[] = [
  { key: "boxCost", label: "Box cost", step: "0.01" },
  { key: "boxLength", label: "L (in)", step: "0.1" },
  { key: "boxWidth", label: "W (in)", step: "0.1" },
  { key: "boxHeight", label: "H (in)", step: "0.1" },
];

/** A purchase batch as typed, before parsing. */
type LotDraft = { qty: string; unitCost: string };

type Step = "credentials" | "reports" | "data";

export default function MarginsPage() {
  const [step, setStep] = useState<Step>("credentials");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ReconRow[] | null>(null);
  const [unsettled, setUnsettled] = useState<OrderLineSummary[]>([]);
  const [unsettledError, setUnsettledError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  // Raw strings keyed by normalized SKU, so a half-typed "1." doesn't fight the input.
  const [inputs, setInputs] = useState<
    Record<string, Partial<Record<SkuField, string>>>
  >({});
  const [lotDrafts, setLotDrafts] = useState<Record<string, LotDraft[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(sku: string, field: SkuField, value: string) {
    setInputs((prev) => ({
      ...prev,
      [sku]: { ...prev[sku], [field]: value },
    }));
  }

  function addLot(sku: string) {
    setLotDrafts((prev) => ({
      ...prev,
      [sku]: [...(prev[sku] ?? []), { qty: "", unitCost: "" }],
    }));
    setExpanded((prev) => new Set(prev).add(sku));
  }

  function updateLot(
    sku: string,
    index: number,
    field: keyof LotDraft,
    value: string
  ) {
    setLotDrafts((prev) => ({
      ...prev,
      [sku]: (prev[sku] ?? []).map((lot, i) =>
        i === index ? { ...lot, [field]: value } : lot
      ),
    }));
  }

  function removeLot(sku: string, index: number) {
    setLotDrafts((prev) => ({
      ...prev,
      [sku]: (prev[sku] ?? []).filter((_, i) => i !== index),
    }));
  }

  function toggleExpanded(sku: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  function toggleDate(date: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  async function handleListReports(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await listAvailableReports(clientId, clientSecret);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (result.reportDates.length === 0) {
      setError(
        "Walmart has no settlement reports available for this account yet."
      );
      return;
    }
    setReportDates(result.reportDates);
    setSelectedDates(new Set(result.reportDates)); // default: all selected
    setStep("reports");
  }

  async function handleLoadSelected() {
    setLoading(true);
    setError(null);
    setUnsettledError(null);
    const [result, recent, stock] = await Promise.all([
      loadWalmartData(clientId, clientSecret, [...selectedDates]),
      loadUnsettledOrders(clientId, clientSecret),
      loadInventory(clientId, clientSecret),
    ]);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // Recent orders and inventory are extras - if either fails, still
    // show settled data rather than blocking the whole page.
    if ("error" in recent) {
      setUnsettledError(recent.error);
      setUnsettled([]);
    } else {
      setUnsettled(recent.lines);
    }
    setInventory("error" in stock ? [] : stock.inventory);
    setRows(result.rows);
    setStep("data");
  }

  function clearData() {
    setRows(null);
    setUnsettled([]);
    setUnsettledError(null);
    setInventory([]);
    setInputs({});
    setLotDrafts({});
    setExpanded(new Set());
    setError(null);
  }

  function startOver() {
    clearData();
    setStep("credentials");
    setClientId("");
    setClientSecret("");
    setReportDates([]);
    setSelectedDates(new Set());
  }

  const lines = useMemo(
    () => [...unsettled, ...(rows ? groupReconRows(rows) : [])],
    [rows, unsettled]
  );

  const parsedInputs = useMemo(() => {
    const out: Record<string, SkuInputs> = {};
    for (const [sku, fields] of Object.entries(inputs)) {
      const parsed: SkuInputs = {};
      for (const { key } of BOX_FIELDS) {
        const n = parseFloat(fields[key] ?? "");
        if (!Number.isNaN(n)) parsed[key] = n;
      }
      out[sku] = parsed;
    }
    for (const [sku, drafts] of Object.entries(lotDrafts)) {
      const lots: CostLot[] = drafts
        .map((d) => ({
          qty: parseFloat(d.qty),
          unitCost: parseFloat(d.unitCost),
        }))
        .filter((l) => !Number.isNaN(l.qty) && !Number.isNaN(l.unitCost));
      out[sku] = { ...out[sku], lots };
    }
    return out;
  }, [inputs, lotDrafts]);

  const margins = useMemo(
    () => computeMargins(lines, parsedInputs),
    [lines, parsedInputs]
  );

  const inventoryBySku = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    for (const item of inventory) m.set(normalizeSku(item.sku), item);
    return m;
  }, [inventory]);

  // Every SKU you stock, not just ones that have sold - inventory
  // surfaces products the settlement reports never mention.
  const skus = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) if (l.sku) set.add(normalizeSku(l.sku));
    for (const item of inventory) set.add(normalizeSku(item.sku));
    return [...set].sort();
  }, [lines, inventory]);

  const skuSummaries = useMemo(() => summarizeBySku(margins), [margins]);

  const soldBySku = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of skuSummaries) m.set(s.sku, s.units);
    return m;
  }, [skuSummaries]);

  // Settled and estimated totals are kept apart so exact numbers never
  // get blended with projections; no-estimate lines are left out entirely.
  const settledTotals = useMemo(
    () => sumMargins(margins.filter((m) => m.status === "settled")),
    [margins]
  );
  const estimatedTotals = useMemo(
    () =>
      sumMargins(
        margins.filter((m) => m.status === "estimated" && !m.noEstimate)
      ),
    [margins]
  );
  const settledCount = margins.filter((m) => m.status === "settled").length;
  const estimatedCount = margins.filter(
    (m) => m.status === "estimated" && !m.noEstimate
  ).length;
  const noEstimateCount = margins.filter((m) => m.noEstimate).length;

  if (step === "credentials") {
    return (
      <div className="flex max-w-md flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">Margins</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Paste your Walmart Marketplace API credentials to see which
            settlement reports are available. Nothing is saved anywhere —
            refresh this page and it&apos;s gone.
          </p>
        </div>
        <form onSubmit={handleListReports} className="flex flex-col gap-3">
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
            {loading ? "Checking…" : "See available reports"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    );
  }

  if (step === "reports") {
    return (
      <div className="flex max-w-md flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Settlement reports</h1>
          <button onClick={startOver} className="text-sm underline">
            Start over
          </button>
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">
          These are the same reports Walmart shows under Payments in Seller
          Center — one per settlement period, roughly every two weeks. Pick
          which to pull.
        </p>
        <div className="flex flex-col gap-1">
          {reportDates.map((date) => (
            <label
              key={date}
              className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={selectedDates.has(date)}
                onChange={() => toggleDate(date)}
              />
              {formatReportDate(date)}
              <span className="text-black/40 dark:text-white/40">
                ({date})
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-4 text-sm">
          <button
            onClick={() => setSelectedDates(new Set(reportDates))}
            className="underline"
          >
            Select all
          </button>
          <button
            onClick={() => setSelectedDates(new Set())}
            className="underline"
          >
            Select none
          </button>
        </div>
        <button
          onClick={handleLoadSelected}
          disabled={loading || selectedDates.size === 0}
          className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading
            ? "Loading…"
            : `Load ${selectedDates.size} report${selectedDates.size === 1 ? "" : "s"}`}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Margins</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Settled:{" "}
            {[...selectedDates]
              .sort()
              .map(formatReportDate)
              .join(", ")}
            {unsettled.length > 0 &&
              ` · plus ${unsettled.length} recent order line${unsettled.length === 1 ? "" : "s"} not yet settled`}
          </p>
          {unsettledError && (
            <p className="text-sm text-amber-600">
              Couldn&apos;t load recent orders: {unsettledError}
            </p>
          )}
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => {
              clearData();
              setStep("reports");
            }}
            className="text-sm underline"
          >
            Change reports
          </button>
          <button onClick={startOver} className="text-sm underline">
            Start over
          </button>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">1. Inventory and costs</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Not saved — re-enter each session. Add a batch for each price you
          bought an item at, including units already sold; cost per unit is
          the quantity-weighted average across batches. &ldquo;Left&rdquo;
          is purchased − sold and should match Walmart&apos;s on-hand
          count.
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3 text-right">On hand</th>
                <th className="py-1 pr-3 text-right">Sold</th>
                <th className="py-1 pr-3 text-right">Bought</th>
                <th
                  className="py-1 pr-3 text-right"
                  title="Purchased − sold. Amber when it disagrees with Walmart's on-hand count."
                >
                  Left
                </th>
                <th className="py-1 pr-3 text-right">Avg cost</th>
                {BOX_FIELDS.map((f) => (
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
                const drafts = lotDrafts[sku] ?? [];
                const inv = inventoryBySku.get(sku);
                const stock = reconcileStock(
                  parsed.lots,
                  soldBySku.get(sku) ?? 0,
                  inv ? inv.onHand : null
                );
                const avg = averageUnitCost(parsed.lots);
                const isOpen = expanded.has(sku);

                return (
                  <Fragment key={sku}>
                    <tr className="border-b border-black/5 dark:border-white/5">
                      <td className="py-1 pr-3">
                        <button
                          onClick={() => toggleExpanded(sku)}
                          className="text-left hover:underline"
                          title={
                            drafts.length > 0
                              ? `${drafts.length} batch${drafts.length === 1 ? "" : "es"}`
                              : "Add a purchase batch"
                          }
                        >
                          <span className="text-black/40 dark:text-white/40">
                            {isOpen ? "▾ " : "▸ "}
                          </span>
                          {sku}
                          {drafts.length > 0 && (
                            <span className="text-black/40 dark:text-white/40">
                              {" "}
                              ({drafts.length})
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {inv ? (
                          <span
                            title={`${inv.availToSell} available to sell + ${inv.reserved} ordered but not shipped. The quantity last set on the listing is ${inv.fedQty}, but that number doesn't drop as units ship.`}
                          >
                            {inv.onHand}
                          </span>
                        ) : (
                          <span className="text-black/40 dark:text-white/40">
                            —
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {soldBySku.get(sku) ?? 0}
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {stock.purchased || (
                          <span className="text-black/40 dark:text-white/40">
                            —
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-1 pr-3 text-right ${stock.discrepancy ? "text-amber-600" : ""}`}
                        title={
                          stock.discrepancy
                            ? `Your batches imply ${stock.impliedOnHand} left, Walmart says ${stock.onHand}. Off by ${stock.discrepancy > 0 ? "+" : ""}${stock.discrepancy} — likely a missing or mistyped batch.`
                            : undefined
                        }
                      >
                        {stock.purchased === 0 ? (
                          <span className="text-black/40 dark:text-white/40">
                            —
                          </span>
                        ) : (
                          stock.impliedOnHand
                        )}
                      </td>
                      <td className="py-1 pr-3 text-right font-medium">
                        {avg === null ? (
                          <span className="text-amber-600">—</span>
                        ) : (
                          money(avg)
                        )}
                      </td>
                      {BOX_FIELDS.map((f) => (
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
                    {isOpen && (
                      <tr className="border-b border-black/5 bg-black/[0.02] dark:border-white/5 dark:bg-white/[0.03]">
                        <td colSpan={BOX_FIELDS.length + 8} className="px-3 py-3">
                          <CostLotsEditor
                            sku={sku}
                            drafts={drafts}
                            onAdd={() => addLot(sku)}
                            onUpdate={(i, field, value) =>
                              updateLot(sku, i, field, value)
                            }
                            onRemove={(i) => removeLot(sku, i)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {skus.length === 0 && (
                <tr>
                  <td
                    colSpan={BOX_FIELDS.length + 8}
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
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">2. By SKU</h2>
          <button
            onClick={() =>
              downloadCsv("walmart-by-sku", skuSummaryToCsv(skuSummaries))
            }
            disabled={skuSummaries.length === 0}
            className="text-sm underline disabled:opacity-40"
            title="Downloads this table as a CSV. Estimated rows are included and marked in the Status/line-count columns; cells that aren't known are left blank."
          >
            Download CSV
          </button>
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">
          Settled and estimated order lines rolled up per product. A SKU
          with no settled history yet can&apos;t have its fees estimated,
          so its money columns show — rather than a misleading $0.00.
        </p>
        <SkuSummaryTable summaries={skuSummaries} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">3. Order lines</h2>
          <button
            onClick={() =>
              downloadCsv("walmart-order-lines", orderLinesToCsv(margins))
            }
            disabled={margins.length === 0}
            className="text-sm underline disabled:opacity-40"
            title="Downloads this table as a CSV, one row per order line, with a Status column (Settled / Estimated / Not estimable). Excel shows the 15-digit purchase order numbers in scientific notation until you widen the column; the values are intact."
          >
            Download CSV
          </button>
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">
          Revenue − commission − shipping − other − your cost = profit. Fee
          columns are shown as Walmart reports them (negative = money out).
          <span className="italic"> Est.</span> rows are orders Walmart
          hasn&apos;t settled yet: revenue is exact, but commission and
          shipping are projected from that SKU&apos;s settled history (hover
          for details) and switch to exact figures once the order settles.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="py-1 pr-3">Status</th>
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
              {margins.map((m) => {
                const est = m.status === "estimated";
                const noEst = (
                  <span
                    className="text-amber-600"
                    title={m.estimateNote}
                  >
                    no estimate
                  </span>
                );
                return (
                  <tr
                    key={`${m.status}-${m.purchaseOrderNo}-${m.purchaseOrderLine}`}
                    className={`border-b border-black/5 dark:border-white/5 ${est ? "italic text-black/70 dark:text-white/70" : ""}`}
                  >
                    <td
                      className="py-1 pr-3"
                      title={
                        est ? `Ordered ${m.orderDate} · ${m.estimateNote}` : undefined
                      }
                    >
                      {est ? `Est. · ${m.orderDate?.slice(5)}` : "Settled"}
                    </td>
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
                        est
                          ? m.estimateNote
                          : m.commissionRate
                            ? `Commission rate: ${m.commissionRate}%`
                            : undefined
                      }
                    >
                      {m.noEstimate ? noEst : money(m.commission)}
                    </td>
                    <td
                      className="py-1 pr-3 text-right text-red-600 dark:text-red-400"
                      title={est ? m.estimateNote : undefined}
                    >
                      {m.noEstimate ? noEst : money(m.shipping)}
                    </td>
                    <td
                      className="py-1 pr-3 text-right"
                      title={`Tax collected/withheld: ${money(m.tax)}`}
                    >
                      {money(m.tax + m.otherFees)}
                    </td>
                    <td className="py-1 pr-3 text-right">
                      {m.noEstimate ? noEst : money(m.netAmount)}
                    </td>
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
                      {m.noEstimate ? noEst : money(m.profit)}
                    </td>
                    <td className="py-1 pr-3 text-right">
                      {m.noEstimate ? (
                        noEst
                      ) : !m.hasCost ? (
                        <span className="text-amber-600">no cost</span>
                      ) : m.margin === null ? (
                        "—"
                      ) : (
                        `${(m.margin * 100).toFixed(1)}%`
                      )}
                    </td>
                  </tr>
                );
              })}
              {margins.length === 0 && (
                <tr>
                  <td
                    colSpan={13}
                    className="py-3 text-black/60 dark:text-white/60"
                  >
                    No order lines found.
                  </td>
                </tr>
              )}
            </tbody>
            {margins.length > 0 && (
              <tfoot>
                {settledCount > 0 && (
                  <TotalsRow
                    label={`Settled · ${settledCount} line${settledCount === 1 ? "" : "s"}`}
                    totals={settledTotals}
                    first
                  />
                )}
                {estimatedCount > 0 && (
                  <TotalsRow
                    label={`Estimated · ${estimatedCount} line${estimatedCount === 1 ? "" : "s"}${noEstimateCount > 0 ? ` (+${noEstimateCount} with no estimate, excluded)` : ""}`}
                    totals={estimatedTotals}
                    first={settledCount === 0}
                    italic
                  />
                )}
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}

function CostLotsEditor({
  sku,
  drafts,
  onAdd,
  onUpdate,
  onRemove,
}: {
  sku: string;
  drafts: LotDraft[];
  onAdd: () => void;
  onUpdate: (index: number, field: keyof LotDraft, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const parsed: CostLot[] = drafts
    .map((d) => ({ qty: parseFloat(d.qty), unitCost: parseFloat(d.unitCost) }))
    .filter((l) => !Number.isNaN(l.qty) && !Number.isNaN(l.unitCost));
  const avg = averageUnitCost(parsed);
  const units = parsed.reduce((n, l) => n + l.qty, 0);
  const spent = parsed.reduce((n, l) => n + l.qty * l.unitCost, 0);

  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-xs text-black/60 dark:text-white/60">
        Purchase batches for {sku}
      </span>

      {drafts.map((lot, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Qty"
            aria-label={`Batch ${i + 1} quantity for ${sku}`}
            value={lot.qty}
            onChange={(e) => onUpdate(i, "qty", e.target.value)}
            className="w-20 rounded border border-black/15 px-2 py-1 text-right dark:border-white/20"
          />
          <span className="text-black/40 dark:text-white/40">×</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Price each"
            aria-label={`Batch ${i + 1} unit cost for ${sku}`}
            value={lot.unitCost}
            onChange={(e) => onUpdate(i, "unitCost", e.target.value)}
            className="w-28 rounded border border-black/15 px-2 py-1 text-right dark:border-white/20"
          />
          <span className="w-24 text-right text-black/60 dark:text-white/60">
            {!Number.isNaN(parseFloat(lot.qty)) &&
            !Number.isNaN(parseFloat(lot.unitCost))
              ? money(parseFloat(lot.qty) * parseFloat(lot.unitCost))
              : ""}
          </span>
          <button
            onClick={() => onRemove(i)}
            className="text-black/40 hover:text-red-600 dark:text-white/40"
            aria-label={`Remove batch ${i + 1} for ${sku}`}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex items-center gap-4">
        <button onClick={onAdd} className="text-sm underline">
          + Add batch
        </button>
        {units > 0 && (
          <span className="text-sm text-black/60 dark:text-white/60">
            {units} unit{units === 1 ? "" : "s"} · {money(spent)} spent ·
            avg {avg === null ? "—" : money(avg)} each
          </span>
        )}
      </div>
    </div>
  );
}

function SkuSummaryTable({ summaries }: { summaries: SkuSummary[] }) {
  const dash = <span className="text-black/40 dark:text-white/40">—</span>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/10">
            <th className="py-1 pr-3">SKU</th>
            <th className="py-1 pr-3">Item</th>
            <th className="py-1 pr-3 text-right">Units</th>
            <th className="py-1 pr-3 text-right">Lines</th>
            <th className="py-1 pr-3 text-right">Avg price</th>
            <th className="py-1 pr-3 text-right">Revenue</th>
            <th className="py-1 pr-3 text-right">Commission</th>
            <th className="py-1 pr-3 text-right">Shipping</th>
            <th
              className="py-1 pr-3 text-right"
              title={`Shipping as a share of revenue. Amber above ${SHIPPING_PCT_WARN * 100}%, red above ${SHIPPING_PCT_ALERT * 100}%.`}
            >
              Ship %
            </th>
            <th className="py-1 pr-3 text-right">Net</th>
            <th className="py-1 pr-3 text-right">Cost</th>
            <th className="py-1 pr-3 text-right">Profit</th>
            <th className="py-1 pr-3 text-right">Margin</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const t = s.totals;
            const pct = s.shippingPct;
            const pctClass =
              pct === null
                ? ""
                : pct > SHIPPING_PCT_ALERT
                  ? "text-red-600 dark:text-red-400 font-medium"
                  : pct > SHIPPING_PCT_WARN
                    ? "text-amber-600"
                    : "";
            const noMoneyTitle = s.hasMoney
              ? undefined
              : "No settled history for this SKU yet, so its fees can't be estimated";

            return (
              <tr
                key={s.sku}
                className="border-b border-black/5 dark:border-white/5"
              >
                <td className="py-1 pr-3">{s.sku}</td>
                <td
                  className="max-w-[16rem] truncate py-1 pr-3"
                  title={s.itemName}
                >
                  {s.itemName}
                </td>
                <td className="py-1 pr-3 text-right">{s.units}</td>
                <td
                  className="py-1 pr-3 text-right"
                  title={`${s.settledLines} settled, ${s.estimatedLines} estimated${s.noEstimateLines > 0 ? `, ${s.noEstimateLines} not estimable` : ""}`}
                >
                  {s.lines}
                  {s.estimatedLines > 0 && (
                    <span className="text-black/40 dark:text-white/40">
                      {" "}
                      ({s.estimatedLines} est.)
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3 text-right" title={noMoneyTitle}>
                  {s.avgPrice === null ? dash : money(s.avgPrice)}
                </td>
                <td className="py-1 pr-3 text-right" title={noMoneyTitle}>
                  {s.hasMoney ? money(t.revenue) : dash}
                </td>
                <td
                  className="py-1 pr-3 text-right text-red-600 dark:text-red-400"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.commission) : dash}
                </td>
                <td
                  className="py-1 pr-3 text-right text-red-600 dark:text-red-400"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.shipping) : dash}
                </td>
                <td
                  className={`py-1 pr-3 text-right ${pctClass}`}
                  title={noMoneyTitle}
                >
                  {pct === null ? dash : `${(pct * 100).toFixed(1)}%`}
                </td>
                <td className="py-1 pr-3 text-right" title={noMoneyTitle}>
                  {s.hasMoney ? money(t.netAmount) : dash}
                </td>
                <td
                  className="py-1 pr-3 text-right"
                  title={
                    s.hasMoney
                      ? `Item ${money(t.itemCostTotal)} + box ${money(t.boxCostTotal)}`
                      : noMoneyTitle
                  }
                >
                  {!s.hasMoney ? (
                    dash
                  ) : s.missingCost ? (
                    <span className="text-amber-600">—</span>
                  ) : (
                    money(-t.costTotal)
                  )}
                </td>
                <td
                  className="py-1 pr-3 text-right font-medium"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.profit) : dash}
                </td>
                <td className="py-1 pr-3 text-right" title={noMoneyTitle}>
                  {!s.hasMoney ? (
                    dash
                  ) : s.missingCost ? (
                    <span className="text-amber-600">no cost</span>
                  ) : s.margin === null ? (
                    dash
                  ) : (
                    `${(s.margin * 100).toFixed(1)}%`
                  )}
                </td>
              </tr>
            );
          })}
          {summaries.length === 0 && (
            <tr>
              <td colSpan={13} className="py-3 text-black/60 dark:text-white/60">
                No SKUs found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TotalsRow({
  label,
  totals,
  first,
  italic,
}: {
  label: string;
  totals: ReturnType<typeof sumMargins>;
  first?: boolean;
  italic?: boolean;
}) {
  return (
    <tr
      className={`font-medium ${first ? "border-t-2 border-black/20 dark:border-white/20" : ""} ${italic ? "italic" : ""}`}
    >
      <td className="py-2 pr-3" colSpan={5}>
        {label}
      </td>
      <td className="py-2 pr-3 text-right">{money(totals.revenue)}</td>
      <td className="py-2 pr-3 text-right text-red-600 dark:text-red-400">
        {money(totals.commission)}
      </td>
      <td className="py-2 pr-3 text-right text-red-600 dark:text-red-400">
        {money(totals.shipping)}
      </td>
      <td className="py-2 pr-3 text-right">
        {money(totals.tax + totals.otherFees)}
      </td>
      <td className="py-2 pr-3 text-right">{money(totals.netAmount)}</td>
      <td
        className="py-2 pr-3 text-right"
        title={`Item ${money(totals.itemCostTotal)} + box ${money(totals.boxCostTotal)}`}
      >
        {money(-totals.costTotal)}
      </td>
      <td className="py-2 pr-3 text-right">{money(totals.profit)}</td>
      <td className="py-2 pr-3 text-right">
        {totals.revenue !== 0
          ? `${((totals.profit / totals.revenue) * 100).toFixed(1)}%`
          : "—"}
      </td>
    </tr>
  );
}
