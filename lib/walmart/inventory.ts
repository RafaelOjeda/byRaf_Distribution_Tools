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
 * Follows meta.nextCursor the same way the Orders API does (cursor is a
 * query string appended to the base URL). That form is unverified here -
 * this account has fewer SKUs than one page - so a failed follow-up page
 * returns what was collected rather than throwing. Partial inventory is
 * more useful than none, and inventory is advisory in the UI anyway.
 */
export async function fetchInventory(token: string): Promise<InventoryItem[]> {
  const headers = {
    Accept: "application/json",
    "WM_SEC.ACCESS_TOKEN": token,
    ...walmartBaseHeaders(),
  };

  const first = await fetch(`${BASE}?limit=${PAGE_SIZE}`, { headers });
  if (!first.ok) {
    throw new Error(
      `inventories failed: ${first.status} ${first.statusText} - ${await first.text()}`
    );
  }

  const data: InventoriesResponse = await first.json();
  const items = toItems(data);
  let cursor = data.meta?.nextCursor;

  for (let page = 0; cursor && page < MAX_PAGES; page++) {
    const res = await fetch(`${BASE}${cursor}`, { headers });
    if (!res.ok) break;
    const next: InventoriesResponse = await res.json();
    const batch = toItems(next);
    if (batch.length === 0) break;
    items.push(...batch);
    cursor = next.meta?.nextCursor;
  }

  return items;
}
