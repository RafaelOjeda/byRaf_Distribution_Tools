"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildReport,
  normalizeSku,
  parseCostCsv,
  type CostImportResult,
  type CostInputs,
  type CostLot,
  type Report,
  type SkuCostInputs,
  type Snapshot,
  type SourceDescriptor,
} from "@/lib/middleware";
import { fetchSnapshot, listPeriods } from "@/lib/middleware/actions";
import { money, plural } from "./utils/format";
import { KpiTile } from "./components/shared/KpiTile";
import { ConnectStep } from "./components/ConnectStep";
import { PeriodSelectionStep } from "./components/PeriodSelectionStep";
import { InventoryTab } from "./components/tabs/InventoryTab";
import { StockTab } from "./components/tabs/StockTab";
import { FeesTab } from "./components/tabs/FeesTab";
import { SkuTab } from "./components/tabs/SkuTab";
import { PriceTab } from "./components/tabs/PriceTab";
import { OrdersTab } from "./components/tabs/OrdersTab";
import { useTabNavigation } from "./hooks/useTabNavigation";
import { useKeyedRecord } from "./hooks/useKeyedRecord";

import { BOX_FIELDS, type LotDraft, type SkuField, type Step, type Tab } from "./types";

export default function DashboardClient({
  sources,
}: {
  sources: SourceDescriptor[];
}) {
  const [step, setStep] = useState<Step>("connect");
  const { tab, setTab, onTabKey } = useTabNavigation(step);
  // connections[sourceId][fieldKey] = pasted value.
  const [connections, updateConnection, setConnections] =
    useKeyedRecord<Record<string, string>>();
  const [periodsBySource, setPeriodsBySource] = useState<
    Record<string, { periods: { id: string; label: string }[]; error?: string }>
  >({});
  const [selectedPeriods, updateSelectedPeriods, setSelectedPeriods] =
    useKeyedRecord<Set<string>>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string[] | "all">("all");
  // Raw strings keyed by normalized SKU, so a half-typed "1." doesn't fight the input.
  const [inputs, updateInput, setInputs] =
    useKeyedRecord<Partial<Record<SkuField, string>>>();
  const [lotDrafts, updateLotDrafts, setLotDrafts] = useKeyedRecord<LotDraft[]>();
  const [aliasDrafts, updateAliasDraft, setAliasDrafts] = useKeyedRecord<string>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<CostImportResult | null>(
    null
  );
  const importFileRef = useRef<HTMLInputElement>(null);

  function setCredential(sourceId: string, key: string, value: string) {
    updateConnection(sourceId, (prev = {}) => ({ ...prev, [key]: value }));
  }

  function setField(sku: string, field: SkuField, value: string) {
    updateInput(sku, (prev = {}) => ({ ...prev, [field]: value }));
  }

  function addLot(sku: string) {
    updateLotDrafts(sku, (prev = []) => [...prev, { qty: "", unitCost: "" }]);
    setExpanded((prev) => new Set(prev).add(sku));
  }

  function updateLot(
    sku: string,
    index: number,
    field: keyof LotDraft,
    value: string
  ) {
    updateLotDrafts(sku, (prev = []) =>
      prev.map((lot, i) => (i === index ? { ...lot, [field]: value } : lot))
    );
  }

  function removeLot(sku: string, index: number) {
    updateLotDrafts(sku, (prev = []) => prev.filter((_, i) => i !== index));
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a fix
    if (!file) return;
    const text = await file.text();
    setImportPreview(parseCostCsv(text));
  }

  // Replaces all cost/box inputs with what the file contained - the
  // preview step is the confirmation, so this doesn't ask again.
  function applyImport() {
    if (!importPreview) return;
    const nextInputs: typeof inputs = {};
    const nextLotDrafts: typeof lotDrafts = {};
    const nextAliasDrafts: typeof aliasDrafts = {};
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
      if (parsed.aliasSkus?.length) {
        nextAliasDrafts[sku] = parsed.aliasSkus.join(", ");
      }
    }
    setInputs(nextInputs);
    setLotDrafts(nextLotDrafts);
    setAliasDrafts(nextAliasDrafts);
    setExpanded(new Set(Object.keys(nextLotDrafts)));
    setImportPreview(null);
  }

  function cancelImport() {
    setImportPreview(null);
  }

  function toggleExpanded(sku: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  function togglePeriod(sourceId: string, periodId: string) {
    updateSelectedPeriods(sourceId, (prev = new Set()) => {
      const next = new Set(prev);
      if (next.has(periodId)) next.delete(periodId);
      else next.add(periodId);
      return next;
    });
  }

  const filledSourceIds = sources
    .filter((s) =>
      s.credentialFields.every((f) => (connections[s.id]?.[f.key] ?? "").trim() !== "")
    )
    .map((s) => s.id);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await listPeriods(connections);
    setLoading(false);
    setPeriodsBySource(result);

    const anyPeriods = Object.values(result).some((p) => p.periods.length > 0);
    const anySettlementFree = sources.some(
      (s) => filledSourceIds.includes(s.id) && !s.capabilities.settlements
    );
    if (!anyPeriods && !anySettlementFree) {
      setError(
        "None of the connected sources have anything available yet. Check the credentials and try again."
      );
      return;
    }
    // Default: everything selected for each source that listed periods.
    setSelectedPeriods(
      Object.fromEntries(
        Object.entries(result).map(([id, p]) => [
          id,
          new Set(p.periods.map((period) => period.id)),
        ])
      )
    );
    setStep("periods");
  }

  async function handleLoadSelected() {
    setLoading(true);
    setError(null);
    const periods = Object.fromEntries(
      Object.entries(selectedPeriods).map(([id, set]) => [id, [...set]])
    );
    try {
      const snap = await fetchSnapshot(connections, periods);
      setSnapshot(snap);
      setStep("data");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  function clearData() {
    setSnapshot(null);
    setSourceFilter("all");
    setInputs({});
    setLotDrafts({});
    setAliasDrafts({});
    setExpanded(new Set());
    setImportPreview(null);
    setError(null);
  }

  function startOver() {
    clearData();
    setStep("connect");
    setConnections({});
    setPeriodsBySource({});
    setSelectedPeriods({});
  }

  const parsedInputs = useMemo(() => {
    const out: CostInputs = {};
    for (const [sku, fields] of Object.entries(inputs)) {
      const parsed: SkuCostInputs = {};
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
    for (const [sku, raw] of Object.entries(aliasDrafts)) {
      const aliasSkus = raw
        .split(/[;,]/)
        .map((a) => a.trim())
        .filter(Boolean);
      if (aliasSkus.length > 0) out[sku] = { ...out[sku], aliasSkus };
    }
    return out;
  }, [inputs, lotDrafts, aliasDrafts]);

  // The middleware fetched the snapshot once; a cost edit only re-runs
  // buildReport (pure, no network), so this stays instant.
  const liveReport = useMemo(() => {
    if (!snapshot) return null;
    return buildReport(snapshot, parsedInputs, { sourceFilter });
  }, [snapshot, parsedInputs, sourceFilter]);

  const inventoryBySku = useMemo(() => {
    const m = new Map<string, Report["inventory"][number]>();
    for (const item of liveReport?.inventory ?? []) m.set(normalizeSku(item.sku), item);
    return m;
  }, [liveReport]);

  const skus = useMemo(() => {
    const set = new Set<string>();
    for (const l of liveReport?.orderLines ?? []) if (l.sku) set.add(normalizeSku(l.sku));
    for (const item of liveReport?.inventory ?? []) set.add(normalizeSku(item.sku));
    return [...set].sort();
  }, [liveReport]);

  const soldBySku = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of liveReport?.bySku ?? []) m.set(s.sku, s.units);
    return m;
  }, [liveReport]);

  if (step === "connect") {
    return (
      <ConnectStep
        sources={sources}
        connections={connections}
        onCredentialChange={setCredential}
        loading={loading}
        error={error}
        filledSourceIds={filledSourceIds}
        onSubmit={handleConnect}
      />
    );
  }

  if (step === "periods") {
    return (
      <PeriodSelectionStep
        sources={sources}
        filledSourceIds={filledSourceIds}
        periodsBySource={periodsBySource}
        selectedPeriods={selectedPeriods}
        loading={loading}
        error={error}
        onTogglePeriod={togglePeriod}
        onStartOver={startOver}
        onLoadSelected={handleLoadSelected}
      />
    );
  }

  const r = liveReport;
  if (!r) return null;

  const margins = r.orderLines;
  const skuSummaries = r.bySku;
  const priceSeries = r.priceSeries;
  const stockVal = r.stock;
  const kpi = r.kpis;
  const settledTotals = r.settledTotals;
  const estimatedTotals = r.estimatedTotals;
  const settledCount = r.settledCount;
  const estimatedCount = r.estimatedCount;
  const noEstimateCount = r.noEstimateCount;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-normal">Margins dashboard</h1>
          <p className="mt-1 text-sm text-sc-ink-2">
            {r.sources
              .filter((s) => s.status === "ok")
              .map((s) => s.label)
              .join(", ") || "No sources connected"}
          </p>
          {r.notes.map((n) => (
            <p key={n} className="text-sm text-amber-600">
              {n}
            </p>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              clearData();
              setStep("periods");
            }}
            className="sc-btn"
          >
            Change periods
          </button>
          <button onClick={startOver} className="sc-btn">
            Start over
          </button>
        </div>
      </div>

      {r.sources.filter((s) => s.status === "ok").length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Filter by source">
          <button
            onClick={() => setSourceFilter("all")}
            className={sourceFilter === "all" ? "sc-btn-primary" : "sc-btn"}
            aria-pressed={sourceFilter === "all"}
          >
            All
          </button>
          {r.sources
            .filter((s) => s.status === "ok")
            .map((s) => (
              <button
                key={s.id}
                onClick={() => setSourceFilter([s.id])}
                className={
                  sourceFilter !== "all" && sourceFilter.includes(s.id)
                    ? "sc-btn-primary"
                    : "sc-btn"
                }
                aria-pressed={sourceFilter !== "all" && sourceFilter.includes(s.id)}
              >
                {s.label}
              </button>
            ))}
        </div>
      )}

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
          {plural(margins.length, "order line")} ·{" "}
          {plural(skuSummaries.length, "product")}
        </KpiTile>
        <KpiTile
          label="Net after fees"
          value={settledCount > 0 ? money(kpi.netSettled) : "—"}
        >
          settled
          {estimatedCount > 0 && ` · + ${money(kpi.netEstimated)} estimated`}
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
                  {plural(kpi.uncosted, "line")} with no
                  cost left out
                </span>
              )}
            </>
          )}
        </KpiTile>
        <KpiTile
          label="Stock value"
          value={kpi.stockValueAtCost !== null ? money(kpi.stockValueAtCost) : "—"}
        >
          at cost · {kpi.costedSkus} of {kpi.stockedSkus} in-stock SKUs
          {kpi.stockValueAtPrice !== null && (
            <span className="block">{money(kpi.stockValueAtPrice)} at listed price</span>
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
              ["fees", `Marketplace fees (${r.marketplaceFees.length})`],
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
        <InventoryTab
          skus={skus}
          parsedInputs={parsedInputs}
          inventoryBySku={inventoryBySku}
          soldBySku={soldBySku}
          inputs={inputs}
          lotDrafts={lotDrafts}
          expanded={expanded}
          aliasDrafts={aliasDrafts}
          importPreview={importPreview}
          importFileRef={importFileRef}
          setField={setField}
          addLot={addLot}
          updateLot={updateLot}
          removeLot={removeLot}
          toggleExpanded={toggleExpanded}
          updateAliasDraft={updateAliasDraft}
          handleImportFile={handleImportFile}
          applyImport={applyImport}
          cancelImport={cancelImport}
        />
      )}

      {tab === "stock" && <StockTab stock={stockVal} />}

      {tab === "fees" && <FeesTab fees={r.marketplaceFees} />}

      {tab === "sku" && <SkuTab skuSummaries={skuSummaries} />}

      {tab === "price" && <PriceTab priceSeries={priceSeries} />}

      {tab === "orders" && (
        <OrdersTab
          margins={margins}
          settledTotals={settledTotals}
          estimatedTotals={estimatedTotals}
          settledCount={settledCount}
          estimatedCount={estimatedCount}
          noEstimateCount={noEstimateCount}
        />
      )}
        </div>
      </div>
    </div>
  );
}
