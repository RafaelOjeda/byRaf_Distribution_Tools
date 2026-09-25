import type { Report } from "@/lib/middleware";
import { money } from "../utils/format";

export function MarketplaceFeesTable({ fees }: { fees: Report["marketplaceFees"] }) {
  if (fees.length === 0) {
    return (
      <p className="text-sm text-sc-ink-2">
        No account-level charges for the selected periods.
      </p>
    );
  }
  const total = fees.reduce((n, f) => n + f.amount, 0);
  return (
    <div className="overflow-x-auto">
      <table className="sc-table w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-sc-line text-left">
            <th className="pr-3">Source</th>
            <th className="pr-3">Period</th>
            <th className="pr-3">Kind</th>
            <th className="pr-3">Description</th>
            <th className="pr-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {fees.map((f, i) => (
            <tr key={i} className="border-b border-sc-row">
              <td className="pr-3">{f.source}</td>
              <td className="pr-3">{f.periodId}</td>
              <td className="pr-3 capitalize">{f.kind}</td>
              <td className="pr-3">{f.description}</td>
              <td className="pr-3 text-right text-red-600">{money(f.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-sc-line font-medium">
            <td className="py-2 pr-3" colSpan={4}>
              Total
            </td>
            <td className="py-2 pr-3 text-right">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
