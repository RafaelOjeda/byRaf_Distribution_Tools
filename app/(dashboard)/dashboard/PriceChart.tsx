"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { PriceSeries } from "@/lib/middleware";

/** Most series drawn at once; any others stay reachable in the table view. */
const MAX_SERIES = 6;

// The chart is drawn at its real rendered width (measured below) rather
// than a fixed canvas scaled to fit, so 12px text stays 12px on a phone
// instead of shrinking to ~6px. Below NARROW the right-hand end labels
// are dropped - there is no room, and the legend already shows each
// product's latest price.
const MAX_W = 900;
const NARROW = 560;
// Keeps the first and last points off the axis line and the right edge.
const PAD = 10;

// Categorical slots in fixed order (blue, orange, aqua, yellow, magenta,
// green). A SKU's colour comes from its position among the charted SKUs
// and never changes with the values, so a colour always means one product.
// Validated with the dataviz skill's validate_palette.js against the
// white card surface; aqua/yellow/magenta sit under 3:1 on it, which is
// why the legend, end labels and table view all carry identity as well.
// Light only, like the rest of the app.
const CSS = `
.pc {
  --pc-surface: #ffffff;
  --pc-ink: #0f1111;
  --pc-ink-2: #565959;
  --pc-muted: #898781;
  --pc-grid: #e7e7e7;
  --pc-axis: #c3c2b7;
  --pc-border: #d5d9d9;
  --pc-s1: #2a78d6; --pc-s2: #eb6834; --pc-s3: #1baf7a;
  --pc-s4: #eda100; --pc-s5: #e87ba4; --pc-s6: #008300;
}
.pc-svg:focus-visible { outline: 2px solid var(--pc-ink-2); outline-offset: 2px; border-radius: 6px; }
`;

const color = (i: number) => `var(--pc-s${(i % 6) + 1})`;

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const fmtDate = (d: string, withYear = false) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
const usd = (n: number) => `$${n.toFixed(2)}`;
const usd0 = (n: number) => `$${n.toLocaleString("en-US")}`;
const pctText = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
const short = (s: string, n = 17) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function niceStep(max: number): number {
  for (const s of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 5000]) {
    if (max / s <= 6) return s;
  }
  return 10_000;
}

export default function PriceChart({ series }: { series: PriceSeries[] }) {
  const charted = useMemo(() => series.slice(0, MAX_SERIES), [series]);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null); // index into dates
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(760);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setBoxW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const narrow = boxW < NARROW;
  const W = Math.min(boxW, MAX_W);
  const H = narrow ? 240 : 340;
  const M = { left: 48, right: narrow ? 12 : 132, top: 16, bottom: 30 };
  const PLOT_W = W - M.left - M.right;
  const PLOT_H = H - M.top - M.bottom;

  const dates = useMemo(
    () =>
      [...new Set(charted.flatMap((s) => s.points.map((p) => p.date)))].sort(),
    [charted]
  );
  const canChart = dates.length >= 2;

  const geo = useMemo(() => {
    if (!canChart) return null;
    const dMin = dayNum(dates[0]);
    const dMax = dayNum(dates[dates.length - 1]);
    const maxPrice = Math.max(...charted.flatMap((s) => s.points.map((p) => p.avg)));
    const step = niceStep(maxPrice * 1.05);
    const yMax = Math.ceil((maxPrice * 1.05) / step) * step;
    const x = (d: string) =>
      M.left + PAD + ((dayNum(d) - dMin) / (dMax - dMin)) * (PLOT_W - 2 * PAD);
    const y = (v: number) => M.top + PLOT_H - (v / yMax) * PLOT_H;

    const yTicks: number[] = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);

    const span = dMax - dMin;
    const stepDays =
      [1, 2, 3, 5, 7, 14, 30, 60].find((d) => span / d <= (narrow ? 4 : 6)) ?? 90;
    const xTicks: string[] = [];
    for (let d = dMin; d <= dMax + 1e-9; d += stepDays) {
      xTicks.push(new Date(d * 86_400_000).toISOString().slice(0, 10));
    }
    return { x, y, yTicks, xTicks, yMax, dMin, dMax };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- M/PLOT_* derive from W, H, narrow
  }, [canChart, charted, dates, W, H, narrow]);

  // End labels only for a few series, and only where they end near the
  // right edge - a label parked mid-chart would sit on top of other
  // lines. Colliding labels are dropped rather than nudged apart (that
  // detaches a label from its line); the legend and tooltip carry them.
  const endLabels = useMemo(() => {
    if (!geo || narrow || charted.length > 4) return [];
    const nearRight = (geo.dMax - geo.dMin) * 0.15;
    const cands = charted
      .map((s, i) => ({ s, i, y: geo.y(s.last.avg) }))
      .filter(({ s }) => geo.dMax - dayNum(s.last.date) <= nearRight);
    const kept: typeof cands = [];
    for (const c of cands) {
      if (kept.every((k) => Math.abs(k.y - c.y) >= 14)) kept.push(c);
    }
    return kept;
  }, [geo, charted, narrow]);

  if (series.length === 0) {
    return (
      <p className="text-sm text-sc-ink-2">
        No dated sales with a price yet.
      </p>
    );
  }

  const approx = series.reduce((n, s) => n + s.approxPoints, 0);

  function onPointerMove(e: PointerEvent<SVGRectElement>) {
    if (!geo || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * W) / rect.width;
    let best = 0;
    let bestDist = Infinity;
    dates.forEach((d, i) => {
      const dist = Math.abs(geo.x(d) - sx);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  }

  function onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => {
      const cur = h ?? dates.length - 1;
      return Math.max(0, Math.min(dates.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
    });
  }

  const hoverDate = hover === null ? null : dates[hover];
  const tipRows =
    hoverDate === null
      ? []
      : charted.flatMap((s, i) => {
          const p = s.points.find((pt) => pt.date === hoverDate);
          return p ? [{ s, i, p }] : [];
        });

  return (
    <div className="pc" style={{ color: "var(--pc-ink)" }}>
      <style>{CSS}</style>

      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Average selling price per unit, by order date</div>
          <div className="text-xs" style={{ color: "var(--pc-ink-2)" }}>
            One point per day with sales; lines join consecutive sale days.
            {series.length > MAX_SERIES &&
              ` Showing the top ${MAX_SERIES} of ${series.length} products by units sold — all are in the table.`}
          </div>
        </div>
        <button
          onClick={() => setTable((t) => !t)}
          className="sc-link shrink-0 text-sm"
        >
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>

      {/* Legend: always present for 2+ series, with each product's move. */}
      <ul className="mb-3 flex flex-col gap-1">
        {charted.map((s, i) => (
          <li key={s.sku} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
            <svg width="22" height="10" aria-hidden="true" className="shrink-0">
              <line x1="0" y1="5" x2="22" y2="5" stroke={color(i)} strokeWidth="2" strokeLinecap="round" />
              <circle cx="11" cy="5" r="3" fill={color(i)} />
            </svg>
            <span style={{ color: "var(--pc-ink)" }}>{s.sku}</span>
            <span className="text-xs" style={{ color: "var(--pc-ink-2)" }}>
              {s.points.length > 1
                ? `${usd(s.first.avg)} → ${usd(s.last.avg)} (${pctText(s.changePct ?? 0)})`
                : `${usd(s.last.avg)} · 1 sale day`}
              {" · "}
              {s.units} unit{s.units === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>

      {!table && canChart && geo && (
        // The SVG scales with its box; capping the width keeps axis and
        // label text near its designed size on wide screens.
        <div ref={boxRef} className="relative max-w-[900px]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="pc-svg block w-full"
            role="group"
            tabIndex={0}
            aria-label="Line chart of average unit selling price by order date. Use the left and right arrow keys to move between sale dates, or switch to the table view."
            onKeyDown={onKeyDown}
            onFocus={() => setHover((h) => h ?? dates.length - 1)}
            onBlur={() => setHover(null)}
            // Touch fires pointerleave the moment a finger lifts, which
            // would erase the tooltip right after a tap. Only a mouse
            // leaving clears it; a tap keeps it until focus moves away.
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setHover(null);
            }}
          >
            {/* Grid + y axis */}
            {geo.yTicks.map((v) => (
              <g key={v}>
                <line
                  x1={M.left} x2={M.left + PLOT_W} y1={geo.y(v)} y2={geo.y(v)}
                  stroke={v === 0 ? "var(--pc-axis)" : "var(--pc-grid)"} strokeWidth="1"
                />
                <text x={M.left - 8} y={geo.y(v)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="var(--pc-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {usd0(v)}
                </text>
              </g>
            ))}
            {/* x axis */}
            {geo.xTicks.map((d) => (
              <text key={d} x={geo.x(d)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--pc-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(d)}
              </text>
            ))}

            {/* Crosshair */}
            {hoverDate !== null && (
              <line x1={geo.x(hoverDate)} x2={geo.x(hoverDate)} y1={M.top} y2={M.top + PLOT_H} stroke="var(--pc-axis)" strokeWidth="1" />
            )}

            {/* Lines */}
            {charted.map((s, i) => (
              <path
                key={s.sku}
                d={s.points.map((p, k) => `${k === 0 ? "M" : "L"}${geo.x(p.date).toFixed(1)},${geo.y(p.avg).toFixed(1)}`).join(" ")}
                fill="none" stroke={color(i)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              />
            ))}

            {/* Markers: 2px surface ring, then the dot */}
            {charted.map((s, i) =>
              s.points.map((p) => {
                const on = p.date === hoverDate;
                return (
                  <g key={`${s.sku}-${p.date}`}>
                    <circle cx={geo.x(p.date)} cy={geo.y(p.avg)} r={(on ? 5 : 4) + 2} fill="var(--pc-surface)" />
                    <circle cx={geo.x(p.date)} cy={geo.y(p.avg)} r={on ? 5 : 4} fill={color(i)} />
                  </g>
                );
              })
            )}

            {/* End labels (sparing; see endLabels) */}
            {endLabels.map(({ s, y }) => {
              // Fit the SKU into the room left before the frame edge
              // instead of letting it run off and get clipped; when
              // there's no room, the price alone is shown.
              const x0 = geo.x(s.last.date) + 12;
              const room = W - 4 - x0 - (usd(s.last.avg).length * 7.2 + 6);
              const chars = Math.floor(room / 6.6);
              return (
                <text key={s.sku} x={x0} y={y} dominantBaseline="middle" fontSize="12" fill="var(--pc-ink-2)">
                  <tspan fontWeight="600" fill="var(--pc-ink)">{usd(s.last.avg)}</tspan>
                  {chars >= 6 && <tspan dx="5">{short(s.sku, chars)}</tspan>}
                  <title>{`${s.sku}: latest ${usd(s.last.avg)}`}</title>
                </text>
              );
            })}

            {/* Hit layer: the whole plot, so aiming at a date is easy */}
            <rect
              x={M.left} y={M.top} width={PLOT_W} height={PLOT_H}
              fill="transparent" onPointerMove={onPointerMove} onPointerDown={onPointerMove}
            />
          </svg>

          {hoverDate !== null && (
            <div
              role="status"
              aria-live="polite"
              className={`pointer-events-none absolute top-2 z-10 rounded-md border px-3 py-2 text-xs shadow-sm ${narrow ? "" : "w-max max-w-[22rem]"}`}
              style={{
                background: "var(--pc-surface)",
                borderColor: "var(--pc-border)",
                // On a phone the tooltip spans the chart instead of
                // floating beside the crosshair, where it would run off-screen.
                ...(narrow
                  ? { left: 0, right: 0 }
                  : {
                      left: `${(geo.x(hoverDate) / W) * 100}%`,
                      transform:
                        geo.x(hoverDate) > W * 0.55
                          ? "translateX(calc(-100% - 12px))"
                          : "translateX(12px)",
                    }),
              }}
            >
              <div className="mb-1 font-medium">{fmtDate(hoverDate, true)}</div>
              {tipRows.length === 0 && <div style={{ color: "var(--pc-ink-2)" }}>No sales</div>}
              {tipRows.map(({ s, i, p }) => (
                <div key={s.sku} className="py-1">
                  {/* Value first, then the product; detail on its own line
                      so nothing wraps mid-name. */}
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <svg width="14" height="8" aria-hidden="true" className="shrink-0">
                      <line x1="0" y1="4" x2="14" y2="4" stroke={color(i)} strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm font-semibold">{usd(p.avg)}</span>
                    <span style={{ color: "var(--pc-ink-2)" }}>{short(s.sku, 26)}</span>
                  </div>
                  <div className="whitespace-nowrap pl-[22px]" style={{ color: "var(--pc-muted)" }}>
                    {p.orders} order{p.orders === 1 ? "" : "s"}
                    {p.min !== p.max ? ` · ${usd(p.min)}–${usd(p.max)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!table && !canChart && (
        <p className="text-sm" style={{ color: "var(--pc-ink-2)" }}>
          There are sales on only one date so far, which isn&apos;t enough to draw a trend. The table shows them.
        </p>
      )}

      {(table || !canChart) && (
        <div className="overflow-x-auto">
          <table className="sc-table w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--pc-border)" }}>
                <th className="pr-3">SKU</th>
                <th className="pr-3">Date</th>
                <th className="pr-3 text-right">Avg price</th>
                <th className="pr-3 text-right">Lowest</th>
                <th className="pr-3 text-right">Highest</th>
                <th className="pr-3 text-right">Orders</th>
                <th className="pr-3 text-right">Units</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
              {series.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={`${s.sku}-${p.date}`} className="border-b" style={{ borderColor: "var(--pc-border)" }}>
                    <td className="pr-3">{s.sku}</td>
                    <td className="pr-3">{fmtDate(p.date, true)}</td>
                    <td className="pr-3 text-right font-medium">{usd(p.avg)}</td>
                    <td className="pr-3 text-right">{usd(p.min)}</td>
                    <td className="pr-3 text-right">{usd(p.max)}</td>
                    <td className="pr-3 text-right">{p.orders}</td>
                    <td className="pr-3 text-right">{p.units}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {approx > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--pc-ink-2)" }}>
          {approx} point{approx === 1 ? " is" : "s are"} placed on the settlement
          posting date (about two days after the sale) because the
          source&apos;s recent-orders list only goes back 60 days.
        </p>
      )}
    </div>
  );
}
