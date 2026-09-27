import "server-only";
import type { SourceDescriptor } from "../../contract";
import { MarketplaceConnector } from "../base";
import {
  DEMO_CATALOG,
  DEMO_PERIODS,
  DEMO_STOCK,
  recentOrder,
  settledForPeriods,
} from "./fixtures";

/**
 * Fixture-backed connector with no real network calls. Proves the
 * MarketplaceConnector abstraction against a second implementation - see
 * docs/multi-marketplace-plan.md, "The demo connector is the living
 * test" - and gives the dashboard something to show multi-source
 * behavior against without needing Amazon/eBay credentials.
 */
export class DemoConnector extends MarketplaceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "demo",
    label: "Demo",
    credentialFields: [
      {
        key: "account",
        label: "Demo account name",
        secret: false,
        help: "Any value works - this connector never leaves your browser tab.",
      },
    ],
    capabilities: {
      settlements: true,
      recentOrders: true,
      stock: true,
      listings: true,
    },
  };

  protected async authenticate(creds: Record<string, string>): Promise<string> {
    if (!creds.account?.trim()) {
      throw new Error("Demo account name is required.");
    }
    return creds.account.trim();
  }

  async listPeriods() {
    return DEMO_PERIODS;
  }

  async fetchSettled(_session: unknown, periodIds: string[]) {
    return settledForPeriods(periodIds);
  }

  async fetchRecentOrders() {
    return recentOrder();
  }

  async fetchStock() {
    return DEMO_STOCK;
  }

  async fetchListings() {
    return DEMO_CATALOG;
  }
}
