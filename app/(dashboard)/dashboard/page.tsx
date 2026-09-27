import { describeSources } from "@/lib/gateway/actions";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const sources = await describeSources();
  return <DashboardClient sources={sources} />;
}
