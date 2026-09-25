import { SP_API_BASE, US_MARKETPLACE_ID, spApiHeaders } from "./auth";

/**
 * Listings Items API 2021-08-01. UNVERIFIED against a live account - see
 * docs/amazon-connector-plan.md. Unlike Walmart's /v3/items, there is no
 * single "list every SKU's price and status" endpoint: each SKU is
 * fetched individually by seller ID + SKU, so the caller (connector.ts)
 * supplies the SKU list (gathered from FBA inventory and recent orders)
 * rather than this file discovering it.
 *
 * The price field in particular is the least confident part of this
 * mapping - `attributes.purchasable_offer` is the best-understood path
 * from public documentation, but Amazon's own docs are inconsistent
 * about it across API versions. Confirm the actual shape against a real
 * listing before trusting `price` here.
 */
export interface Listing {
  sku: string;
  price: number | null;
  publishedStatus: string;
}

interface ListingsItemResponse {
  sku?: string;
  summaries?: { status?: string[] }[];
  attributes?: {
    purchasable_offer?: {
      our_price?: { schedule?: { value_with_tax?: number; value?: number }[] }[];
    }[];
  };
}

/** A small fixed concurrency, not tuned against real rate limits - see docs/amazon-connector-plan.md. */
const CONCURRENCY = 5;

async function fetchOneListing(
  accessToken: string,
  sellerId: string,
  sku: string
): Promise<Listing | null> {
  const url = new URL(
    `${SP_API_BASE}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`
  );
  url.searchParams.set("marketplaceIds", US_MARKETPLACE_ID);
  url.searchParams.set("includedData", "summaries,attributes");

  const res = await fetch(url.toString(), { headers: spApiHeaders(accessToken) });
  if (res.status === 404) return null; // SKU not listed - not an error, just absent
  if (!res.ok) {
    throw new Error(
      `listings/2021-08-01/items/${sku} failed: ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }

  const data: ListingsItemResponse = await res.json();
  const offer = data.attributes?.purchasable_offer?.[0];
  const scheduleEntry = offer?.our_price?.[0]?.schedule?.[0];
  const price = scheduleEntry?.value_with_tax ?? scheduleEntry?.value ?? null;

  // Amazon's `status` is an array (e.g. ["BUYABLE","DISCOVERABLE"] for a
  // sellable listing). The engine's isPublished check is a literal
  // `publishedStatus === "PUBLISHED"` string comparison (Walmart's own
  // vocabulary) - mapped here so it behaves correctly for the common
  // case, but confirm live what a suppressed/inactive Amazon listing's
  // status array actually contains before trusting the "else" branch;
  // the raw array is preserved (joined) for that status so it's visible
  // rather than guessed away.
  const statusList = data.summaries?.[0]?.status ?? [];
  const publishedStatus = statusList.includes("BUYABLE")
    ? "PUBLISHED"
    : statusList.join(",") || "UNKNOWN";

  return { sku, price, publishedStatus };
}

export async function fetchListings(
  accessToken: string,
  sellerId: string,
  skus: string[]
): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let i = 0; i < skus.length; i += CONCURRENCY) {
    const batch = skus.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((sku) => fetchOneListing(accessToken, sellerId, sku))
    );
    out.push(...results.filter((r): r is Listing => r !== null));
  }
  return out;
}
