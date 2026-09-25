import type { Report } from "@/lib/middleware";
import { PanelHeader } from "../shared/PanelHeader";
import { MarketplaceFeesTable } from "../MarketplaceFeesTable";

export function FeesTab({ fees }: { fees: Report["marketplaceFees"] }) {
  return (
    <>
      <PanelHeader title="Marketplace fees">
        Charges that belong to no single order line - storage,
        subscriptions, ads, adjustments - so they never appear in the
        order-line or by-SKU totals above.
      </PanelHeader>
      <MarketplaceFeesTable fees={fees} />
    </>
  );
}
