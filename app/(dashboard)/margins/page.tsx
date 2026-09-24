"use client";

import {
  Fragment,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  assignSaleDates,
  stockValue,
  type CostLot,
  type OrderLineSummary,
  type SkuInputs,
  type SkuSummary,
} from "@/lib/margin";
import {
  costsToCsv,
  orderLinesToCsv,
  parseCostImportCsv,
  skuSummaryToCsv,
  type CostImportResult,
} from "@/lib/csv";
import { priceSeriesBySku } from "@/lib/prices";
import type { InventoryItem } from "@/lib/walmart/inventory";
import type { CatalogItem } from "@/lib/walmart/items";
import type { ReconRow } from "@/lib/walmart/recon";
import {
  listAvailableReports,
  loadInventory,
  loadListedPrices,
  loadUnsettledOrders,
  loadWalmartData,
} from "./actions";
import InstallPrompt from "./InstallPrompt";
import PriceChart from "./PriceChart";

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

type Tab = "sku" | "orders" | "price" | "inventory" | "stock";

export default function MarginsPage() {
  const [step, setStep] = useState<Step>("credentials");
  const [tab, setTab] = useState<Tab>("sku");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ReconRow[] | null>(null);
  const [unsettled, setUnsettled] = useState<OrderLineSummary[]>([]);
  const [unsettledError, setUnsettledError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [orderDates, setOrderDates] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Raw strings keyed by normalized SKU, so a half-typed "1." doesn't fight the input.
  const [inputs, setInputs] = useState<
    Record<string, Partial<Record<SkuField, string>>>
  >({});
  const [lotDrafts, setLotDrafts] = useState<Record<string, LotDraft[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<CostImportResult | null>(
    null
  );
  const importFileRef = useRef<HTMLInputElement>(null);

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

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a fix
    if (!file) return;
    const text = await file.text();
    setImportPreview(parseCostImportCsv(text));
  }

  // Replaces all cost/box inputs with what the file contained - the
  // preview step is the confirmation, so this doesn't ask again.
  function applyImport() {
    if (!importPreview) return;
    const nextInputs: typeof inputs = {};
    const nextLotDrafts: typeof lotDrafts = {};
    for (const [sku, parsed] of Object.entries(importPreview.inputs)) {
      const fields: Partial<Record<SkuField, string>> = {};
      for (const { key } of BOX_FIELDS) {
        const v = parsed[key];
        if (v !== undefined) fields[key] = String(v);
      }
      nextInputs[sku] = fields;
      if (parsed.lots?.length) {
        nextLotDrafts[sku] = parsed.lots.map((l) => ({
          qty: String(l.qty),
          unitCost: String(l.unitCost),
        }));
      }
    }
    setInputs(nextInputs);
    setLotDrafts(nextLotDrafts);
    setExpanded(new Set(Object.keys(nextLotDrafts)));
    setImportPreview(null);
  }

  function cancelImport() {
    setImportPreview(null);
  }

  // On a phone the tab bar scrolls sideways, so a tab selected from
  // elsewhere (e.g. the Profit tile's link) can be off-screen.
  useEffect(() => {
    if (step !== "data") return;
    document
      .getElementById(`tab-${tab}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, step]);

  // Arrow keys move between tabs, per the ARIA tabs pattern.
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const order: Tab[] = ["sku", "orders", "price", "inventory", "stock"];
    const i = order.indexOf(tab);
    const next =
      order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
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
    setCatalogError(null);
    const [result, recent, stock, prices] = await Promise.all([
      loadWalmartData(clientId, clientSecret, [...selectedDates]),
      loadUnsettledOrders(clientId, clientSecret),
      loadInventory(clientId, clientSecret),
      loadListedPrices(clientId, clientSecret),
    ]);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // Recent orders, inventory and listed prices are extras - if any
    // fails, still show settled data rather than blocking the whole page.
    if ("error" in recent) {
      setUnsettledError(recent.error);
      setUnsettled([]);
      setOrderDates({});
    } else {
      setUnsettled(recent.lines);
      setOrderDates(recent.orderDates);
    }
    setInventory("error" in stock ? [] : stock.inventory);
    if ("error" in prices) {
      setCatalogError(prices.error);
      setCatalog([]);
    } else {
      setCatalog(prices.catalog);
    }
    setRows(result.rows);
    setStep("data");
  }

  function clearData() {
    setRows(null);
    setUnsettled([]);
    setUnsettledError(null);
    setInventory([]);
    setOrderDates({});
    setCatalog([]);
    setCatalogError(null);
    setInputs({});
    setLotDrafts({});
    setExpanded(new Set());
    setImportPreview(null);
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

  // saleDate feeds the price chart; it lives beside orderDate/postedDate
  // rather than replacing them, so the CSV export is unaffected.
  const lines = useMemo(
    () =>
      assignSaleDates(
        [...unsettled, ...(rows ? groupReconRows(rows) : [])],
        orderDates
      ),
    [rows, unsettled, orderDates]
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

  const priceSeries = useMemo(() => priceSeriesBySku(lines), [lines]);

  const stockVal = useMemo(
    () => stockValue(inventory, catalog, parsedInputs),
    [inventory, catalog, parsedInputs]
  );

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

  // Summary tiles follow the tables' rules. Revenue and units are exact
  // for every line, so they can be totalled. Fee-derived figures keep
  // settled and estimated apart. Profit counts only lines with a cost
  // entered - a line with no cost would otherwise add a profit that
  // silently assumed the item was free.
  const kpi = useMemo(() => {
    const sum = (rows: typeof margins, f: (m: (typeof margins)[number]) => number) =>
      rows.reduce((n, m) => n + f(m), 0);
    const settled = margins.filter((m) => m.status === "settled");
    const costedSettled = settled.filter((m) => m.hasCost);
    const costedEstimated = margins.filter(
      (m) => m.status === "estimated" && !m.noEstimate && m.hasCost
    );
    return {
      revenue: sum(margins, (m) => m.revenue),
      revenueSettled: sum(settled, (m) => m.revenue),
      units: sum(margins, (m) => m.qty),
      profitSettled: sum(costedSettled, (m) => m.profit),
      profitEstimated: sum(costedEstimated, (m) => m.profit),
      costedSettled: costedSettled.length,
      costedEstimated: costedEstimated.length,
      uncosted: margins.filter((m) => !m.noEstimate && !m.hasCost).length,
    };
  }, [margins]);

  if (step === "credentials") {
    return (
      <>
        <div className="sc-card mx-auto mt-2 sm:mt-8 flex w-full max-w-md flex-col gap-5 p-6">
          <div>
            <h1 className="text-[28px] leading-9 font-normal">Sign in with your API keys</h1>
            <p className="mt-2 text-sm text-sc-ink-2">
              Paste your Walmart Marketplace API credentials (from Seller
              Center) to see which settlement reports are available. Nothing
              is saved anywhere — refresh this page and it&apos;s gone.
            </p>
          </div>
          <form onSubmit={handleListReports} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-bold">
              Client ID
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="sc-input font-normal"
                autoComplete="off"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              Client Secret
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="sc-input font-normal"
                autoComplete="off"
                required
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="sc-btn-primary mt-1 w-full"
            >
              {loading ? "Checking…" : "See available reports"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        </div>
        <InstallPrompt />
      </>
    );
  }

  if (step === "reports") {
    return (
      <div className="sc-card mx-auto mt-8 flex w-full max-w-md flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[28px] leading-9 font-normal">Settlement reports</h1>
          <button onClick={startOver} className="sc-link mt-2 shrink-0 text-sm">
            Start over
          </button>
        </div>
        <p className="text-sm text-sc-ink-2">
          These are the same reports Walmart shows under Payments in Seller
          Center — one per settlement period, roughly every two weeks. Pick
          which to pull.
        </p>
        <div className="flex flex-col overflow-hidden rounded-lg border border-sc-line">
          {reportDates.map((date) => (
            <label
              key={date}
              className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-sc-row px-3 py-2.5 text-sm last:border-b-0 hover:bg-sc-head"
            >
              <input
                type="checkbox"
                checked={selectedDates.has(date)}
                onChange={() => toggleDate(date)}
              />
              {formatReportDate(date)}
              <span className="text-sc-ink-2/70">
                ({date})
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-4 text-sm">
          <button
            onClick={() => setSelectedDates(new Set(reportDates))}
            className="sc-link"
          >
            Select all
          </button>
          <button
            onClick={() => setSelectedDates(new Set())}
            className="sc-link"
          >
            Select none
          </button>
        </div>
        <button
          onClick={handleLoadSelected}
          disabled={loading || selectedDates.size === 0}
          className="sc-btn-primary w-full"
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-normal">Margins dashboard</h1>
          <p className="mt-1 text-sm text-sc-ink-2">
            Settlement reports:{" "}
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
        <div className="flex gap-2">
          <button
            onClick={() => {
              clearData();
              setStep("reports");
            }}
            className="sc-btn"
          >
            Change reports
          </button>
          <button onClick={startOver} className="sc-btn">
            Start over
          </button>
        </div>
      </div>

      {/* Phone: one swipeable row, so the data isn't pushed a screen and a
            half down by five stacked tiles. Grid from sm up. */}
      <div
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5"
        aria-label="Summary"
      >
        <KpiTile label="Revenue" value={money(kpi.revenue)}>
          {money(kpi.revenueSettled)} settled ·{" "}
          {money(kpi.revenue - kpi.revenueSettled)} not yet settled
        </KpiTile>
        <KpiTile label="Units sold" value={kpi.units.toLocaleString("en-US")}>
          {margins.length} order line{margins.length === 1 ? "" : "s"} ·{" "}
          {skuSummaries.length} product{skuSummaries.length === 1 ? "" : "s"}
        </KpiTile>
        <KpiTile
          label="Net after fees"
          value={settledCount > 0 ? money(settledTotals.netAmount) : "—"}
        >
          settled
          {estimatedCount > 0 &&
            ` · + ${money(estimatedTotals.netAmount)} estimated`}
          {noEstimateCount > 0 && ` · ${noEstimateCount} not estimable`}
        </KpiTile>
        <KpiTile
          label="Profit"
          value={kpi.costedSettled > 0 ? money(kpi.profitSettled) : "—"}
        >
          {kpi.costedSettled + kpi.costedEstimated === 0 ? (
            <button onClick={() => setTab("inventory")} className="sc-link">
              Enter purchase costs to see profit
            </button>
          ) : (
            <>
              settled
              {kpi.costedEstimated > 0 &&
                ` · + ${money(kpi.profitEstimated)} estimated`}
              {kpi.uncosted > 0 && (
                <span className="block text-amber-600">
                  {kpi.uncosted} line{kpi.uncosted === 1 ? "" : "s"} with no
                  cost left out
                </span>
              )}
            </>
          )}
        </KpiTile>
        <KpiTile
          label="Stock value"
          value={
            stockVal.totals.costedSkus > 0 ? money(stockVal.totals.atCost) : "—"
          }
        >
          at cost · {stockVal.totals.costedSkus} of{" "}
          {stockVal.totals.stockedSkus} in-stock SKUs
          {stockVal.totals.pricedSkus > 0 && (
            <span className="block">
              {money(stockVal.totals.atPrice)} at listed price
            </span>
          )}
        </KpiTile>
      </div>

      <div className="sc-card">
        <div
          role="tablist"
          aria-label="Dashboard views"
          onKeyDown={onTabKey}
          className="flex gap-6 overflow-x-auto border-b border-sc-line px-4 sm:px-6"
        >
          {(
            [
              ["sku", `By SKU (${skuSummaries.length})`],
              ["orders", `Order lines (${margins.length})`],
              ["price", "Price over time"],
              ["inventory", `Inventory & costs (${skus.length})`],
              ["stock", `Stock value (${stockVal.totals.stockedSkus})`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              id={`tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className="sc-tab"
            >
              {label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="flex flex-col gap-3 p-4 sm:p-6"
        >
      {tab === "inventory" && (
      <>
        <PanelHeader
          title="Inventory and costs"
          action={
            <div className="flex gap-2">
              <button
                onClick={() =>
                  downloadCsv("walmart-costs", costsToCsv(skus, parsedInputs))
                }
                disabled={skus.length === 0}
                className="sc-btn"
                title="Downloads every SKU's purchase batches and box info as a CSV - blank if nothing entered yet, so it also works as a fill-in template."
              >
                Export costs
              </button>
              <button
                onClick={() => importFileRef.current?.click()}
                className="sc-btn"
              >
                Import CSV
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          }
        >
          Not saved — re-enter each session. Add a batch for each price you
          bought an item at, including units already sold; cost per unit is
          the quantity-weighted average across batches. &ldquo;Left&rdquo;
          is purchased − sold and should match Walmart&apos;s on-hand
          count.
        </PanelHeader>
        {importPreview && (
          <ImportPreviewCard
            preview={importPreview}
            existingSkuCount={
              new Set([...Object.keys(inputs), ...Object.keys(lotDrafts)]).size
            }
            onApply={applyImport}
            onCancel={cancelImport}
          />
        )}

        {/* Phone: one card per SKU. Tables take over from md up. */}
        <ul className="flex flex-col gap-3 md:hidden">
          {skus.map((sku) => {
            const parsed = parsedInputs[sku] ?? {};
            const inv = inventoryBySku.get(sku);
            return (
              <InventoryCard
                key={sku}
                sku={sku}
                onHand={inv ? inv.onHand : null}
                onHandTitle={
                  inv
                    ? `${inv.availToSell} available to sell + ${inv.reserved} ordered but not shipped`
                    : undefined
                }
                stock={reconcileStock(parsed.lots, soldBySku.get(sku) ?? 0, inv ? inv.onHand : null)}
                avg={averageUnitCost(parsed.lots)}
                cu={cubicInches(parsed)}
                dim={dimWeight(parsed)}
                boxValues={inputs[sku] ?? {}}
                onBoxChange={(field, value) => setField(sku, field, value)}
                drafts={lotDrafts[sku] ?? []}
                isOpen={expanded.has(sku)}
                onToggle={() => toggleExpanded(sku)}
                onAdd={() => addLot(sku)}
                onUpdate={(i, field, value) => updateLot(sku, i, field, value)}
                onRemove={(i) => removeLot(sku, i)}
              />
            );
          })}
          {skus.length === 0 && (
            <li className="text-sm text-sc-ink-2">No SKUs found in the returned data.</li>
          )}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="sc-table w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-sc-line text-left">
                <th className="pr-3">SKU</th>
                <th className="pr-3 text-right">On hand</th>
                <th className="pr-3 text-right">Sold</th>
                <th className="pr-3 text-right">Bought</th>
                <th
                  className="pr-3 text-right"
                  title="Purchased − sold. Amber when it disagrees with Walmart's on-hand count."
                >
                  Left
                </th>
                <th className="pr-3 text-right">Avg cost</th>
                {BOX_FIELDS.map((f) => (
                  <th key={f.key} className="pr-3 text-right">
                    {f.label}
                  </th>
                ))}
                <th className="pr-3 text-right">Cu in</th>
                <th
                  className="pr-3 text-right"
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
                    <tr className="border-b border-sc-row">
                      <td className="pr-3">
                        <button
                          onClick={() => toggleExpanded(sku)}
                          className="sc-link text-left"
                          title={
                            drafts.length > 0
                              ? `${drafts.length} batch${drafts.length === 1 ? "" : "es"}`
                              : "Add a purchase batch"
                          }
                        >
                          <span className="text-sc-ink-2/70">
                            {isOpen ? "▾ " : "▸ "}
                          </span>
                          {sku}
                          {drafts.length > 0 && (
                            <span className="text-sc-ink-2/70">
                              {" "}
                              ({drafts.length})
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="pr-3 text-right">
                        {inv ? (
                          <span
                            title={`${inv.availToSell} available to sell + ${inv.reserved} ordered but not shipped. The quantity last set on the listing is ${inv.fedQty}, but that number doesn't drop as units ship.`}
                          >
                            {inv.onHand}
                          </span>
                        ) : (
                          <span className="text-sc-ink-2/70">
                            —
                          </span>
                        )}
                      </td>
                      <td className="pr-3 text-right">
                        {soldBySku.get(sku) ?? 0}
                      </td>
                      <td className="pr-3 text-right">
                        {stock.purchased || (
                          <span className="text-sc-ink-2/70">
                            —
                          </span>
                        )}
                      </td>
                      <td
                        className={`pr-3 text-right ${stock.discrepancy ? "text-amber-600" : ""}`}
                        title={
                          stock.discrepancy
                            ? `Your batches imply ${stock.impliedOnHand} left, Walmart says ${stock.onHand}. Off by ${stock.discrepancy > 0 ? "+" : ""}${stock.discrepancy} — likely a missing or mistyped batch.`
                            : undefined
                        }
                      >
                        {stock.purchased === 0 ? (
                          <span className="text-sc-ink-2/70">
                            —
                          </span>
                        ) : (
                          stock.impliedOnHand
                        )}
                      </td>
                      <td className="pr-3 text-right font-medium">
                        {avg === null ? (
                          <span className="text-amber-600">—</span>
                        ) : (
                          money(avg)
                        )}
                      </td>
                      {BOX_FIELDS.map((f) => (
                        <td key={f.key} className="pr-3">
                          <input
                            type="number"
                            inputMode="decimal"
                            step={f.step}
                            min="0"
                            placeholder="—"
                            aria-label={`${f.label} for ${sku}`}
                            value={inputs[sku]?.[f.key] ?? ""}
                            onChange={(e) =>
                              setField(sku, f.key, e.target.value)
                            }
                            className="w-24 sc-input text-right"
                          />
                        </td>
                      ))}
                      <td className="pr-3 text-right text-sc-ink-2">
                        {cu === null ? "—" : cu.toFixed(0)}
                      </td>
                      <td className="pr-3 text-right text-sc-ink-2">
                        {dim === null ? "—" : `${dim.toFixed(1)} lb`}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-sc-row bg-sc-head">
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
                    className="py-3 text-sc-ink-2"
                  >
                    No SKUs found in the returned data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
      )}

      {tab === "stock" && (
      <>
        <PanelHeader title="Stock value">
          What the units you have on hand are worth: at what they cost you
          (your average across the batches entered under Inventory &amp;
          costs) and at the price they&apos;re currently listed for. Only
          products in stock are shown. Seller-fulfilled stock only — units
          in Walmart&apos;s warehouses (WFS) aren&apos;t included yet.
        </PanelHeader>
        {catalogError && (
          <p className="text-sm text-amber-600">
            Couldn&apos;t load listed prices: {catalogError}
          </p>
        )}
        <StockValueTable stock={stockVal} />
      </>
      )}

      {tab === "sku" && (
      <>
        <PanelHeader
          title="By SKU"
          action={
            <button
              onClick={() =>
                downloadCsv("walmart-by-sku", skuSummaryToCsv(skuSummaries))
              }
              disabled={skuSummaries.length === 0}
              className="sc-btn"
              title="Downloads this table as a CSV. Estimated rows are included and marked in the Status/line-count columns; cells that aren't known are left blank."
            >
              Download CSV
            </button>
          }
        >
          Settled and estimated order lines rolled up per product. A SKU
          with no settled history yet can&apos;t have its fees estimated,
          so its money columns show — rather than a misleading $0.00.
        </PanelHeader>
        <SkuSummaryTable summaries={skuSummaries} />
      </>
      )}

      {tab === "price" && (
      <>
        <PanelHeader title="Price over time" />
        <PriceChart series={priceSeries} />
      </>
      )}

      {tab === "orders" && (
      <>
        <PanelHeader
          title="Order lines"
          action={
            <button
              onClick={() =>
                downloadCsv("walmart-order-lines", orderLinesToCsv(margins))
              }
              disabled={margins.length === 0}
              className="sc-btn"
              title="Downloads this table as a CSV, one row per order line, with a Status column (Settled / Estimated / Not estimable). Excel shows the 15-digit purchase order numbers in scientific notation until you widen the column; the values are intact."
            >
              Download CSV
            </button>
          }
        />
        <p className="text-sm text-sc-ink-2">
          Revenue − commission − shipping − other − your cost = profit. Fee
          columns are shown as Walmart reports them (negative = money out).
          <span className="italic"> Est.</span> rows are orders Walmart
          hasn&apos;t settled yet: revenue is exact, but commission and
          shipping are projected from that SKU&apos;s settled history and
          switch to exact figures once the order settles.
        </p>

        <ul className="flex flex-col gap-3 md:hidden">
          {margins.map((m) => (
            <OrderLineCard
              key={`${m.status}-${m.purchaseOrderNo}-${m.purchaseOrderLine}`}
              m={m}
            />
          ))}
          {margins.length === 0 && (
            <li className="text-sm text-sc-ink-2">No order lines found.</li>
          )}
          {settledCount > 0 && (
            <TotalsCard
              label={`Settled · ${settledCount} line${settledCount === 1 ? "" : "s"}`}
              totals={settledTotals}
              uncosted={
                margins.filter((m) => m.status === "settled" && !m.hasCost).length
              }
            />
          )}
          {estimatedCount > 0 && (
            <TotalsCard
              label={`Estimated · ${estimatedCount} line${estimatedCount === 1 ? "" : "s"}${noEstimateCount > 0 ? ` (+${noEstimateCount} not estimable, excluded)` : ""}`}
              totals={estimatedTotals}
              uncosted={
                margins.filter(
                  (m) => m.status === "estimated" && !m.noEstimate && !m.hasCost
                ).length
              }
              italic
            />
          )}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="sc-table w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-sc-line text-left">
                <th className="pr-3">Status</th>
                <th className="pr-3">SKU</th>
                <th className="pr-3">Item</th>
                <th className="pr-3">Fulfillment</th>
                <th className="pr-3 text-right">Qty</th>
                <th className="pr-3 text-right">Revenue</th>
                <th className="pr-3 text-right">Commission</th>
                <th className="pr-3 text-right">Shipping</th>
                <th className="pr-3 text-right">Other</th>
                <th className="pr-3 text-right">Net</th>
                <th className="pr-3 text-right">Cost</th>
                <th className="pr-3 text-right">Profit</th>
                <th className="pr-3 text-right">Margin</th>
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
                    className={`border-b border-sc-row ${est ? "italic text-sc-ink-2" : ""}`}
                  >
                    <td
                      className="pr-3"
                      title={
                        est ? `Ordered ${m.orderDate} · ${m.estimateNote}` : undefined
                      }
                    >
                      {est ? `Est. · ${m.orderDate?.slice(5)}` : "Settled"}
                    </td>
                    <td className="pr-3">{m.sku}</td>
                    <td
                      className="max-w-[11rem] truncate pr-3"
                      title={m.itemName}
                    >
                      {m.itemName}
                    </td>
                    <td className="pr-3">{m.fulfillmentType}</td>
                    <td className="pr-3 text-right">{m.qty}</td>
                    <td className="pr-3 text-right">{money(m.revenue)}</td>
                    <td
                      className="pr-3 text-right text-red-600"
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
                      className="pr-3 text-right text-red-600"
                      title={est ? m.estimateNote : undefined}
                    >
                      {m.noEstimate ? noEst : money(m.shipping)}
                    </td>
                    <td
                      className="pr-3 text-right"
                      title={`Tax collected/withheld: ${money(m.tax)}`}
                    >
                      {money(m.tax + m.otherFees)}
                    </td>
                    <td className="pr-3 text-right">
                      {m.noEstimate ? noEst : money(m.netAmount)}
                    </td>
                    <td
                      className="pr-3 text-right"
                      title={`Item ${money(m.itemCostTotal)} + box ${money(m.boxCostTotal)}`}
                    >
                      {m.costTotal !== 0 || m.hasCost ? (
                        money(-m.costTotal)
                      ) : (
                        <span className="text-amber-600">—</span>
                      )}
                    </td>
                    <td
                      className="pr-3 text-right font-medium"
                      title={
                        !m.noEstimate && !m.hasCost
                          ? "No cost entered for this SKU, so profit isn't known yet"
                          : undefined
                      }
                    >
                      {m.noEstimate ? (
                        noEst
                      ) : m.hasCost ? (
                        money(m.profit)
                      ) : (
                        <span className="text-amber-600">—</span>
                      )}
                    </td>
                    <td className="pr-3 text-right">
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
                    className="py-3 text-sc-ink-2"
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
                    uncosted={
                      margins.filter((m) => m.status === "settled" && !m.hasCost)
                        .length
                    }
                    first
                  />
                )}
                {estimatedCount > 0 && (
                  <TotalsRow
                    label={`Estimated · ${estimatedCount} line${estimatedCount === 1 ? "" : "s"}${noEstimateCount > 0 ? ` (+${noEstimateCount} with no estimate, excluded)` : ""}`}
                    totals={estimatedTotals}
                    uncosted={
                      margins.filter(
                        (m) =>
                          m.status === "estimated" && !m.noEstimate && !m.hasCost
                      ).length
                    }
                    first={settledCount === 0}
                    italic
                  />
                )}
              </tfoot>
            )}
          </table>
        </div>
      </>
      )}
        </div>
      </div>
    </div>
  );
}

function PanelHeader({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children && <p className="text-sm text-sc-ink-2">{children}</p>}
    </div>
  );
}

function ImportPreviewCard({
  preview,
  existingSkuCount,
  onApply,
  onCancel,
}: {
  preview: CostImportResult;
  existingSkuCount: number;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { stats, warnings, errors } = preview;
  return (
    <div className="sc-card flex flex-col gap-3 border-2 border-sc-line p-4">
      <h3 className="text-base font-bold">Review import</h3>
      <p className="text-sm text-sc-ink-2">
        {stats.skus} SKU{stats.skus === 1 ? "" : "s"} — {stats.batches}{" "}
        purchase batch{stats.batches === 1 ? "" : "es"}, {stats.boxed} with
        box info.
        {stats.skippedRows > 0 &&
          ` ${stats.skippedRows} row${stats.skippedRows === 1 ? "" : "s"} skipped, see below.`}
      </p>
      {existingSkuCount > 0 && (
        <p className="text-sm text-amber-600">
          This replaces your current entries for {existingSkuCount} SKU
          {existingSkuCount === 1 ? "" : "s"}.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-amber-600">
          {warnings.slice(0, 20).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {warnings.length > 20 && <li>…and {warnings.length - 20} more</li>}
        </ul>
      )}
      {errors.length > 0 && (
        <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-red-600">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>
              {e.row > 0 ? `Row ${e.row}: ` : ""}
              {e.message}
            </li>
          ))}
          {errors.length > 20 && <li>…and {errors.length - 20} more</li>}
        </ul>
      )}
      <div className="flex gap-2">
        <button
          onClick={onApply}
          disabled={stats.skus === 0}
          className="sc-btn-primary"
        >
          Apply import
        </button>
        <button onClick={onCancel} className="sc-btn">
          Cancel
        </button>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="sc-card flex w-[68%] shrink-0 snap-start flex-col gap-1 p-4 sm:w-auto">
      <div className="text-xs font-bold text-sc-ink-2">{label}</div>
      <div className="text-2xl leading-8">{value}</div>
      <div className="text-xs leading-4 text-sc-ink-2">{children}</div>
    </div>
  );
}

function StockValueTable({
  stock,
}: {
  stock: ReturnType<typeof stockValue>;
}) {
  const { rows, totals: t } = stock;
  const dash = <span className="text-sc-ink-2/70">—</span>;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-sc-ink-2">
        Nothing in stock right now.
      </p>
    );
  }

  const uncosted = t.stockedSkus - t.costedSkus;
  const unlisted = t.stockedSkus - t.pricedSkus - t.unpublishedSkus;

  return (
    <div className="flex flex-col gap-3">
      {/* Totals say how many SKUs they cover, so a partial total can't
          read as the whole picture. */}
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <div className="text-sc-ink-2">At cost</div>
          <div className="text-lg font-semibold">
            {t.costedSkus > 0 ? money(t.atCost) : "—"}
          </div>
          <div className="text-xs text-sc-ink-2">
            {t.costedSkus} of {t.stockedSkus} stocked SKU
            {t.stockedSkus === 1 ? "" : "s"}
            {uncosted > 0 && (
              <span className="text-amber-600">
                {" "}
                · {uncosted} with no cost entered
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-sc-ink-2">
            At current price
          </div>
          <div className="text-lg font-semibold">
            {t.pricedSkus > 0 ? money(t.atPrice) : "—"}
          </div>
          <div className="text-xs text-sc-ink-2">
            {t.pricedSkus} of {t.stockedSkus} stocked SKU
            {t.stockedSkus === 1 ? "" : "s"}
            {t.unpublishedSkus > 0 && (
              <span className="text-amber-600">
                {" "}
                · excludes {t.unpublishedSkus} unpublished (can&apos;t sell
                right now)
              </span>
            )}
            {unlisted > 0 && (
              <span className="text-amber-600">
                {" "}
                · {unlisted} with no listed price
              </span>
            )}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.sku} className="rounded-lg border border-sc-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-bold break-words">{r.sku}</div>
              <div className="shrink-0 text-sm text-sc-ink-2">
                {r.onHand} on hand
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <Fig label="Avg cost">
                {r.avgCost === null ? (
                  <span className="text-amber-600">no cost</span>
                ) : (
                  money(r.avgCost)
                )}
              </Fig>
              <Fig label="Listed price">
                {r.listedPrice === null ? dash : money(r.listedPrice)}
              </Fig>
              <Fig label="Value at cost">
                {r.valueAtCost === null ? dash : money(r.valueAtCost)}
              </Fig>
              <Fig label="Value at price">
                {r.valueAtPrice === null ? (
                  dash
                ) : r.isPublished ? (
                  money(r.valueAtPrice)
                ) : (
                  <span className="text-amber-600">{money(r.valueAtPrice)}</span>
                )}
              </Fig>
            </dl>
            {r.valueAtPrice !== null && !r.isPublished && (
              <p className="mt-2 text-xs text-amber-600">
                Unpublished ({r.publishedStatus}) — can&apos;t sell right now, so
                it&apos;s left out of the at-price total.
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="sc-table w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-sc-line text-left">
              <th className="pr-3">SKU</th>
              <th className="pr-3 text-right">On hand</th>
              <th className="pr-3 text-right">Avg cost</th>
              <th className="pr-3 text-right">Listed price</th>
              <th className="pr-3 text-right">Value at cost</th>
              <th className="pr-3 text-right">Value at price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.sku}
                className="border-b border-sc-row"
              >
                <td className="pr-3">{r.sku}</td>
                <td className="pr-3 text-right">{r.onHand}</td>
                <td
                  className="pr-3 text-right"
                  title={
                    r.avgCost === null
                      ? "No purchase batches entered for this SKU"
                      : undefined
                  }
                >
                  {r.avgCost === null ? (
                    <span className="text-amber-600">no cost</span>
                  ) : (
                    money(r.avgCost)
                  )}
                </td>
                <td className="pr-3 text-right">
                  {r.listedPrice === null ? dash : money(r.listedPrice)}
                </td>
                <td className="pr-3 text-right">
                  {r.valueAtCost === null ? dash : money(r.valueAtCost)}
                </td>
                <td
                  className="pr-3 text-right"
                  title={
                    r.valueAtPrice !== null && !r.isPublished
                      ? `Not currently sellable: listing status is ${r.publishedStatus}. Left out of the at-price total.`
                      : undefined
                  }
                >
                  {r.valueAtPrice === null ? (
                    dash
                  ) : r.isPublished ? (
                    money(r.valueAtPrice)
                  ) : (
                    <span className="text-amber-600">
                      {money(r.valueAtPrice)} unpublished
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A small label-over-value pair for the phone cards. */
function Fig({
  label,
  children,
  className = "",
  title,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={className} title={title}>
      <dt className="text-xs text-sc-ink-2">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

function InventoryCard({
  sku,
  onHand,
  onHandTitle,
  stock,
  avg,
  cu,
  dim,
  boxValues,
  onBoxChange,
  drafts,
  isOpen,
  onToggle,
  onAdd,
  onUpdate,
  onRemove,
}: {
  sku: string;
  onHand: number | null;
  onHandTitle?: string;
  stock: ReturnType<typeof reconcileStock>;
  avg: number | null;
  cu: number | null;
  dim: number | null;
  boxValues: Partial<Record<SkuField, string>>;
  onBoxChange: (field: SkuField, value: string) => void;
  drafts: LotDraft[];
  isOpen: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onUpdate: (index: number, field: keyof LotDraft, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const muted = <span className="text-sc-ink-2/70">—</span>;
  return (
    <li className="rounded-lg border border-sc-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-bold break-words">{sku}</div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-sc-ink-2">Avg cost</div>
          <div className="font-bold">
            {avg === null ? <span className="text-amber-600">no cost</span> : money(avg)}
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2">
        <Fig label="On hand" title={onHandTitle}>
          {onHand ?? muted}
        </Fig>
        <Fig label="Sold">{stock.sold}</Fig>
        <Fig label="Bought">{stock.purchased || muted}</Fig>
        <Fig
          label="Left"
          title={
            stock.discrepancy
              ? `Your batches imply ${stock.impliedOnHand} left, Walmart says ${stock.onHand}.`
              : undefined
          }
        >
          {stock.purchased === 0 ? (
            muted
          ) : (
            <span className={stock.discrepancy ? "text-amber-600" : ""}>
              {stock.impliedOnHand}
            </span>
          )}
        </Fig>
      </dl>
      {stock.discrepancy ? (
        <p className="mt-1 text-xs text-amber-600">
          Batches imply {stock.impliedOnHand} left; Walmart says {stock.onHand}.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {BOX_FIELDS.map((f) => (
          <label key={f.key} className="flex min-w-0 flex-col gap-1 text-xs text-sc-ink-2">
            {f.label}
            <input
              type="number"
              inputMode="decimal"
              step={f.step}
              min="0"
              placeholder="—"
              aria-label={`${f.label} for ${sku}`}
              value={boxValues[f.key] ?? ""}
              onChange={(e) => onBoxChange(f.key, e.target.value)}
              className="sc-input w-full min-w-0 text-right text-sc-ink"
            />
          </label>
        ))}
      </div>
      {(cu !== null || dim !== null) && (
        <p className="mt-1 text-xs text-sc-ink-2">
          {cu?.toFixed(0)} cu in · {dim?.toFixed(1)} lb dim wt (estimate)
        </p>
      )}

      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="sc-btn mt-3 w-full justify-between"
      >
        <span>
          Purchase batches{drafts.length > 0 ? ` (${drafts.length})` : ""}
        </span>
        <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
      </button>
      {isOpen && (
        <div className="mt-2 rounded-lg bg-sc-head p-3">
          <CostLotsEditor
            sku={sku}
            drafts={drafts}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        </div>
      )}
    </li>
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
    <div className="flex w-full flex-col items-start gap-2">
      <span className="text-xs text-sc-ink-2">
        Purchase batches for {sku}
      </span>

      {drafts.map((lot, i) => (
        <div key={i} className="flex w-full items-center gap-2 sm:w-auto">
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Qty"
            aria-label={`Batch ${i + 1} quantity for ${sku}`}
            value={lot.qty}
            onChange={(e) => onUpdate(i, "qty", e.target.value)}
            inputMode="numeric"
            className="sc-input w-16 shrink-0 text-right sm:w-20"
          />
          <span className="text-sc-ink-2/70">×</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Price each"
            aria-label={`Batch ${i + 1} unit cost for ${sku}`}
            value={lot.unitCost}
            onChange={(e) => onUpdate(i, "unitCost", e.target.value)}
            inputMode="decimal"
            className="sc-input w-24 shrink-0 text-right sm:w-28"
          />
          <span className="hidden text-right text-sc-ink-2 sm:inline sm:w-24">
            {!Number.isNaN(parseFloat(lot.qty)) &&
            !Number.isNaN(parseFloat(lot.unitCost))
              ? money(parseFloat(lot.qty) * parseFloat(lot.unitCost))
              : ""}
          </span>
          <button
            onClick={() => onRemove(i)}
            className="ml-auto shrink-0 p-2 text-sc-ink-2/70 hover:text-red-600 sm:ml-0"
            aria-label={`Remove batch ${i + 1} for ${sku}`}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button onClick={onAdd} className="sc-link text-sm">
          + Add batch
        </button>
        {units > 0 && (
          <span className="text-sm text-sc-ink-2">
            {units} unit{units === 1 ? "" : "s"} · {money(spent)} spent ·
            avg {avg === null ? "—" : money(avg)} each
          </span>
        )}
      </div>
    </div>
  );
}

function shipPctClass(pct: number | null): string {
  if (pct === null) return "";
  if (pct > SHIPPING_PCT_ALERT) return "text-red-600 font-medium";
  if (pct > SHIPPING_PCT_WARN) return "text-amber-600";
  return "";
}

function SkuSummaryTable({ summaries }: { summaries: SkuSummary[] }) {
  const dash = <span className="text-sc-ink-2/70">—</span>;

  return (
    <>
    <ul className="flex flex-col gap-3 md:hidden">
      {summaries.map((s) => {
        const t = s.totals;
        const unknownProfit = s.hasMoney && s.missingCost;
        return (
          <li key={s.sku} className="rounded-lg border border-sc-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold break-words">{s.sku}</div>
                <div className="truncate text-xs text-sc-ink-2">{s.itemName}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-sc-ink-2">Profit</div>
                <div className="font-bold">
                  {!s.hasMoney ? (
                    dash
                  ) : unknownProfit ? (
                    <span className="text-amber-600">—</span>
                  ) : (
                    money(t.profit)
                  )}
                </div>
                <div className="text-xs">
                  {!s.hasMoney ? null : unknownProfit ? (
                    <span className="text-amber-600">no cost</span>
                  ) : s.margin === null ? null : (
                    `${(s.margin * 100).toFixed(1)}% margin`
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 text-xs text-sc-ink-2">
              {s.units} unit{s.units === 1 ? "" : "s"} · {s.lines} line
              {s.lines === 1 ? "" : "s"}
              {s.estimatedLines > 0 && ` (${s.estimatedLines} est.)`}
              {s.noEstimateLines > 0 && ` · ${s.noEstimateLines} not estimable`}
            </p>

            {s.hasMoney ? (
              <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                <Fig label="Revenue">{money(t.revenue)}</Fig>
                <Fig label="Avg price">
                  {s.avgPrice === null ? dash : money(s.avgPrice)}
                </Fig>
                <Fig label="Net">{money(t.netAmount)}</Fig>
                <Fig label="Commission">
                  <span className="text-red-600">{money(t.commission)}</span>
                </Fig>
                <Fig
                  label="Shipping"
                  title={`Amber above ${SHIPPING_PCT_WARN * 100}% of revenue, red above ${SHIPPING_PCT_ALERT * 100}%.`}
                >
                  <span className="text-red-600">{money(t.shipping)}</span>
                  {s.shippingPct !== null && (
                    <span className={`block text-xs ${shipPctClass(s.shippingPct) || "text-sc-ink-2"}`}>
                      {(s.shippingPct * 100).toFixed(1)}% of revenue
                    </span>
                  )}
                </Fig>
                <Fig label="Cost">
                  {s.missingCost ? (
                    <span className="text-amber-600">—</span>
                  ) : (
                    money(-t.costTotal)
                  )}
                </Fig>
              </dl>
            ) : (
              <p className="mt-2 text-xs text-sc-ink-2">
                No settled history for this SKU yet, so its fees can&apos;t be
                estimated.
              </p>
            )}
          </li>
        );
      })}
      {summaries.length === 0 && (
        <li className="text-sm text-sc-ink-2">No SKUs found.</li>
      )}
    </ul>

    <div className="hidden overflow-x-auto md:block">
      <table className="sc-table w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-sc-line text-left">
            <th className="pr-3">SKU</th>
            <th className="pr-3">Item</th>
            <th className="pr-3 text-right">Units</th>
            <th className="pr-3 text-right">Lines</th>
            <th className="pr-3 text-right">Avg price</th>
            <th className="pr-3 text-right">Revenue</th>
            <th className="pr-3 text-right">Commission</th>
            <th className="pr-3 text-right">Shipping</th>
            <th
              className="pr-3 text-right"
              title={`Shipping as a share of revenue. Amber above ${SHIPPING_PCT_WARN * 100}%, red above ${SHIPPING_PCT_ALERT * 100}%.`}
            >
              Ship %
            </th>
            <th className="pr-3 text-right">Net</th>
            <th className="pr-3 text-right">Cost</th>
            <th className="pr-3 text-right">Profit</th>
            <th className="pr-3 text-right">Margin</th>
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
                  ? "text-red-600 font-medium"
                  : pct > SHIPPING_PCT_WARN
                    ? "text-amber-600"
                    : "";
            const noMoneyTitle = s.hasMoney
              ? undefined
              : "No settled history for this SKU yet, so its fees can't be estimated";

            return (
              <tr
                key={s.sku}
                className="border-b border-sc-row"
              >
                <td className="pr-3">{s.sku}</td>
                <td
                  className="max-w-[11rem] truncate pr-3"
                  title={s.itemName}
                >
                  {s.itemName}
                </td>
                <td className="pr-3 text-right">{s.units}</td>
                <td
                  className="pr-3 text-right"
                  title={`${s.settledLines} settled, ${s.estimatedLines} estimated${s.noEstimateLines > 0 ? `, ${s.noEstimateLines} not estimable` : ""}`}
                >
                  {s.lines}
                  {s.estimatedLines > 0 && (
                    <span className="text-sc-ink-2/70">
                      {" "}
                      ({s.estimatedLines} est.)
                    </span>
                  )}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {s.avgPrice === null ? dash : money(s.avgPrice)}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {s.hasMoney ? money(t.revenue) : dash}
                </td>
                <td
                  className="pr-3 text-right text-red-600"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.commission) : dash}
                </td>
                <td
                  className="pr-3 text-right text-red-600"
                  title={noMoneyTitle}
                >
                  {s.hasMoney ? money(t.shipping) : dash}
                </td>
                <td
                  className={`pr-3 text-right ${pctClass}`}
                  title={noMoneyTitle}
                >
                  {pct === null ? dash : `${(pct * 100).toFixed(1)}%`}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
                  {s.hasMoney ? money(t.netAmount) : dash}
                </td>
                <td
                  className="pr-3 text-right"
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
                  className="pr-3 text-right font-medium"
                  title={noMoneyTitle}
                >
                  {!s.hasMoney ? (
                    dash
                  ) : s.missingCost ? (
                    <span
                      className="text-amber-600"
                      title="No cost entered for this SKU, so profit isn't known yet"
                    >
                      —
                    </span>
                  ) : (
                    money(t.profit)
                  )}
                </td>
                <td className="pr-3 text-right" title={noMoneyTitle}>
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
              <td colSpan={13} className="py-3 text-sc-ink-2">
                No SKUs found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}

function OrderLineCard({ m }: { m: ReturnType<typeof computeMargins>[number] }) {
  const est = m.status === "estimated";
  const noEst = <span className="text-amber-600">no estimate</span>;
  return (
    <li
      className={`rounded-lg border border-sc-line p-3 ${est ? "bg-sc-head/60" : ""}`}
      title={est ? m.estimateNote : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-xs ${est ? "italic text-sc-ink-2" : "text-sc-ink-2"}`}>
            {est ? `Estimated · ordered ${m.orderDate}` : `Settled · ${m.postedDate ?? ""}`}
          </div>
          <div className="font-bold break-words">{m.sku}</div>
          <div className="truncate text-xs text-sc-ink-2">
            {m.qty} × {m.itemName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-sc-ink-2">Profit</div>
          <div className="font-bold">
            {m.noEstimate ? (
              noEst
            ) : m.hasCost ? (
              money(m.profit)
            ) : (
              <span className="text-amber-600">—</span>
            )}
          </div>
          <div className="text-xs">
            {m.noEstimate ? null : !m.hasCost ? (
              <span className="text-amber-600">no cost</span>
            ) : m.margin === null ? null : (
              `${(m.margin * 100).toFixed(1)}% margin`
            )}
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
        <Fig label="Revenue">{money(m.revenue)}</Fig>
        <Fig label="Commission">
          {m.noEstimate ? noEst : <span className="text-red-600">{money(m.commission)}</span>}
        </Fig>
        <Fig label="Shipping">
          {m.noEstimate ? noEst : <span className="text-red-600">{money(m.shipping)}</span>}
        </Fig>
        <Fig label="Net">{m.noEstimate ? noEst : money(m.netAmount)}</Fig>
        <Fig label="Cost">
          {m.hasCost || m.costTotal !== 0 ? (
            money(-m.costTotal)
          ) : (
            <span className="text-amber-600">—</span>
          )}
        </Fig>
        <Fig label="Other">{money(m.tax + m.otherFees)}</Fig>
      </dl>
      {est && m.estimateNote && (
        <p className="mt-2 text-xs text-sc-ink-2">{m.estimateNote}</p>
      )}
    </li>
  );
}

function TotalsCard({
  label,
  totals,
  uncosted,
  italic,
}: {
  label: string;
  totals: ReturnType<typeof sumMargins>;
  uncosted: number;
  italic?: boolean;
}) {
  const unknown = <span className="text-amber-600">—</span>;
  return (
    <li className={`rounded-lg border-2 border-sc-line bg-sc-head p-3 ${italic ? "italic" : ""}`}>
      <div className="text-sm font-bold">{label}</div>
      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
        <Fig label="Revenue">{money(totals.revenue)}</Fig>
        <Fig label="Commission">
          <span className="text-red-600">{money(totals.commission)}</span>
        </Fig>
        <Fig label="Shipping">
          <span className="text-red-600">{money(totals.shipping)}</span>
        </Fig>
        <Fig label="Net">{money(totals.netAmount)}</Fig>
        <Fig label="Cost">{uncosted > 0 ? unknown : money(-totals.costTotal)}</Fig>
        <Fig label="Profit">
          {uncosted > 0 ? unknown : money(totals.profit)}
        </Fig>
      </dl>
      {uncosted > 0 && (
        <p className="mt-2 text-xs not-italic text-amber-600">
          {uncosted} line{uncosted === 1 ? " has" : "s have"} no cost entered, so
          cost and profit aren&apos;t known yet.
        </p>
      )}
    </li>
  );
}

function TotalsRow({
  label,
  totals,
  uncosted,
  first,
  italic,
}: {
  label: string;
  totals: ReturnType<typeof sumMargins>;
  /** Lines in this group with no cost entered. Any at all makes the
   *  group's profit unknown rather than silently too high. */
  uncosted: number;
  first?: boolean;
  italic?: boolean;
}) {
  const unknown = (
    <span
      className="text-amber-600"
      title={`${uncosted} line${uncosted === 1 ? " has" : "s have"} no cost entered, so this total isn't known yet`}
    >
      —
    </span>
  );
  return (
    <tr
      className={`font-medium ${first ? "border-t-2 border-sc-line" : ""} ${italic ? "italic" : ""}`}
    >
      <td className="py-2 pr-3" colSpan={5}>
        {label}
      </td>
      <td className="py-2 pr-3 text-right">{money(totals.revenue)}</td>
      <td className="py-2 pr-3 text-right text-red-600">
        {money(totals.commission)}
      </td>
      <td className="py-2 pr-3 text-right text-red-600">
        {money(totals.shipping)}
      </td>
      <td className="py-2 pr-3 text-right">
        {money(totals.tax + totals.otherFees)}
      </td>
      <td className="py-2 pr-3 text-right">{money(totals.netAmount)}</td>
      <td
        className="py-2 pr-3 text-right"
        title={
          uncosted > 0
            ? undefined
            : `Item ${money(totals.itemCostTotal)} + box ${money(totals.boxCostTotal)}`
        }
      >
        {uncosted > 0 ? unknown : money(-totals.costTotal)}
      </td>
      <td className="py-2 pr-3 text-right">
        {uncosted > 0 ? unknown : money(totals.profit)}
      </td>
      <td className="py-2 pr-3 text-right">
        {uncosted > 0
          ? unknown
          : totals.revenue !== 0
            ? `${((totals.profit / totals.revenue) * 100).toFixed(1)}%`
            : "—"}
      </td>
    </tr>
  );
}
