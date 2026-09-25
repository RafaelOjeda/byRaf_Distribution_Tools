import type { Report } from "@/lib/middleware";
import { PanelHeader } from "../shared/PanelHeader";
import { StockValueTable } from "../StockValueTable";

export function StockTab({ stock }: { stock: Report["stock"] }) {
  return (
    <>
      <PanelHeader title="Stock value">
        What the units you have on hand are worth: at what they cost you
        (your average across the batches entered under Inventory &amp;
        costs) and at the price they&apos;re currently listed for. The
        same physical units are never summed across sources - once any
        purchase batch is entered, &ldquo;On hand&rdquo; is your own
        pool (purchased minus sold); with none entered it falls back to
        the largest count a single source reports, marked (est.).
        Merchant-fulfilled stock only — units held in a
        marketplace&apos;s own warehouses aren&apos;t included yet.
      </PanelHeader>
      <StockValueTable stock={stock} />
    </>
  );
}
