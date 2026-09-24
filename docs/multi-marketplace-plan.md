# Multi-Marketplace Dashboard — Plan

Status: **agreed direction, 2026-09-24.** Decisions are recorded at the bottom. Phase 1 can start.

## Goal

One dashboard that shows sales, fees, profit, inventory and stock value across every marketplace BYRAF sells on.

**The dashboard is never connected to a marketplace.** It talks only to a middleware layer. The middleware owns every marketplace connection, all normalization and all of the math, and gives the dashboard finished figures. Adding a marketplace means adding one connector inside the middleware. The dashboard doesn't change.

## Two layers

```
┌───────────────────────────── app/ (dashboard) ─────────────────────────────┐
│  Renders forms, tables, tiles, the chart. Holds what the user typed.        │
│  No marketplace names, fee vocabulary, credential fields or arithmetic.    │
└──────────────┬──────────────────────────────────────────▲───────────────────┘
               │ middleware contract only (lib/middleware/index.ts, actions.ts)
┌──────────────▼──────────────────── lib/middleware/ ──────┴──────────────────┐
│  contract/    public types: SourceDescriptor, Snapshot, CostInputs, Report  │
│  actions.ts   server actions: describeSources, listPeriods, fetchSnapshot   │
│  engine/      all math: estimates, margins, per-SKU, stock pool, prices     │
│  connectors/  MarketplaceConnector base class + walmart/ amazon/ ebay/ demo/│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS
                          Walmart · Amazon · eBay APIs
```

The middleware lives in this repo, at `lib/middleware/` rather than a top-level `middleware/`. That keeps it clear of Next.js's reserved root `middleware.ts`/`proxy.ts` file convention.

**Rule:** code in `app/` may import only `@/lib/middleware` (the public index) and `@/lib/middleware/actions`. It may not import connectors, the engine or anything marketplace-specific. This is enforced mechanically (see "Keeping the boundary honest").

## Where the code is coupled to Walmart today

Everything in this table moves behind the middleware boundary or gets replaced by data from the middleware:

| Place | Walmart assumption | Goes to |
|---|---|---|
| `lib/walmart/*` | The API clients | `lib/middleware/connectors/walmart/` |
| `lib/margin.ts` `groupReconRows`, `classify`, `estimateUnsettled`, `SHIP_NODE_LABELS` | Raw recon-row and order shapes, Walmart fee vocabulary | Walmart connector (normalization) |
| The rest of `lib/margin.ts`, `lib/prices.ts` | Neutral math | `lib/middleware/engine/` |
| Cost CSV parsing/export in `lib/csv.ts` | Defines the cost input format | `lib/middleware/engine/` (the middleware owns the `CostInputs` format) |
| `app/(dashboard)/margins/actions.ts` | Takes `clientId`/`clientSecret` and calls Walmart | Replaced by `lib/middleware/actions.ts` |
| `page.tsx` | Imports Walmart types, hard-codes the Client ID/Secret form, parses `MMDDYYYY`, calls `computeMargins`/`stockValue`/etc. directly | Renders a `Report` and a generic credential form built from `SourceDescriptor`s |
| `layout.tsx`, CSV filenames, UI copy | "Walmart Margin Tracker", `walmart-by-sku.csv`, "Walmart says N on hand" | Neutral copy. Source names come from the middleware as data |

## The middleware contract

This is everything the dashboard can see. All of it is plain serializable JSON, so the middleware could later be split into its own service without redesigning the contract (see "Later: a separate service").

### Sources and credentials (passthrough)

```ts
/** A connectable data source. The dashboard renders these; it never names one. */
interface SourceDescriptor {
  id: string;                 // opaque to the dashboard ("walmart", "amazon", ...)
  label: string;              // "Walmart", shown as-is
  credentialFields: { key: string; label: string; secret: boolean; help?: string }[];
  capabilities: { settlements: boolean; recentOrders: boolean; stock: boolean; listings: boolean };
}

/** What the user pasted, per source. The dashboard holds it and passes it through; it never reads it. */
type Connections = Record<string /* source id */, Record<string, string>>;
```

Credentials stay **pasted each visit and passed through**. The dashboard keeps them in tab state and sends them with each middleware call. The middleware uses them for that one request only and never stores, caches or logs them. This is the current security model, generalized.

### Two steps: fetch, then compute

Today, typing a cost updates profit instantly because the math runs in the browser. Now that the middleware computes everything, a cost edit mustn't trigger a refetch from three marketplaces. So the middleware exposes two kinds of call:

```ts
// lib/middleware/actions.ts   ("use server": talks to marketplaces)
describeSources(): Promise<SourceDescriptor[]>;
listPeriods(c: Connections): Promise<Record<string, PeriodList>>;       // labels pre-formatted, no MMDDYYYY in the UI
fetchSnapshot(c: Connections, periods: Record<string, string[]>): Promise<Snapshot>;

// lib/middleware/index.ts     (pure: no network, no secrets)
buildReport(s: Snapshot, costs: CostInputs, view: ReportView): Report;
parseCostCsv(text: string): CostImportResult;   // the middleware defines the cost input format
exportCsv(r: Report, table: "bySku" | "orderLines" | "costs"): string;
```

- **`fetchSnapshot`** is the expensive call. It connects to every source, normalizes the results and runs fee estimation for unsettled orders, and returns a `Snapshot`. The `Snapshot` is typed as an **opaque branded type**: the dashboard stores it and hands it back, but never reads a field from it.
- **`buildReport`** is middleware code that does all the math. It turns snapshot + costs + view (source filter, date range) into finished rows: KPIs, by-SKU, order lines, price series, stock and stock value, marketplace fees, and per-source status. It's a pure function, so the dashboard calls it on every cost edit and the result is still instant. It needs no network access and no credentials.

The dashboard's only jobs are to hold the user's input (`Connections`, `CostInputs`, `ReportView`), call the middleware, and render the `Report`.

### What the report looks like

The `Report` is shaped for display. Every figure is already computed, every "unknown" is `null` (rendered "—", never $0) and every total says what it covers. For example:

```ts
interface Report {
  sources: { id: string; label: string; status: "ok" | "error" | "not-connected"; error?: string }[];
  kpis: { revenue: Money; units: number; net: Money; profit: Money | null; stockValue: Money | null; coverage: string };
  bySku: SkuRow[];          // one per product, with per-source breakdown rows
  orderLines: LineRow[];    // each tagged with sourceLabel, "settled" | "estimated" | "noEstimate"
  priceSeries: PriceSeries[];
  stock: StockRow[];        // pool figure, per-source counts, oversell flag
  marketplaceFees: ChargeRow[]; // storage, subscriptions, ads: fees that belong to no single order
  notes: string[];          // e.g. "Amazon failed to load; totals cover Walmart and eBay only"
}
```

Tooltip text like today's "Estimated: commission at 6.4%…" is produced by the middleware too, so the dashboard never learns fee vocabulary.

## Inside the middleware

### Canonical model (`engine/types.ts`, internal)

Connectors normalize into these shapes, and the engine consumes only these. Nothing outside a connector folder ever sees a raw marketplace payload.

```ts
interface OrderLine {        // evolves from today's OrderLineSummary
  source: string;
  orderId: string; lineId: string; sku: string; itemName: string; qty: number;
  fulfillment: "merchant" | "marketplace";      // WFS / FBA = marketplace
  status: "settled" | "estimated"; noEstimate: boolean;
  orderDate?: string; postedDate?: string; saleDate?: string; saleDateBasis?: "order" | "posted";
  currency: string;
  // Every money row lands in exactly one bucket, so these always sum to netAmount.
  revenue: number; commission: number; fulfillmentFees: number; tax: number; refunds: number; otherFees: number;
  netAmount: number;
}
interface AccountCharge { source: string; periodId: string; kind: "storage" | "subscription" | "advertising" | "adjustment" | "other"; description: string; amount: number }
interface StockLevel   { source: string; sku: string; onHand: number; availToSell: number; reserved: number; fulfillment: OrderLine["fulfillment"] }
interface Listing      { source: string; sku: string; price: number | null; isPublished: boolean; rawStatus: string }
```

`AccountCharge` closes a known gap. Today `groupReconRows` drops every row that has no Purchase Order #, and that is exactly how WFS storage fees arrive.

### Connectors: abstract base class (`connectors/base.ts`)

Each marketplace is a subclass of one abstract class. The base class holds the plumbing that is currently duplicated across `inventory.ts`, `items.ts` and `orders.ts`:

- cursor pagination with a page cap;
- "throw, never return partial data";
- error wrapping that never includes a secret;
- the capability checks.

```ts
abstract class MarketplaceConnector {
  abstract readonly descriptor: SourceDescriptor;

  /** Token exchange. Per request, never cached across requests. */
  protected abstract authenticate(creds: Record<string, string>): Promise<Session>;
  abstract listPeriods(s: Session): Promise<SettlementPeriod[]>;
  abstract fetchSettled(s: Session, periodIds: string[]): Promise<{ lines: OrderLine[]; charges: AccountCharge[] }>;
  abstract fetchRecentOrders(s: Session, since: string): Promise<RecentOrderLine[]>; // normalized, no PII
  fetchStock(_s: Session): Promise<StockLevel[]> { return this.unsupported("stock"); }
  fetchListings(_s: Session): Promise<Listing[]> { return this.unsupported("listings"); }

  /** Orchestration shared by every marketplace: auth once, fetch in parallel, collect per-part errors. */
  async snapshot(creds: Record<string, string>, periodIds: string[]): Promise<SourceSnapshot> { /* ... */ }

  protected paginate<T>(/* cursor loop with MAX_PAGES */): Promise<T[]> { /* ... */ }
}
```

`connectors/registry.ts` lists the connectors, so adding a marketplace means adding one line there. `describeSources()` is built from that registry, which is how a new marketplace shows up in the dashboard with no dashboard change.

Fee estimation for unsettled orders stays in the engine, keyed by `(source, sku)`, because Amazon's referral rate on a SKU says nothing about Walmart's. Every connector gets settled-vs-estimated behaviour for free. Each connector supplies its own settled-vs-recent match key, because Walmart already disagrees with itself on line numbers.

### Folder layout

```
lib/middleware/
  index.ts              public, client-safe: buildReport, parseCostCsv, exportCsv, contract types
  actions.ts            public, "use server": describeSources, listPeriods, fetchSnapshot
  contract/             SourceDescriptor, Connections, Snapshot (branded), CostInputs, ReportView, Report
  engine/               types.ts, estimate.ts, margins.ts, stock.ts, prices.ts, report.ts, costsCsv.ts
  connectors/
    base.ts             MarketplaceConnector
    registry.ts
    walmart/            today's lib/walmart/* + normalize.ts (classify, groupReconRows, order mapping)
    demo/               fixture-backed connector
    amazon/  ebay/      later phases
app/(dashboard)/dashboard/   the unified page (/margins redirects here)
docs/adding-a-marketplace.md connector checklist
```

### Keeping the boundary honest

- **ESLint `no-restricted-imports`** for `app/**`: only `@/lib/middleware` and `@/lib/middleware/actions` are allowed. Imports of `@/lib/middleware/*/**` are errors.
- **`server-only`** is imported by everything under `connectors/`, so connector code can never end up in the browser bundle.
- **`npm run check:boundary`** fails if `app/` contains a marketplace name (`walmart`, `amazon`, `ebay`, case-insensitive) outside comments. It's crude, but it catches copy like "Walmart says…".
- The **demo connector** is the living test. If the dashboard works fully against it with no dashboard-side special cases, the abstraction holds.

### Dashboard UX

- **Connect:** one card per `SourceDescriptor`, each with its own fields. Connect one or several.
- **Periods:** a picker per connected source, because settlement cycles don't line up across marketplaces.
- **Dashboard:** source filter chips (All · each connected source) above the existing tiles and tabs. Tables gain a source column. By SKU rows expand into a per-source breakdown. The filter is part of `ReportView`, so filtering is also computed by the middleware.
- **Partial failure is visible.** If one source fails, the others still show. The report's `sources` and `notes` say which failed and what the totals cover.

## Phases

Each phase ships on its own, and the app works at every step.

| # | Phase | Output | Behaviour change |
|---|---|---|---|
| 1 | **Carve out the middleware** | Create `lib/middleware/`. Move the Walmart clients into `connectors/walmart/` behind `MarketplaceConnector`, and split `margin.ts`/`prices.ts` into connector normalization + `engine/`. Before moving anything, add a fixture regression script (`npm run test:engine`, same style as `test:csv`) that pins today's numbers, and prove they're identical after. | None |
| 2 | **Dashboard onto the contract** | Add `actions.ts` (describeSources/listPeriods/fetchSnapshot) and `buildReport`. The page renders the generic credential form and a `Report`. Add the lint rule and `check:boundary`. **After this phase `app/` has zero marketplace references.** | Looks the same; copy becomes neutral |
| 3 | **Demo connector + multiple sources** | Fixture-backed demo connector, connecting several sources at once, filter chips, the source column, partial-failure notes, and a "Marketplace fees" panel for `AccountCharge`s. | Unified view (Walmart + Demo) |
| 4 | **Product identity + shared stock** | Engine work only: SKU aliasing and the stock-pool rules below. | Costs entered once per product, and stock isn't double-counted |
| 5 | **Amazon connector** | SP-API: settlement reports, orders, merchant/FBA inventory, listings. Adds `docs/amazon-api-notes.md`. | Amazon appears. No dashboard change |
| 6 | **eBay connector** | Finances API payouts as periods, plus Fulfillment and Inventory APIs. Adds `docs/ebay-api-notes.md`. | eBay appears. No dashboard change |
| 7 | **Persistence / login** | Deferred by decision. Revisit once three marketplaces' credentials are being pasted every visit. | Saved costs and connections |

Phases 5 and 6 are the proof of the design: each should touch only `lib/middleware/connectors/` plus one registry line.

### Product identity (phase 4, engine)

- **Default:** a product's key is `normalizeSku(sku)`. The same SKU on Walmart and Amazon is automatically one product with one set of cost batches.
- **Exceptions:** `CostInputs` gains per-SKU aliases, and the cost CSV gains an optional `Alias SKUs` column filled once per SKU like the box columns (e.g. `AMZ-LEGO-01; EBAY-LEGO-1`). The engine resolves aliases before any grouping. Export writes them back, so the CSV stays a true round trip.
- **Near-matches are flagged, never merged silently.** The report marks SKUs that differ only by case or punctuation, or that share an item name across sources, as "possible duplicate".

### Stock across channels (phase 4, engine)

Everything is self-fulfilled today, so the same physical units appear in every marketplace's inventory. WFS/FBA fulfillment is planned for later.

- **Merchant stock is one pool, never summed.** The report shows each source's count. The pool figure is your own count, purchased − sold across all sources, taken from the cost batches (`reconcileStock` already does this). A source listing more than the pool is flagged amber as an oversell risk.
- **Marketplace-held stock (WFS/FBA) is added** on top of the pool, because those units are physically separate.
- **Stock value** uses pool + marketplace-held units. With no batches entered, it falls back to the largest merchant count across sources, labelled as an estimate.

### Credentials per marketplace (passthrough, stateless)

Amazon and eBay both let a seller authorize their own app once and get a long-lived refresh token, which can be pasted like Walmart's key. The dashboard doesn't know these fields; it renders whatever the connector's `SourceDescriptor` declares.

| Connector | Declared fields |
|---|---|
| Walmart | Client ID, Client Secret |
| Amazon SP-API | LWA Client ID, LWA Client Secret, Refresh Token (self-authorized private app, US marketplace) |
| eBay | App ID, Cert ID, User Refresh Token (~18-month life) |

## Later: a separate service

Because the contract is plain JSON and the dashboard only calls `actions.ts` and `index.ts`, the middleware can move to its own deploy later with no dashboard redesign. The three server actions become HTTP endpoints, and `buildReport` either stays as a shared package or becomes a fourth endpoint. Nothing in this plan needs that now.

## Risks

- **Amazon developer registration.** SP-API access needs an approved developer profile before any connector code can be tested. Apply early, because approval can take weeks.
- **Double-counted stock** until phase 4. The report must not produce a cross-source stock total before the pool rules exist.
- **Snapshot size.** The snapshot lives in the browser tab and grows with history loaded. That's fine at current volume, and it's the same data the page holds today. It becomes a reason to revisit persistence if years of history get loaded.
- **Fee buckets won't map perfectly.** Some fees will fall into `otherFees`. `netAmount` stays exact, and each connector's mapping is documented in its API notes.
- **Server actions are public POST endpoints**, as they are today. They're only useful with valid marketplace credentials, and they must never echo credentials back in errors.

## Decisions (2026-09-24)

1. **Next marketplaces:** Amazon (SP-API), then eBay.
2. **SKU identity:** mostly the same SKU everywhere. Auto-match by normalized SKU, with alias overrides.
3. **Inventory:** all self-fulfilled today, so one shared pool. WFS/FBA later.
4. **Persistence:** stay stateless for now.
5. **The dashboard never connects to a marketplace.** A middleware layer owns every connection.
6. **The middleware lives in this repo** as `lib/middleware/`, with a lint-enforced boundary.
7. **Credentials are pasted in the dashboard and passed through** the middleware per request, never stored.
8. **The middleware computes everything.** The dashboard only renders. Instant recompute on cost edits comes from the pure `buildReport` step, which reuses the snapshot and doesn't refetch.
9. **Endpoints (assumed):** server actions, not a public REST API, until something outside this dashboard needs the data.
10. **Currency (assumed):** USD only. `currency` is carried on every line so this can change later.
