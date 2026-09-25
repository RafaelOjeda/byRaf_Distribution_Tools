import "server-only";
import type { SourceDescriptor } from "../../contract";
import { buildSkuHistory, settlementKey } from "../../engine/margins";
import { MarketplaceConnector } from "../base";
import { fetchAmazonAccessToken } from "./auth";
import { fetchFinancialEventGroups, fetchFinancialEventsForGroup } from "./finances";
import { fetchFbaInventory } from "./inventory";
import { fetchListings as fetchListingsForSkus } from "./listings";
import { estimateUnsettledAmazon, linesFromFinancialEvents } from "./normalize";
import { fetchOrderItems, fetchOrdersSince } from "./orders";
import type { OrderItem } from "./orders";

interface Session {
  accessToken: string;
  sellerId: string;
}

/** Settlement periods aren't listed further back than this by default - mirrors Walmart's UNSETTLED_LOOKBACK_DAYS reasoning, unverified against a real account. */
const PERIOD_LOOKBACK_DAYS = 120;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * UNVERIFIED against a live Amazon Selling Partner API account - see
 * docs/amazon-connector-plan.md and docs/amazon-api-notes.md. Built from
 * public SP-API documentation with the engine's usual safety nets
 * (catch-all fee bucket, never a silently dropped dollar), not from
 * live experimentation the way the Walmart connector was. Run
 * `npm run test:amazon` against real credentials before trusting any
 * number this produces.
 */
export class AmazonConnector extends MarketplaceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "amazon",
    label: "Amazon",
    credentialFields: [
      { key: "lwaClientId", label: "LWA Client ID", secret: false },
      { key: "lwaClientSecret", label: "LWA Client Secret", secret: true },
      {
        key: "refreshToken",
        label: "Refresh Token",
        secret: true,
        help: "From your self-authorized SP-API app (Seller Central > Apps & Services > Develop apps).",
      },
      {
        key: "sellerId",
        label: "Seller ID (Merchant Token)",
        secret: false,
        help: "Seller Central > Settings > Account Info > Business Information.",
      },
    ],
    capabilities: {
      settlements: true,
      recentOrders: true,
      stock: true,
      listings: true,
    },
  };

  protected async authenticate(creds: Record<string, string>): Promise<Session> {
    const lwaClientId = creds.lwaClientId?.trim();
    const lwaClientSecret = creds.lwaClientSecret?.trim();
    const refreshToken = creds.refreshToken?.trim();
    const sellerId = creds.sellerId?.trim();
    if (!lwaClientId || !lwaClientSecret || !refreshToken || !sellerId) {
      throw new Error(
        "LWA Client ID, LWA Client Secret, Refresh Token and Seller ID are all required."
      );
    }
    const accessToken = await fetchAmazonAccessToken(
      lwaClientId,
      lwaClientSecret,
      refreshToken
    );
    return { accessToken, sellerId };
  }

  async listPeriods(session: unknown) {
    const { accessToken } = session as Session;
    const groups = await fetchFinancialEventGroups(
      accessToken,
      isoDaysAgo(PERIOD_LOOKBACK_DAYS)
    );
    return groups
      .filter((g) => g.FinancialEventGroupId)
      .sort((a, b) => (b.FinancialEventGroupStart ?? "").localeCompare(a.FinancialEventGroupStart ?? ""))
      .map((g) => ({
        id: g.FinancialEventGroupId,
        label: g.FinancialEventGroupStart
          ? new Date(g.FinancialEventGroupStart).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : g.FinancialEventGroupId,
      }));
  }

  async fetchSettled(session: unknown, periodIds: string[]) {
    const { accessToken } = session as Session;
    const results = await Promise.all(
      periodIds.map(async (id) => {
        const events = await fetchFinancialEventsForGroup(accessToken, id);
        return linesFromFinancialEvents(events, id);
      })
    );
    return {
      lines: results.flatMap((r) => r.lines),
      charges: results.flatMap((r) => r.charges),
    };
  }

  async fetchRecentOrders(session: unknown, sinceIsoDate: string) {
    const { accessToken } = session as Session;

    // Every available financial event group (not just the selected
    // periods) so "settled" and the fee-estimate history mean the same
    // thing no matter which periods are being viewed - same reasoning as
    // the Walmart connector's fetchRecentOrders.
    const groups = await fetchFinancialEventGroups(accessToken, isoDaysAgo(PERIOD_LOOKBACK_DAYS));
    const allEvents = await Promise.all(
      groups.map((g) => fetchFinancialEventsForGroup(accessToken, g.FinancialEventGroupId))
    );
    const settled = allEvents.flatMap(
      (events, i) => linesFromFinancialEvents(events, groups[i].FinancialEventGroupId).lines
    );
    const settledKeys = new Set(
      settled.map((l) => settlementKey(l.purchaseOrderNo, l.sku))
    );
    const history = buildSkuHistory(settled);

    const orders = await fetchOrdersSince(accessToken, `${sinceIsoDate}T00:00:00Z`);
    const orderItemsByOrder = new Map<string, OrderItem[]>();
    // Sequential, not Promise.all: order-item lookups are one call per
    // order, and SP-API's per-operation rate limits are unverified - see
    // docs/amazon-connector-plan.md.
    for (const order of orders) {
      orderItemsByOrder.set(
        order.AmazonOrderId,
        await fetchOrderItems(accessToken, order.AmazonOrderId)
      );
    }

    const orderDates: Record<string, string> = {};
    for (const order of orders) {
      const date = order.PurchaseDate.slice(0, 10);
      for (const item of orderItemsByOrder.get(order.AmazonOrderId) ?? []) {
        if (item.SellerSKU) {
          orderDates[settlementKey(order.AmazonOrderId, item.SellerSKU)] = date;
        }
      }
    }

    return {
      lines: estimateUnsettledAmazon(orders, orderItemsByOrder, settledKeys, history),
      orderDates,
    };
  }

  async fetchStock(session: unknown) {
    const { accessToken } = session as Session;
    const summaries = await fetchFbaInventory(accessToken);
    return summaries
      .filter((s) => s.sellerSku)
      .map((s) => ({
        sku: s.sellerSku,
        onHand: s.totalQuantity ?? s.inventoryDetails?.fulfillableQuantity ?? 0,
        availToSell: s.inventoryDetails?.fulfillableQuantity ?? 0,
        reserved: s.inventoryDetails?.reservedQuantity?.totalReservedQuantity ?? 0,
        // FBA stock is a physically separate pool from merchant-fulfilled
        // stock - see docs/amazon-connector-plan.md's stock-pooling gap
        // and lib/middleware/engine/margins.ts stockValue().
        fulfillment: "marketplace" as const,
      }));
  }

  async fetchListings(session: unknown) {
    const { accessToken, sellerId } = session as Session;
    // No single "every SKU's price and status" endpoint exists (see
    // lib/middleware/connectors/amazon/listings.ts) - the FBA inventory
    // SKU list is used as a proxy for "SKUs worth pricing", which misses
    // merchant-fulfilled-only listings with no FBA stock. Confirm live
    // whether that gap matters for a real seller.
    const summaries = await fetchFbaInventory(accessToken);
    const skus = [...new Set(summaries.map((s) => s.sellerSku).filter(Boolean))];
    return fetchListingsForSkus(accessToken, sellerId, skus);
  }
}
