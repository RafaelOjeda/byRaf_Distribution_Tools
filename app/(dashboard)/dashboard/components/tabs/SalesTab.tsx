import { useMemo, useState } from "react";
import { Button, Card, useButtonClass } from "@/components/ui";
import { orderLinesToCsv, skuSummaryToCsv, type Report } from "@/lib/gateway";
import { downloadCsv } from "../../utils/format";
import { PanelHeader } from "../shared/PanelHeader";
import { SkuSummaryTable } from "../SkuSummaryTable";
import { OrderLinesTable } from "../OrderLinesTable";
import { TotalsCard, TotalsRow } from "../TotalsRow";
import PriceChart from "../../PriceChart";

type SalesView = "rollup" | "lines" | "chart";

const VIEWS: [SalesView, string][] = [
  ["rollup", "By product"],
  ["lines", "All lines"],
  ["chart", "Price chart"],
];

const VIEW_KEY = "byraf-sales-view";

/** Remembered per browser; the tab only renders client-side, after data loads. */
function readView(): SalesView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some(([id]) => id === v) ? (v as SalesView) : "rollup";
  } catch {
    return "rollup";
  }
}

/**
 * By product, all order lines and the price chart, as three views of the
 * same report rows: a product's expanded lines are the very MarginRow
 * objects its rollup was summed from and the All lines view lists.
 */
export function SalesTab({ report: r }: { report: Report }) {
  const [view, setViewState] = useState<SalesView>(readView);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const buttonClass = useButtonClass();

  function setView(next: SalesView) {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // private mode: the choice just isn't remembered
    }
  }

  function toggle(sku: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  // Lookup only: each product's lines are already on its record.
  const linesBySku = useMemo(
    () => new Map(r.products.map((p) => [p.sku, p.orderLines])),
    [r.products]
  );
  const preferred = useMemo(() => [...expanded], [expanded]);

  const settledLabel = `Settled · ${r.settledCount} line${r.settledCount === 1 ? "" : "s"}`;
  const estimatedLabel = `Estimated · ${r.estimatedCount} line${r.estimatedCount === 1 ? "" : "s"}`;
  const totalsRows = (variant: "lines" | "rollup") => (
    <>
      {r.settledCount > 0 && (
        <TotalsRow
          label={settledLabel}
          totals={r.settledTotals}
          uncosted={r.settledUncosted}
          variant={variant}
          first
        />
      )}
      {r.estimatedCount > 0 && (
        <TotalsRow
          label={`${estimatedLabel}${r.noEstimateCount > 0 ? ` (+${r.noEstimateCount} with no estimate, excluded)` : ""}`}
          totals={r.estimatedTotals}
          uncosted={r.estimatedUncosted}
          variant={variant}
          first={r.settledCount === 0}
          italic
        />
      )}
    </>
  );
  const totalsCards = (
    <>
      {r.settledCount > 0 && (
        <TotalsCard label={settledLabel} totals={r.settledTotals} uncosted={r.settledUncosted} />
      )}
      {r.estimatedCount > 0 && (
        <TotalsCard
          label={`${estimatedLabel}${r.noEstimateCount > 0 ? ` (+${r.noEstimateCount} not estimable, excluded)` : ""}`}
          totals={r.estimatedTotals}
          uncosted={r.estimatedUncosted}
          italic
        />
      )}
    </>
  );

  return (
    <>
      <PanelHeader
        title="Sales"
        action={
          <div className="flex flex-wrap gap-2">
            <div className="flex flex-wrap gap-2" aria-label="Sales view">
              {VIEWS.map(([id, label]) => (
                <Button
                  key={id}
                  onClick={() => setView(id)}
                  variant={view === id ? "primary" : "default"}
                  aria-pressed={view === id}
                >
                  {label}
                </Button>
              ))}
            </div>
            <details className="relative">
              <summary className={`${buttonClass()} cursor-pointer list-none`}>
                Download CSV ▾
              </summary>
              <Card className="absolute right-0 z-10 mt-1 flex w-64 flex-col p-1">
                {(
                  [
                    [
                      "By product",
                      "One row per product. Estimated lines are included and marked; unknown cells are blank.",
                      () => downloadCsv("by-sku", skuSummaryToCsv(r.bySku)),
                      r.bySku.length === 0,
                    ],
                    [
                      "Order lines",
                      "One row per order line, with a Status column (Settled / Estimated / Not estimable).",
                      () => downloadCsv("order-lines", orderLinesToCsv(r.orderLines)),
                      r.orderLines.length === 0,
                    ],
                  ] as [string, string, () => void, boolean][]
                ).map(([label, hint, download, empty]) => (
                  <button
                    key={label}
                    disabled={empty}
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      download();
                    }}
                    className="flex flex-col items-start px-3 py-2 text-left text-sm hover:bg-sc-head disabled:opacity-50"
                  >
                    <span className="font-bold">{label}</span>
                    <span className="text-xs text-sc-ink-2">{hint}</span>
                  </button>
                ))}
              </Card>
            </details>
          </div>
        }
      >
        {view === "rollup" && (
          <>
            Settled and estimated order lines rolled up per product - open a
            product to see its lines. A product with no settled history yet
            can&apos;t have its fees estimated, so its money columns show —
            rather than a misleading $0.00.
          </>
        )}
        {view === "lines" && (
          <>
            Revenue − commission − shipping − other − your cost = profit. Fee
            columns are shown as the source reports them (negative = money
            out). <span className="italic">Est.</span> rows are orders not
            yet settled: revenue is exact, but commission and shipping are
            projected from that product&apos;s settled history and switch to
            exact figures once the order settles.
          </>
        )}
        {view === "chart" &&
          expanded.size === 0 &&
          "Tip: open products under By product and they're charted first."}
      </PanelHeader>

      {view === "rollup" && (
        <>
          <SkuSummaryTable
            summaries={r.bySku}
            linesBySku={linesBySku}
            expanded={expanded}
            onToggle={toggle}
            footerRows={totalsRows("rollup")}
            footerCards={totalsCards}
          />
          {r.noSkuCount > 0 && (
            <p className="text-sm text-amber-600">
              {r.noSkuCount} order line{r.noSkuCount === 1 ? " has" : "s have"} no
              SKU, so {r.noSkuCount === 1 ? "it isn't" : "they aren't"} under any
              product above but {r.noSkuCount === 1 ? "is" : "are"} in the totals -
              see All lines.
            </p>
          )}
        </>
      )}

      {view === "lines" && (
        <OrderLinesTable
          lines={r.orderLines}
          footerRows={totalsRows("lines")}
          footerCards={totalsCards}
        />
      )}

      {view === "chart" && <PriceChart series={r.priceSeries} prefer={preferred} />}
    </>
  );
}
