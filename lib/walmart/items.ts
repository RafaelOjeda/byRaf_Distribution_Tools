import { walmartBaseHeaders } from "./auth";

export interface CatalogItem {
  sku: string;
  /** Currently listed price, or null if Walmart didn't return one. */
  price: number | null;
  /** e.g. "PUBLISHED", "UNPUBLISHED", "SYSTEM_PROBLEM". */
  publishedStatus: string;
}

interface ItemsResponse {
  ItemResponse?: {
    sku: string;
    price?: { amount?: number };
    publishedStatus?: string;
  }[];
  totalItems?: number;
  nextCursor?: string;
}

const BASE = "https://marketplace.walmartapis.com/v3/items";
const PAGE_SIZE = 200;
const MAX_PAGES = 100;

/**
 * GET /v3/items - every SKU's listed price and publish status.
 *
 * Paging, confirmed live 2026-09-24 against a 10-item account:
 * - offset paging is NOT safe: the item order changes between calls, so
 *   offset=3 and offset=6 both returned LEGO-MINECRAFT-001. Walking
 *   offsets would produce duplicates and gaps.
 * - A cursor is only returned if you ask for one: the first request must
 *   send nextCursor=* . Without it the response carries no nextCursor at
 *   all, whatever the page size. Each response's nextCursor is then sent
 *   back as the nextCursor param, with the same limit.
 *
 * Only sku, price and publish status are kept - the raw payload also
 * carries long descriptions and category trees we don't need.
 * pageSize is a parameter only so tests can force multiple pages.
 */
export async function fetchCatalogPrices(
  token: string,
  pageSize = PAGE_SIZE
): Promise<CatalogItem[]> {
  const headers = {
    Accept: "application/json",
    "WM_SEC.ACCESS_TOKEN": token,
    ...walmartBaseHeaders(),
  };

  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  let cursor = "*";

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE}?limit=${pageSize}&nextCursor=${encodeURIComponent(cursor)}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text();
      // End of data, not a failure: when the last page fills exactly,
      // Walmart still hands back a cursor and the next request 404s with
      // CONTENT_NOT_FOUND (also what an account with no items returns).
      // Found when a page size of 1 over 10 items failed on page 11.
      if (res.status === 404 && body.includes("CONTENT_NOT_FOUND")) {
        return items;
      }
      // Anything else throws rather than returning partial data: a
      // truncated catalog would read as "no listed price" for the
      // missing SKUs.
      throw new Error(
        `items failed (page ${page + 1}): ${res.status} ${res.statusText} - ${body}`
      );
    }

    const data: ItemsResponse = await res.json();
    for (const i of data.ItemResponse ?? []) {
      if (seen.has(i.sku)) continue; // defensive: never double-count a SKU
      seen.add(i.sku);
      items.push({
        sku: i.sku,
        price:
          typeof i.price?.amount === "number" && Number.isFinite(i.price.amount)
            ? i.price.amount
            : null,
        publishedStatus: i.publishedStatus ?? "UNKNOWN",
      });
    }

    if (!data.nextCursor) return items;
    cursor = data.nextCursor;
  }

  throw new Error(
    `items exceeded ${MAX_PAGES} pages - refusing to loop further`
  );
}
