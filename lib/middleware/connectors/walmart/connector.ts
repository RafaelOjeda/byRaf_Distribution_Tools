import "server-only";
import type { SourceDescriptor } from "../../contract";
import { buildSkuHistory, settlementKey } from "../../engine/margins";
import { MarketplaceConnector, type AccountCharge } from "../base";
import { fetchWalmartToken } from "./auth";
import { fetchInventory } from "./inventory";
import { fetchCatalogPrices } from "./items";
import { fetchOrdersSince } from "./orders";
import {
  estimateUnsettled,
  groupReconRows,
} from "./normalize";
import {
  fetchAllAvailableRows,
  fetchRowsForDates,
  listAvailableReconFiles,
} from "./recon";

/** Walmart sends settlement period dates as MMDDYYYY. */
function formatReportDate(d: string): string {
  const m = d.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return d;
  const [, mm, dd, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export class WalmartConnector extends MarketplaceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "walmart",
    label: "Walmart",
    credentialFields: [
      { key: "clientId", label: "Client ID", secret: false },
      { key: "clientSecret", label: "Client Secret", secret: true },
    ],
    capabilities: {
      settlements: true,
      recentOrders: true,
      stock: true,
      listings: true,
    },
  };

  protected async authenticate(creds: Record<string, string>): Promise<string> {
    const clientId = creds.clientId?.trim();
    const clientSecret = creds.clientSecret?.trim();
    if (!clientId || !clientSecret) {
      throw new Error("Client ID and Client Secret are both required.");
    }
    return fetchWalmartToken(clientId, clientSecret);
  }

  async listPeriods(session: unknown) {
    const token = session as string;
    const { availableApReportDates } = await listAvailableReconFiles(token);
    // Newest first - that's what you'd want to look at first.
    return [...availableApReportDates]
      .sort()
      .reverse()
      .map((date) => ({ id: date, label: formatReportDate(date) }));
  }

  async fetchSettled(session: unknown, periodIds: string[]) {
    const token = session as string;
    const rows = await fetchRowsForDates(token, periodIds);
    // WFS storage fees and other account-level rows have no Purchase
    // Order # and are dropped by groupReconRows - see AccountCharge's
    // doc comment in base.ts for the known gap this leaves.
    const charges: AccountCharge[] = [];
    return { lines: groupReconRows(rows), charges };
  }

  async fetchRecentOrders(session: unknown, sinceIsoDate: string) {
    const token = session as string;
    // Reads every available settlement period (not just the ones fetched
    // by fetchSettled) so "settled" and the fee-estimate history mean the
    // same thing no matter which periods are selected for viewing.
    const [settledRows, orders] = await Promise.all([
      fetchAllAvailableRows(token),
      fetchOrdersSince(token, sinceIsoDate),
    ]);

    const settled = groupReconRows(settledRows);
    const settledKeys = new Set(
      settled.map((l) => settlementKey(l.purchaseOrderNo, l.sku))
    );
    const history = buildSkuHistory(settled);

    const orderDates: Record<string, string> = {};
    for (const order of orders) {
      const date = new Date(order.orderDate).toISOString().slice(0, 10);
      for (const line of order.orderLines?.orderLine ?? []) {
        orderDates[settlementKey(order.purchaseOrderId, line.item?.sku ?? "")] =
          date;
      }
    }

    return {
      lines: estimateUnsettled(orders, settledKeys, history),
      orderDates,
    };
  }

  async fetchStock(session: unknown) {
    const token = session as string;
    const items = await fetchInventory(token);
    return items.map((i) => ({
      sku: i.sku,
      onHand: i.onHand,
      availToSell: i.availToSell,
      reserved: i.reserved,
    }));
  }

  async fetchListings(session: unknown) {
    const token = session as string;
    const items = await fetchCatalogPrices(token);
    return items.map((i) => ({
      sku: i.sku,
      price: i.price,
      publishedStatus: i.publishedStatus,
    }));
  }
}
