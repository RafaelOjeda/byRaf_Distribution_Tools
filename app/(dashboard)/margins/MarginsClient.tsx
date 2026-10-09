"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, Table, useStyles } from "@/components/ui";
import type { SkuSummary } from "@/lib/gateway";
import { useDashboardData } from "../dashboard/DashboardDataProvider";
import { KpiTile } from "../dashboard/components/shared/KpiTile";
import { money } from "../dashboard/utils/format";

type RowFilter = "all" | "losing" | "nocost";

/** Margin ranges for the distribution chart, as fractions of revenue. */
const BUCKETS: { label: string; test: (m: number) => boolean; bar: string }[] = [
  { label: "< 0%", test: (m) => m < 0, bar: "bg-red-600" },
  { label: "0–10%", test: (m) => m >= 0 && m < 0.1, bar: "bg-red-300" },
  { label: "10–25%", test: (m) => m >= 0.1 && m < 0.25, bar: "bg-green-300" },
  { label: "25–40%", test: (m) => m >= 0.25 && m < 0.4, bar: "bg-green-600" },
  { label: "40%+", test: (m) => m >= 0.4, bar: "bg-green-800" },
];

const pct = (m: number) => `${(m * 100).toFixed(1)}%`;

/** A SKU whose profit is knowable: it has money figures and every line has a cost. */
const costed = (s: SkuSummary) => s.hasMoney && !s.missingCost;

export default function MarginsClient() {
  const { liveReport: r, sourceFilter, setSourceFilter } = useDashboardData();
  const { kpi: kpiStyle } = useStyles();
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");

  const summaries = useMemo(() => r?.bySku ?? [], [r]);
  const rows = useMemo(() => {
    const filtered = summaries.filter((s) =>
      rowFilter === "losing"
        ? costed(s) && s.totals.profit < 0
        : rowFilter === "nocost"
          ? s.hasMoney && s.missingCost
          : true
    );
    return [...filtered].sort((a, b) => b.totals.revenue - a.totals.revenue);
  }, [summaries, rowFilter]);

  if (!r) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] leading-9 font-normal">Margins</h1>
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-sc-ink-2">
            No data loaded yet. Connect a source on the dashboard first, then
            come back here to see where each sale&apos;s money goes.
          </p>
          <Link href="/dashboard" className="underline underline-offset-2">
            Go to the dashboard
          </Link>
        </Card>
      </div>
    );
  }

  const okSources = r.sources.filter((s) => s.status === "ok");
  const settled = r.settledTotals;
  const settledKnown = r.settledCount > 0 && r.settledUncosted === 0 && settled.revenue !== 0;
  const settledUnits = r.orderLines
    .filter((l) => l.status === "settled" && !l.noEstimate)
    .reduce((n, l) => n + l.qty, 0);

  const margins = summaries.filter(costed).filter((s) => s.margin !== null);
  const best = margins.reduce<SkuSummary | null>(
    (top, s) => (top === null || (s.margin ?? 0) > (top.margin ?? 0) ? s : top),
    null
  );
  const losing = summaries.filter((s) => costed(s) && s.totals.profit < 0).length;
  const noCost = summaries.filter((s) => s.hasMoney && s.missingCost).length;
  const bucketCounts = BUCKETS.map((b) => margins.filter((s) => b.test(s.margin ?? 0)).length);
  const maxBucket = Math.max(1, ...bucketCounts);

  // Per $100 of settled revenue. Fees are stored negative (money out).
  const per100 = (n: number) => (settled.revenue === 0 ? 0 : (n / settled.revenue) * 100);
  const waterfall: { label: string; value: number; bar: string }[] = [
    { label: "Revenue", value: 100, bar: "bg-sc-ink" },
    { label: "Marketplace fees", value: per100(settled.commission), bar: "bg-blue-700" },
    { label: "Shipping", value: per100(settled.shipping), bar: "bg-blue-400" },
    { label: "Tax and other", value: per100(settled.tax + settled.otherFees), bar: "bg-sc-ink-2" },
    ...(r.settledUncosted === 0
      ? [
          { label: "Purchase cost", value: per100(-settled.costTotal), bar: "bg-orange-600" },
          { label: "Profit", value: per100(settled.profit), bar: "bg-green-700" },
        ]
      : []),
  ];

  const filters: [RowFilter, string][] = [
    ["all", `All ${summaries.length}`],
    ["losing", `Losing money ${losing}`],
    ["nocost", `No cost entered ${noCost}`],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-normal">Margins</h1>
          <p className="mt-1 text-sm text-sc-ink-2">
            Where each sale&apos;s money goes, by product
          </p>
        </div>
        {okSources.length > 1 && (
          <div className="flex flex-wrap gap-2" aria-label="Filter by source">
            <Button
              onClick={() => setSourceFilter("all")}
              variant={sourceFilter === "all" ? "primary" : "default"}
              aria-pressed={sourceFilter === "all"}
            >
              All
            </Button>
            {okSources.map((s) => {
              const on = sourceFilter !== "all" && sourceFilter.includes(s.id);
              return (
                <Button
                  key={s.id}
                  onClick={() => setSourceFilter([s.id])}
                  variant={on ? "primary" : "default"}
                  aria-pressed={on}
                >
                  {s.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className={kpiStyle.grid} aria-label="Summary">
        <KpiTile label="Average margin" value={settledKnown ? pct(settled.profit / settled.revenue) : "—"}>
          {settledKnown
            ? "on settled lines"
            : r.settledUncosted > 0
              ? `${r.settledUncosted} settled line${r.settledUncosted === 1 ? "" : "s"} with no cost`
              : "no settled lines yet"}
        </KpiTile>
        <KpiTile
          label="Profit per unit"
          value={settledKnown && settledUnits > 0 ? money(settled.profit / settledUnits) : "—"}
        >
          after fees, shipping and cost
        </KpiTile>
        <KpiTile label="Best product" value={best ? pct(best.margin ?? 0) : "—"}>
          {best ? best.itemName || best.sku : "enter purchase costs to rank products"}
        </KpiTile>
        <KpiTile label="Losing money" value={`${losing} product${losing === 1 ? "" : "s"}`}>
          margin below 0%
        </KpiTile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <h2 className="text-lg font-bold">Where each $100 of settled revenue goes</h2>
          {r.settledCount === 0 ? (
            <p className="text-sm text-sc-ink-2">No settled lines yet, so there is nothing exact to split.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {waterfall.map((w) => (
                <li key={w.label} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                  <span className="text-sc-ink-2">{w.label}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-sc-head" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${w.bar}`}
                      style={{ width: `${Math.min(100, Math.max(1, Math.abs(w.value)))}%` }}
                    />
                  </span>
                  <span className="text-right font-bold">{money(w.value)}</span>
                </li>
              ))}
            </ul>
          )}
          {r.settledUncosted > 0 && (
            <p className="text-xs text-amber-600">
              {r.settledUncosted} settled line{r.settledUncosted === 1 ? " has" : "s have"} no
              cost entered, so cost and profit are left out until they do.
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <h2 className="text-lg font-bold">Products by margin</h2>
          {margins.length === 0 ? (
            <p className="text-sm text-sc-ink-2">Enter purchase costs to see how your products spread out.</p>
          ) : (
            <div role="img" aria-label={`Products by margin: ${BUCKETS.map((b, i) => `${b.label} ${bucketCounts[i]}`).join(", ")}`}>
              <div className="flex h-44 items-end gap-3">
                {BUCKETS.map((b, i) => (
                  <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-xs font-bold">{bucketCounts[i]}</span>
                    <span
                      className={`w-full rounded-t-lg ${b.bar}`}
                      style={{ height: `${(bucketCounts[i] / maxBucket) * 80}%`, minHeight: bucketCounts[i] ? 4 : 0 }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-3 text-center text-xs text-sc-ink-2">
                {BUCKETS.map((b) => (
                  <span key={b.label} className="flex-1">{b.label}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Margin by product</h2>
          <div className="flex flex-wrap gap-2" aria-label="Filter products">
            {filters.map(([id, label]) => (
              <Button
                key={id}
                onClick={() => setRowFilter(id)}
                variant={rowFilter === id ? "primary" : "default"}
                aria-pressed={rowFilter === id}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-sc-ink-2">No products match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-sc-line text-left">
                  <th>Product</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Profit</th>
                  <th className="w-48 pl-6">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const unknown = s.hasMoney && s.missingCost;
                  const m = s.margin;
                  return (
                    <tr key={s.sku} className="border-b border-sc-row">
                      <td>
                        <div className="font-bold">{s.itemName || s.sku}</div>
                        <div className="text-xs text-sc-ink-2">
                          {s.itemName ? `${s.sku} · ` : ""}
                          {s.bySource.map((b) => b.sourceLabel).join(", ")}
                        </div>
                      </td>
                      <td className="text-right">{s.units}</td>
                      <td className="text-right">{s.hasMoney ? money(s.totals.revenue) : "—"}</td>
                      <td className="text-right font-bold">
                        {!s.hasMoney ? (
                          "—"
                        ) : unknown ? (
                          <span className="text-amber-600">no cost</span>
                        ) : (
                          <span className={s.totals.profit < 0 ? "text-red-600" : undefined}>
                            {money(s.totals.profit)}
                          </span>
                        )}
                      </td>
                      <td className="pl-6">
                        {!s.hasMoney || unknown || m === null ? (
                          <span className="text-xs text-sc-ink-2">
                            {unknown ? "Add a cost to see margin" : "—"}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sc-head" aria-hidden="true">
                              <span
                                className={`block h-full ${m < 0 ? "bg-red-600" : "bg-green-700"}`}
                                style={{ width: `${Math.min(100, Math.max(2, Math.abs(m) * 100))}%` }}
                              />
                            </span>
                            <span className={`w-14 text-right font-bold ${m < 0 ? "text-red-600" : ""}`}>
                              {pct(m)}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
