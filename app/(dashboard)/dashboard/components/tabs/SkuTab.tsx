import { skuSummaryToCsv, type SkuSummary } from "@/lib/middleware";
import { downloadCsv } from "../../utils/format";
import { PanelHeader } from "../shared/PanelHeader";
import { SkuSummaryTable } from "../SkuSummaryTable";

export function SkuTab({ skuSummaries }: { skuSummaries: SkuSummary[] }) {
  return (
    <>
      <PanelHeader
        title="By SKU"
        action={
          <button
            onClick={() => downloadCsv("by-sku", skuSummaryToCsv(skuSummaries))}
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
  );
}
