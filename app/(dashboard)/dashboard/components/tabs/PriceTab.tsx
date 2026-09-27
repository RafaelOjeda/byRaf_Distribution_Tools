import type { PriceSeries } from "@/lib/gateway";
import { PanelHeader } from "../shared/PanelHeader";
import PriceChart from "../../PriceChart";

export function PriceTab({ priceSeries }: { priceSeries: PriceSeries[] }) {
  return (
    <>
      <PanelHeader title="Price over time" />
      <PriceChart series={priceSeries} />
    </>
  );
}
