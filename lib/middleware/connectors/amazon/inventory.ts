import { SP_API_BASE, US_MARKETPLACE_ID, spApiHeaders } from "./auth";

/**
 * FBA Inventory API v1 - the seller's own fulfillment-center stock
 * (AFN/FBA), a physically separate pool from anything merchant-fulfilled.
 * UNVERIFIED against a live account - see docs/amazon-connector-plan.md.
 * There is no equivalent live-count API for merchant-fulfilled (MFN)
 * stock; this file only covers FBA.
 */
export interface FbaInventorySummary {
  sellerSku: string;
  totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
  };
}

interface InventorySummariesResponse {
  payload?: { inventorySummaries?: FbaInventorySummary[]; nextToken?: string };
}

const MAX_PAGES = 100;

/** GET /fba/inventory/v1/summaries, paginated via nextToken. */
export async function fetchFbaInventory(
  accessToken: string
): Promise<FbaInventorySummary[]> {
  const summaries: FbaInventorySummary[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${SP_API_BASE}/fba/inventory/v1/summaries`);
    url.searchParams.set("granularityType", "Marketplace");
    url.searchParams.set("granularityId", US_MARKETPLACE_ID);
    url.searchParams.set("marketplaceIds", US_MARKETPLACE_ID);
    url.searchParams.set("details", "true");
    if (nextToken) url.searchParams.set("nextToken", nextToken);

    const res = await fetch(url.toString(), { headers: spApiHeaders(accessToken) });
    if (!res.ok) {
      throw new Error(
        `fba/inventory/v1/summaries failed (page ${page + 1}): ${res.status} ${res.statusText} - ${await res.text()}`
      );
    }

    const data: InventorySummariesResponse = await res.json();
    summaries.push(...(data.payload?.inventorySummaries ?? []));
    nextToken = data.payload?.nextToken;
    if (!nextToken) return summaries;
  }

  throw new Error(
    `fba/inventory/v1/summaries exceeded ${MAX_PAGES} pages - refusing to loop further`
  );
}
