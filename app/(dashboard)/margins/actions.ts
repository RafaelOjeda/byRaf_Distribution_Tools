"use server";

import {
  buildSkuHistory,
  estimateUnsettled,
  groupReconRows,
  settlementKey,
  type OrderLineSummary,
} from "@/lib/margin";
import { fetchWalmartToken } from "@/lib/walmart/auth";
import { fetchInventory, type InventoryItem } from "@/lib/walmart/inventory";
import { fetchCatalogPrices, type CatalogItem } from "@/lib/walmart/items";
import { fetchOrdersSince } from "@/lib/walmart/orders";
import {
  fetchAllAvailableRows,
  fetchRowsForDates,
  listAvailableReconFiles,
  type ReconRow,
} from "@/lib/walmart/recon";

// Settlement runs ~2-3 weeks behind, so 60 days comfortably covers every
// order that could still be unsettled.
const UNSETTLED_LOOKBACK_DAYS = 60;

type Result<T> = T | { error: string };

async function withToken<T>(
  clientId: string,
  clientSecret: string,
  fn: (token: string) => Promise<T>
): Promise<Result<T>> {
  if (!clientId.trim() || !clientSecret.trim()) {
    return { error: "Client ID and Client Secret are both required." };
  }
  try {
    const token = await fetchWalmartToken(clientId.trim(), clientSecret.trim());
    return await fn(token);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error contacting Walmart.",
    };
  }
}

/**
 * Step 1: authenticate and list the settlement periods Walmart has
 * available, without pulling any line-item data yet. Mirrors what
 * you'd see picking a date/report in Seller Center's own Payments page.
 */
export async function listAvailableReports(
  clientId: string,
  clientSecret: string
): Promise<Result<{ reportDates: string[] }>> {
  return withToken(clientId, clientSecret, async (token) => {
    const { availableApReportDates } = await listAvailableReconFiles(token);
    // Newest first - that's what you'd want to look at first.
    return { reportDates: [...availableApReportDates].sort().reverse() };
  });
}

/**
 * Step 2: pull the actual line-item data for whichever periods were
 * selected. Nothing here is written to a database, a file, or a log -
 * the credentials and the fetched rows exist only for this one request.
 */
export async function loadWalmartData(
  clientId: string,
  clientSecret: string,
  reportDates: string[]
): Promise<Result<{ rows: ReconRow[] }>> {
  if (reportDates.length === 0) {
    return { error: "Select at least one settlement report." };
  }
  return withToken(clientId, clientSecret, async (token) => ({
    rows: await fetchRowsForDates(token, reportDates),
  }));
}

/**
 * Current stock per SKU. Includes SKUs that have never sold, which the
 * settlement reports alone would never surface.
 */
export async function loadInventory(
  clientId: string,
  clientSecret: string
): Promise<Result<{ inventory: InventoryItem[] }>> {
  return withToken(clientId, clientSecret, async (token) => ({
    inventory: await fetchInventory(token),
  }));
}

/**
 * Each SKU's currently listed price and publish status. Stocked SKUs
 * that have never sold have no sale price, so this is the only source of
 * a "current price" for them.
 */
export async function loadListedPrices(
  clientId: string,
  clientSecret: string
): Promise<Result<{ catalog: CatalogItem[] }>> {
  return withToken(clientId, clientSecret, async (token) => ({
    catalog: await fetchCatalogPrices(token),
  }));
}

/**
 * Orders Walmart hasn't settled yet, with commission and shipping
 * estimated from each SKU's settled history. Reads every available
 * report (not just the selected ones) so "settled" and the history mean
 * the same thing no matter which reports are being viewed. Only derived
 * line summaries leave the server - raw orders carry customer PII.
 */
export async function loadUnsettledOrders(
  clientId: string,
  clientSecret: string
): Promise<
  Result<{
    lines: OrderLineSummary[];
    /** settlementKey(po, sku) -> order date, for EVERY order in the window. */
    orderDates: Record<string, string>;
  }>
> {
  return withToken(clientId, clientSecret, async (token) => {
    const since = new Date(Date.now() - UNSETTLED_LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [settledRows, orders] = await Promise.all([
      fetchAllAvailableRows(token),
      fetchOrdersSince(token, since),
    ]);

    const settled = groupReconRows(settledRows);
    const settledKeys = new Set(
      settled.map((l) => settlementKey(l.purchaseOrderNo, l.sku))
    );

    // Settled lines only carry a posting date (about 2 days after the
    // sale). The orders fetched above include settled ones, so hand back
    // their true order dates too. PO, SKU and a date - no customer data.
    const orderDates: Record<string, string> = {};
    for (const order of orders) {
      const date = new Date(order.orderDate).toISOString().slice(0, 10);
      for (const line of order.orderLines?.orderLine ?? []) {
        orderDates[settlementKey(order.purchaseOrderId, line.item?.sku ?? "")] =
          date;
      }
    }

    return {
      lines: estimateUnsettled(orders, settledKeys, buildSkuHistory(settled)),
      orderDates,
    };
  });
}
