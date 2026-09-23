import { walmartBaseHeaders } from "./auth";

export interface InventoryItem {
  sku: string;
  onHand: number; // inputQty - everything physically counted
  availToSell: number;
  reserved: number;
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

    return {
      sku: inv.sku,
      onHand: sum((n) => n.inputQty?.amount),
      availToSell: sum((n) => n.availToSellQty?.amount),
      reserved: sum((n) => n.reservedQty?.amount),
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
  const headers = {
    Accept: "application/json",
    "WM_SEC.ACCESS_TOKEN": token,
    ...walmartBaseHeaders(),
  };

  const items: InventoryItem[] = [];
  let cursor: string | null | undefined;
  let url = `${BASE}?limit=${pageSize}`;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(url, { headers });
    // Throw rather than return partial data: silently truncated
    // inventory would read as "SKU not stocked" in the UI.
    if (!res.ok) {
      throw new Error(
        `inventories failed (page ${page + 1}): ${res.status} ${res.statusText} - ${await res.text()}`
      );
    }

    const data: InventoriesResponse = await res.json();
    items.push(...toItems(data));

    cursor = data.meta?.nextCursor;
    if (!cursor) return items;
    url = `${BASE}?limit=${pageSize}&nextCursor=${encodeURIComponent(cursor)}`;
  }

  throw new Error(
    `inventories exceeded ${MAX_PAGES} pages - refusing to loop further`
  );
}
