# Multi-Marketplace Dashboard — Plan

Status: **agreed direction, 2026-09-24.** Decisions are recorded at the bottom. Phase 1 can start.

## Goal

One dashboard that shows sales, fees, profit, inventory and stock value across every marketplace BYRAF sells on. Adding a marketplace should mean writing one adapter folder. It should not mean touching the margin math or the page.

## Where the code is coupled to Walmart today

The core calculations are already mostly neutral. The Walmart assumptions sit in a few specific places:

| Place | Walmart assumption |
|---|---|
| `lib/margin.ts` `groupReconRows`, `classify` | Reads raw `ReconRow` field names (`"Purchase Order #"`, `"Amount Type"`) and Walmart's fee vocabulary |
| `lib/margin.ts` `estimateUnsettled`, `SHIP_NODE_LABELS` | Reads the raw Walmart `Order` shape (`orderLines.orderLine`, `chargeType`, `shipNode`) |
| `app/(dashboard)/margins/actions.ts` | Every action takes `clientId`/`clientSecret` and calls `lib/walmart/*` directly |
| `app/(dashboard)/margins/page.tsx` | Imports `ReconRow`, `InventoryItem` and `CatalogItem` from `lib/walmart/`. The credential form is Client ID + Secret, and the report picker parses `MMDDYYYY` |
| `layout.tsx`, CSV filenames, UI copy | "Walmart Margin Tracker", `walmart-by-sku.csv`, "Walmart says N on hand" |

Already neutral, and staying as they are: `computeMargins`, `summarizeBySku`, `sumMargins`, `stockValue`, `reconcileStock`, cost lots, `priceSeriesBySku`, the CSV code, `PriceChart`.

## Architecture

### 1. A canonical data model (`lib/marketplaces/types.ts`)

Every adapter returns these shapes. Nothing outside an adapter folder ever sees a raw marketplace payload.

```ts
type MarketplaceId = "walmart" | "amazon" | "ebay" | "shopify" | "demo";

/** Evolves from today's OrderLineSummary. */
interface OrderLine {
  marketplace: MarketplaceId;
  orderId: string;          // was purchaseOrderNo
  lineId: string;           // was purchaseOrderLine
  sku: string;
  itemName: string;
  qty: number;
  fulfillment: "merchant" | "marketplace"; // Walmart WFS / Amazon FBA = marketplace
  status: "settled" | "estimated";
  noEstimate: boolean;
  orderDate?: string; postedDate?: string; saleDate?: string; saleDateBasis?: "order" | "posted";
  currency: string;         // "USD" for now; see open questions

  // Same rule as today: every money row lands in exactly one bucket, so the
  // buckets always sum to netAmount.
  revenue: number;
  commission: number;       // Walmart commission, Amazon referral fee, eBay final value fee
  fulfillmentFees: number;  // was `shipping`: labels, WFS fees, FBA fees
  tax: number;
  refunds: number;          // new; currently lands in otherFees
  otherFees: number;
  netAmount: number;
}

/** Fees that belong to no single order line: storage, subscriptions, ads. */
interface AccountCharge {
  marketplace: MarketplaceId;
  periodId: string;
  kind: "storage" | "subscription" | "advertising" | "adjustment" | "other";
  description: string;
  amount: number;
}

interface SettlementPeriod { id: string; label: string; start?: string; end?: string }
interface StockLevel  { marketplace: MarketplaceId; sku: string; onHand: number; availToSell: number; reserved: number; fulfillment: OrderLine["fulfillment"] }
interface Listing     { marketplace: MarketplaceId; sku: string; price: number | null; isPublished: boolean; rawStatus: string }
```

`AccountCharge` closes a known gap. Today `groupReconRows` drops every row that has no Purchase Order #, and that is exactly how WFS storage fees arrive. Amazon's FBA storage fees and subscription fees work the same way.

### 2. The adapter contract (`lib/marketplaces/adapter.ts`)

I recommend an **interface plus a small abstract base class** rather than a deep class hierarchy. The interface is the contract that the dashboard and server actions depend on. The base class is optional and holds shared plumbing such as cursor pagination with a page cap, "throw, never return partial data", and error wrapping. That plumbing is currently duplicated across `inventory.ts`, `items.ts` and `orders.ts`.

```ts
interface MarketplaceAdapter {
  id: MarketplaceId;
  displayName: string;
  /** Drives the credential form, so the page never hard-codes fields. */
  credentialFields: { key: string; label: string; secret: boolean; help?: string }[];
  capabilities: {
    settlements: boolean;       // has a settled-fees source
    unsettledOrders: boolean;   // can supply recent orders to estimate
    inventory: boolean;
    listings: boolean;
  };

  connect(creds: Record<string, string>): Promise<Session>;   // token exchange; per request, never cached
  listSettlementPeriods(s: Session): Promise<SettlementPeriod[]>;
  fetchSettled(s: Session, periodIds: string[]): Promise<{ lines: OrderLine[]; accountCharges: AccountCharge[] }>;
  fetchRecentOrders(s: Session, since: string): Promise<RecentOrderLine[]>; // normalized, cancellations removed, no PII
  fetchStock(s: Session): Promise<StockLevel[]>;
  fetchListings(s: Session): Promise<Listing[]>;
}
```

Fee estimation stays generic in `lib/margin.ts`. `buildSkuHistory` and `estimateUnsettled` would then operate on `OrderLine[]` and `RecentOrderLine[]`, keyed by `(marketplace, sku)`, because Amazon's referral rate on a SKU tells you nothing about Walmart's. So every marketplace gets the "settled vs. estimated" behaviour for free.

Capability flags let the UI degrade honestly. A marketplace without an inventory API shows "not available from Shopify" rather than an empty table that reads as zero stock. This follows the same rule the app already uses: show "—" for a missing figure, never $0.

### 3. Registry and server endpoints

- `lib/marketplaces/registry.ts` maps each `MarketplaceId` to its adapter. Adding a marketplace means adding one line here.
- The server actions become marketplace-parameterized:
  - `listPeriods(marketplace, creds)`
  - `loadDashboard(marketplace, creds, periodIds)` returns `{ lines, accountCharges, stock, listings, errors }` in one round trip, replacing the four parallel calls the page makes today.
- **Recommendation: keep these as server actions, not public REST routes.** Credentials travel in the POST body and are never logged. That is the current security model, and a public `/api/...` surface would need its own auth design. If a script or another tool ever needs the data, add Route Handlers that call the same adapter layer.

### 4. Folder layout

```
lib/marketplaces/
  types.ts            canonical model
  adapter.ts          MarketplaceAdapter interface + BaseAdapter helpers
  registry.ts
  walmart/            today's lib/walmart/*, plus:
    adapter.ts          implements MarketplaceAdapter
    normalize.ts        classify + groupReconRows + recent-order mapping, moved out of margin.ts
  demo/               fixture-backed adapter (see phase 2)
lib/margin.ts         marketplace-neutral math only
app/(dashboard)/dashboard/   the unified page (/margins redirects here)
docs/adding-a-marketplace.md checklist for new adapters
```

### 5. Dashboard UX

- **Connect step:** one card per registered marketplace, each rendering its own `credentialFields`. The user connects one or more marketplaces.
- **Period step:** a period picker per connected marketplace, since settlement cycles don't line up across marketplaces.
- **Dashboard:** a filter chip row (All · Walmart · Amazon · …) above the existing KPI tiles and tabs. Tables gain a marketplace badge column. By SKU groups rows by product, and each product can expand into a per-marketplace breakdown. CSV exports gain a `Marketplace` column.
- **Partial failure is visible.** If Amazon fails and Walmart loads, the dashboard shows Walmart's data with an Amazon error banner. The totals must say they cover only Walmart, following the "totals state what they cover" rule already used for stock value.

## Phases

Each phase ships on its own, and the dashboard works at every step.

| # | Phase | Output | Behaviour change |
|---|---|---|---|
| 1 | **Extract the seam** | Canonical types. Walmart parsing moves into `lib/marketplaces/walmart/`. `margin.ts` consumes `OrderLine`. Add a fixture regression script (`npm run test:margin`, same style as `test:csv`) that pins today's Walmart numbers before the move and proves they're identical after. | None |
| 2 | **Generic plumbing + demo adapter** | Registry, parameterized server actions, a credential form driven by `credentialFields`, and a `demo` adapter that serves fixture data. The demo adapter proves the abstraction without a second real seller account, and doubles as a no-credentials preview of the app. | Marketplace picker appears (Walmart + Demo) |
| 3 | **Multi-connection dashboard** | Connect several marketplaces in one session. Merge the results, add the filter chips and marketplace column, show partial-failure banners, and render `AccountCharge`s in a "Marketplace fees" panel. | Unified view |
| 4 | **Product identity + shared stock** | Products match across marketplaces by normalized SKU automatically. An optional `Alias SKUs` column in the cost CSV handles the exceptions. Stock follows the shared-pool rules below. | Costs entered once per product, and stock isn't double-counted |
| 5 | **Amazon adapter** | SP-API: settlement reports, orders, FBA/merchant inventory, listings. Adds `docs/amazon-api-notes.md` in the same style as the Walmart notes. | Amazon live |
| 6 | **eBay adapter** | Finances API payouts as settlement periods, plus Fulfillment and Inventory APIs. Adds `docs/ebay-api-notes.md`. | eBay live |
| 7 | **Persistence / login** | Deferred by decision (see below). It gets revisited once three marketplaces' worth of credentials are being pasted every visit. | Saved costs and connections |

Phase 1 is safe to start now.

### Product identity (phase 4)

The decision is "mostly the same SKU, some differ", and the app stays stateless:

- **Default:** a product's key is `normalizeSku(sku)`, which is already used everywhere. The same SKU on Walmart and Amazon is automatically one product with one set of cost batches.
- **Exceptions:** the cost CSV gains an optional `Alias SKUs` column, filled once per SKU the same way the box columns are, e.g. `AMZ-LEGO-01; EBAY-LEGO-1`. Aliases resolve to the row's SKU before any grouping happens. The Inventory & costs tab gets a small alias editor, and the export writes aliases back out, so the CSV stays a true round trip.
- **Unmatched SKUs are visible.** A SKU that appears on only one marketplace while a near-identical SKU appears on another (same name, or a case/punctuation-only difference) gets a "possible duplicate" hint. It is never merged silently.

### Stock across channels (phase 4)

Today everything is self-fulfilled, so the **same physical units appear in every marketplace's inventory**. Marketplace fulfillment (WFS/FBA) is planned for later. The stock model handles both:

- `StockLevel.fulfillment` is `"merchant"` for self-fulfilled stock and `"marketplace"` for units held in WFS/FBA warehouses.
- **Merchant stock is one pool, never summed.** Each channel's count is shown separately. The product's pool figure is **your own count**: purchased − sold across *all* marketplaces, which `reconcileStock` already computes from the cost batches. That makes it the one figure that doesn't depend on any marketplace. If a channel's listed quantity is above the pool figure, it's flagged amber because it risks overselling.
- **Marketplace-held stock is summed** on top of the pool, because WFS and FBA units are physically separate.
- **Stock value** uses pool + marketplace-held units. With no batches entered, it falls back to the largest merchant count across channels, clearly labelled as an estimate.

### Credentials while staying stateless

Amazon and eBay use OAuth, but both support a seller authorizing their **own** app once and getting a long-lived refresh token. That token can be pasted like Walmart's key:

| Marketplace | Fields pasted each visit |
|---|---|
| Walmart | Client ID, Client Secret |
| Amazon SP-API | LWA Client ID, LWA Client Secret, Refresh Token (self-authorized private app, US marketplace) |
| eBay | App ID (Client ID), Cert ID (Client Secret), User Refresh Token (~18-month life) |

Each adapter exchanges these for a short-lived access token on every request, never caches or logs them, and keeps the current security model. The one-time setup steps (registering a developer app, self-authorizing) go in each marketplace's API notes.

## Risks

- **Double-counted stock.** A self-fulfilled unit listed on both Walmart and Amazon appears in both inventory APIs. The phase 4 pool rules prevent this. Until phase 4 ships, the dashboard must not show a cross-marketplace stock total.
- **Amazon developer registration.** SP-API access needs an approved developer profile before any code can be tested. Start that application early, because approval can take weeks.
- **Line matching varies by marketplace.** Walmart already disagrees with itself on line numbers, so matching uses PO + SKU instead. Each adapter should own its own settled-vs-recent match key rather than inherit Walmart's.
- **Fee buckets won't map perfectly.** Some fees will fall into `otherFees`. That's fine, because `netAmount` stays exact, but each adapter's mapping should be written down in its API notes.

## Decisions (2026-09-24)

1. **Next marketplaces:** Amazon (SP-API), then eBay.
2. **SKU identity:** mostly the same SKU everywhere, with a few exceptions. Auto-match by normalized SKU, with an alias override (phase 4).
3. **Inventory:** all self-fulfilled today, so one shared pool. Marketplace fulfillment (WFS/FBA) comes later. The stock model handles both (phase 4).
4. **Persistence:** stay stateless for now. Credentials are pasted each visit, including Amazon and eBay refresh tokens.
5. **Endpoints (assumed):** server actions only. No public REST API until something outside the dashboard needs the data.
6. **Currency (assumed):** USD only. US marketplaces for Amazon and eBay. `currency` is carried on every line anyway, so adding a marketplace outside the US later only needs conversion, not a schema change.
