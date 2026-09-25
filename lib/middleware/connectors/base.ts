import "server-only";
import type { AccountCharge, SourceDescriptor, StockItem } from "../contract";
import type { OrderLineSummary } from "../engine/types";
import { paginate } from "./pagination";

export type { AccountCharge };

export interface SourceSnapshot {
  sourceId: string;
  lines: OrderLineSummary[];
  charges: AccountCharge[];
  /** settlementKey(orderId, sku) -> ISO order date, for the full order-list window. */
  orderDates: Record<string, string>;
  inventory: StockItem[];
  catalog: { sku: string; price: number | null; publishedStatus: string }[];
  /** Set when a part of this source's fetch failed; the parts that succeeded still populate the fields above. */
  errors: string[];
}

/**
 * One marketplace. Every connector is a subclass of this, so the
 * plumbing that used to be duplicated per-API-module - pagination,
 * "throw rather than return partial data", error messages that never
 * echo a secret - lives here once instead.
 */
export abstract class MarketplaceConnector {
  abstract readonly descriptor: SourceDescriptor;

  /** Token exchange / session setup. Per request, never cached across requests. */
  protected abstract authenticate(creds: Record<string, string>): Promise<unknown>;

  abstract listPeriods(
    session: unknown
  ): Promise<{ id: string; label: string }[]>;

  abstract fetchSettled(
    session: unknown,
    periodIds: string[]
  ): Promise<{ lines: OrderLineSummary[]; charges: AccountCharge[] }>;

  /** Normalized recent/unsettled orders, with any needed fee estimation already applied. */
  abstract fetchRecentOrders(
    session: unknown,
    sinceIsoDate: string
  ): Promise<{ lines: OrderLineSummary[]; orderDates: Record<string, string> }>;

  fetchStock(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden by connectors that support stock
    session: unknown
  ): Promise<{ sku: string; onHand: number; availToSell: number; reserved: number }[]> {
    return this.unsupported("stock");
  }

  fetchListings(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden by connectors that support listings
    session: unknown
  ): Promise<{ sku: string; price: number | null; publishedStatus: string }[]> {
    return this.unsupported("listings");
  }

  /** Authenticates from raw pasted credentials, then lists this source's settlement periods. */
  async listPeriodsFor(
    creds: Record<string, string>
  ): Promise<{ id: string; label: string }[]> {
    const session = await this.authenticate(creds);
    return this.listPeriods(session);
  }

  /**
   * Orchestration shared by every marketplace: authenticate once, fetch
   * every part in parallel, and collect per-part errors instead of
   * failing the whole source when e.g. the catalog call 404s but
   * everything else works.
   */
  async snapshot(
    creds: Record<string, string>,
    periodIds: string[],
    recentSinceIsoDate: string
  ): Promise<SourceSnapshot> {
    const errors: string[] = [];
    const session = await this.authenticate(creds);

    const [settled, recent, inventory, catalog] = await Promise.all([
      this.fetchSettled(session, periodIds).catch((e) => {
        errors.push(this.describeError("settlement data", e));
        return { lines: [], charges: [] };
      }),
      this.descriptor.capabilities.recentOrders
        ? this.fetchRecentOrders(session, recentSinceIsoDate).catch((e) => {
            errors.push(this.describeError("recent orders", e));
            return { lines: [], orderDates: {} };
          })
        : Promise.resolve({ lines: [], orderDates: {} }),
      this.descriptor.capabilities.stock
        ? this.fetchStock(session).catch((e) => {
            errors.push(this.describeError("inventory", e));
            return [];
          })
        : Promise.resolve([]),
      this.descriptor.capabilities.listings
        ? this.fetchListings(session).catch((e) => {
            errors.push(this.describeError("catalog", e));
            return [];
          })
        : Promise.resolve([]),
    ]);

    const tag = (l: OrderLineSummary): OrderLineSummary => ({
      ...l,
      source: this.descriptor.id,
      sourceLabel: this.descriptor.label,
    });

    return {
      sourceId: this.descriptor.id,
      lines: [...settled.lines.map(tag), ...recent.lines.map(tag)],
      charges: settled.charges,
      orderDates: recent.orderDates,
      inventory: inventory.map((i) => ({
        ...i,
        source: this.descriptor.id,
        sourceLabel: this.descriptor.label,
      })),
      catalog,
      errors,
    };
  }

  /** Never includes a secret - creds never reach this far down the stack anyway. */
  private describeError(part: string, e: unknown): string {
    const message = e instanceof Error ? e.message : "unknown error";
    return `${this.descriptor.label}: couldn't load ${part} - ${message}`;
  }

  private unsupported(capability: string): never {
    throw new Error(
      `${this.descriptor.label} connector does not support ${capability}`
    );
  }

  /** See `paginate` in ./pagination - kept as a method so a connector can call it as `this.paginate(...)`. */
  protected paginate<T>(
    fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
    maxPages: number,
    label?: string
  ): Promise<T[]> {
    return paginate(fetchPage, maxPages, label);
  }
}
