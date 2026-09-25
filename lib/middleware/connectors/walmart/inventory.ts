import { walmartHeaders } from "./auth";
import { paginate } from "../pagination";

export interface InventoryItem {
  sku: string;
  /**
   * availToSell + reserved: what Walmart says is still in your hands
   * (buyable now, plus ordered but not yet shipped). Deliberately NOT
   * inputQty - see fedQty.
   */
  onHand: number;
  availToSell: number;
  reserved: number;
  /**
   * inputQty: the quantity you last told Walmart you have. Not a count.
   * It doesn't drop when units ship, so it goes stale: the Barbie read 1
   * here while availToSell was 0 and the catalog said out of stock.
   */
  fedQty: number;
}

interface InventoriesResponse {
  meta?: { totalCount?: number; nextCursor?: string | null };
  elements?: {
    inventories?: {
      sku: string;
      nodes?: {
        inputQty?: { amount?: number };
        availToSellQty?: { amount?: number };
        reservedQty?: { amount?: number };
      }[];
    }[];
  };
}

const BASE = "https://marketplace.walmartapis.com/v3/inventories";

// The API rejects anything above 50 ("limit should be between 1 and 50").
const PAGE_SIZE = 50;
const MAX_PAGES = 40;

function toItems(data: InventoriesResponse): InventoryItem[] {
  return (data.elements?.inventories ?? []).map((inv) => {
    const nodes = inv.nodes ?? [];
    const sum = (pick: (n: (typeof nodes)[number]) => number | undefined) =>
      nodes.reduce((total, n) => total + (pick(n) ?? 0), 0);

    const availToSell = sum((n) => n.availToSellQty?.amount);
    const reserved = sum((n) => n.reservedQty?.amount);

    return {
      sku: inv.sku,
      onHand: availToSell + reserved,
      availToSell,
      reserved,
      fedQty: sum((n) => n.inputQty?.amount),
    };
  });
}

/**
 * GET /v3/inventories - on-hand quantity per SKU, summed across ship
 * nodes. Returns every SKU you stock, including ones that have never
 * sold, which the settlement reports alone would never reveal.
 *
 * Pagination, confirmed live 2026-09-24 by forcing limit=3 against a
 * 10-SKU account: meta.nextCursor is an opaque token passed back as the
 * `nextCursor` query param - NOT appended to the URL like the Orders
 * API cursor (that 404s), and NOT named `cursor` (silently ignored, so
 * it returns page 1 again). Every page must repeat the same `limit`,
 * or Walmart rejects the cursor as invalid or expired.
 *
 * pageSize is a parameter only so tests can force multiple pages.
 */
export async function fetchInventory(
  token: string,
  pageSize = PAGE_SIZE
): Promise<InventoryItem[]> {
  const headers = walmartHeaders(token);
  let page = 0;

  return paginate<InventoryItem>(
    async (cursor) => {
      page++;
      const url = cursor
        ? `${BASE}?limit=${pageSize}&nextCursor=${encodeURIComponent(cursor)}`
        : `${BASE}?limit=${pageSize}`;
      const res = await fetch(url, { headers });
      // Throw rather than return partial data: silently truncated
      // inventory would read as "SKU not stocked" in the UI.
      if (!res.ok) {
        throw new Error(
          `inventories failed (page ${page}): ${res.status} ${res.statusText} - ${await res.text()}`
        );
      }

      const data: InventoriesResponse = await res.json();
      return { items: toItems(data), nextCursor: data.meta?.nextCursor ?? null };
    },
    MAX_PAGES,
    "inventories"
  );
}
