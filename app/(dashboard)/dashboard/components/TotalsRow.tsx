import type { Report } from "@/lib/middleware";
import { money, pct } from "../utils/format";
import { Fig } from "./shared/Fig";

export function TotalsCard({
  label,
  totals,
  uncosted,
  italic,
}: {
  label: string;
  totals: Report["settledTotals"];
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

export function TotalsRow({
  label,
  totals,
  uncosted,
  first,
  italic,
}: {
  label: string;
  totals: Report["settledTotals"];
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
      <td className="py-2 pr-3" colSpan={6}>
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
            ? pct(totals.profit / totals.revenue)
            : "—"}
      </td>
    </tr>
  );
}
