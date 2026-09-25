# Amazon SP-API connector — plan (phase 5)

Companion to `docs/multi-marketplace-plan.md` (phase 5) and
`docs/adding-a-marketplace.md` (the generic checklist). This is a plan,
not an implementation: nothing here has been verified against a live
Amazon Selling Partner API account, and per `docs/adding-a-marketplace.md`
step 1, that verification has to happen before any connector code is
written. Treat every SP-API detail below as "best understanding from
public documentation, unconfirmed" unless marked otherwise - the
Walmart connector's own notes (`docs/walmart-api-notes.md`) exist
precisely because vendor docs were wrong or incomplete in several
places, and Amazon's docs have the same reputation.

## Blocker: this can't be finished in this environment

**Amazon developer registration is required before step 1 can even
start**, and it's a human/business step, not something an agent session
can do:

1. A Seller Central account in good standing.
2. Register as an SP-API developer and create a **self-authorized
   private app** (no OAuth redirect flow needed for a single-seller
   integration - see `docs/multi-marketplace-plan.md`'s credentials
   table).
3. Amazon reviews the app registration - per the plan's own Risks
   section, this can take weeks.
4. Once approved, self-authorize the app against the seller's own
   account to get **LWA Client ID, LWA Client Secret, and a Refresh
   Token** - the three `credentialFields` already anticipated in
   `docs/multi-marketplace-plan.md`.

Until those exist, there is no way to run step 1 ("spend time against
the real API"), so this document is the furthest phase 5 can go without
that access. It's written so that whoever has (or gets) real credentials
can start at "Implementation checklist" below with the research
questions already scoped.

## A gap phase 4 didn't anticipate: FBA stock isn't like Walmart stock

This is the one design finding worth flagging before any Amazon code
gets written, because it'll produce *quietly wrong* numbers if missed
rather than an obvious bug.

`docs/multi-marketplace-plan.md`'s stock-pooling rules (phase 4, already
shipped) assume every connected source is reporting on the **same
physical units** - purchased once, sold from one pool, and each source's
`onHand` is just that source's view of the same pile. That's true for
Walmart (seller-fulfilled only) and for the demo connector's fixtures.
It stops being true the moment a connector reports **FBA** inventory:
those units are physically shipped into Amazon's warehouses and are not
the same pile as merchant-fulfilled (MFN) stock on any source - the
plan already says as much ("Marketplace-held stock (WFS/FBA) is added
on top of the pool, because those units are physically separate"), but
that addition was explicitly deferred, not built, when phase 4 shipped:

```
lib/middleware/contract/index.ts   StockItem has no fulfillment field
lib/middleware/engine/margins.ts   stockValue() pools every inventory
                                    row into one purchased-minus-sold
                                    comparison, with no merchant/
                                    marketplace distinction
```

If an Amazon connector reports FBA quantities as plain `StockItem` rows
today, `stockValue()`'s oversell-risk check (`docs/multi-marketplace-plan.md`,
"Stock across channels") will compare FBA's real, separate stock against
the merchant pool and raise false oversell warnings for any seller who
uses FBA at all - the exact "quietly wrong" failure mode the plan's own
design principles (null over 0, visible over silent) are meant to
prevent.

**Recommendation:** land a small, scoped engine change alongside phase 5
rather than after it - this is the "canonical field everyone needs"
case `docs/adding-a-marketplace.md` step 5 calls out as the one
legitimate reason to touch `lib/middleware/engine/`:

- Add `fulfillment?: "merchant" | "marketplace"` to `StockItem`
  (`lib/middleware/contract/index.ts`), matching the plan's own
  canonical sketch (`OrderLine`'s `fulfillment` field / `StockLevel`).
  Optional so Walmart and the demo connector, which never set it, keep
  meaning "merchant" (today's only case).
- In `stockValue()` (`lib/middleware/engine/margins.ts`): group
  `bySource` entries by `fulfillment` too. Rows with `fulfillment ===
  "marketplace"` are summed and **added on top of** the pool figure
  (`purchased - sold + marketplaceHeld`), never compared against it for
  oversell risk - the plan's own wording ("added on top", not "pooled
  with"). Merchant-fulfilled rows keep exactly today's behavior.
- `OrderLineSummary.fulfillmentType` (the free-text display column)
  already exists and needs no change - Amazon can set it to `"FBA"` /
  `"Merchant"` the same way Walmart sets `"WFS"` / `"Seller Fulfilled"`.
  That's cosmetic and unrelated to the pooling math.

This is additive and optional-field, so `npm run test:engine` should
still pass unchanged for the Walmart/demo fixtures (same argument
`docs/adding-a-marketplace.md` makes for why a new connector shouldn't
need engine changes) - only a new fixture case for the
`fulfillment: "marketplace"` branch needs adding.

## Mapping SP-API to the contract

| Capability | SP-API surface (unverified) | Maps to |
|---|---|---|
| `authenticate` | LWA refresh-token grant: `POST https://api.amazon.com/auth/o2/token` with `grant_type=refresh_token`. Returns a ~1hr access token, sent as `x-amz-access-token` on every call. **Confirm live:** whether AWS SigV4 request signing is still required for any operation this connector needs - SP-API's 2023 "sunset of legacy authorization" made the LWA token alone sufficient for most operations, but restricted/PII endpoints may differ. | `authenticate(creds)` returns the access token as the session. |
| `listPeriods` / `fetchSettled` | **Primary candidate: Finances API** (`/finances/.../financialEventGroups` and `.../financialEvents`) - JSON, no report-generation/polling delay, and a `FinancialEventGroupId` per settlement period is a natural fit for `Period.id`. **Fallback: Reports API** settlement report types (tab-delimited flat file, needs create-report → poll status → download, closer to Walmart's recon-report shape but slower and needs a flat-file parser like Walmart's). **Confirm live:** which one actually carries every fee category needed (see below) - pick whichever does with the least missing data, don't build both. | `Period` list; `OrderLineSummary[]` (settled) + `AccountCharge[]`. |
| `fetchRecentOrders` | Orders API v0: `GET /orders/v0/orders` (`MarketplaceIds`, `CreatedAfter`) then `GET /orders/v0/orders/{id}/orderItems` for line items. No fees yet - same "project from settled history" pattern as Walmart (`connectors/walmart/normalize.ts::estimateUnsettled`; the engine's `buildSkuHistory` already works on any connector's `OrderLineSummary[]`, no changes needed there). **Never fetch buyer name/address/PII** - matches the existing privacy stance (README's "Customer data stays on the server"); Amazon's Restricted Data Token flow for PII is out of scope entirely, not just unused. | `OrderLineSummary[]`, `noEstimate`-flagged where a SKU has no settled history. |
| `fetchStock` | **FBA units:** FBA Inventory API `GET /fba/inventory/v1/summaries` - real on-hand/reserved/available counts, tag `fulfillment: "marketplace"` (see gap above). **MFN (merchant-fulfilled) units:** Amazon has no live-count API for these - the closest is the *listed* quantity on the Listings Items API, which is self-reported and goes stale the same way Walmart's `fedQty` does (see `docs/walmart-api-notes.md`). **Open question, confirm live:** whether to surface MFN "stock" from Amazon at all, since a stale self-reported number competing with the real purchased-minus-sold pool could read as more authoritative than it is - may be better to leave MFN stock unpopulated from Amazon and let the pool figure alone represent it, the same way a SKU with no source inventory today falls back to the "no cost entered → estimate from max source" pool logic. | `StockItem[]`, `fulfillment` split by AFN/MFN. |
| `fetchListings` | Listings Items API `GET /listings/2021-08-01/items/{sellerId}/{sku}` - price, `status` (ACTIVE/INACTIVE/SUPPRESSED/INCOMPLETE - map to `publishedStatus` the way Walmart's `PUBLISHED`/`UNPUBLISHED` already works generically). | catalog rows `{ sku, price, publishedStatus }`. |

**Advertising spend is out of scope for phase 5.** Amazon Ads is a
separate API with its own OAuth app and credentials, unrelated to
SP-API - if BYRAF wants ad spend in `AccountCharge` eventually, that's
its own connector-adjacent piece of work, not part of "Amazon appears."

## Fee mapping (needs live confirmation, not assumed)

Every `OrderLineSummary` must still satisfy the engine's one hard
invariant: `revenue + commission + shipping + tax + otherFees ===
netAmount`, whatever the real fee categories turn out to be
(`docs/adding-a-marketplace.md` says this plainly - the engine doesn't
care which category is "right", only that nothing is silently dropped).
Best-guess mapping from Amazon's known fee vocabulary, to confirm
against live Finances API event types:

- `ItemPrice` / `Principal` → `revenue`
- `Commission` (referral fee) → `commission`
- `FBAPerUnitFulfillmentFee`, shipping-related charges → `shipping`
  (renaming this column is a canonical-model question for a later,
  deliberate pass across all connectors - not phase 5's job, matching
  `docs/adding-a-marketplace.md`'s stance on engine changes)
- Tax collected/withheld events → `tax`
- Everything else observed (there will be more categories than this
  list) → `otherFees`, the same catch-all Walmart's `classify()` uses
- `ServiceFeeEvent` (storage, subscription), `AdjustmentEvent` →
  `AccountCharge` (`kind: "storage" | "subscription" | "adjustment" |
  "other"`)
- **Refunds are real on Amazon** (`RefundEvent`), unlike Walmart where
  the README notes none have been observed to design against yet.
  Phase 5 needs an actual answer for these, not a punt: fold a refund's
  amount into the same order line's `otherFees`/`netAmount` if the
  original line is still in scope, and treat a refund with no
  in-window original line as its own line so revenue and fees still net
  correctly (or as an `AccountCharge` with `kind: "adjustment"` if it
  can't be tied to a line - decide during live research which case
  actually shows up in the account being tested).

## Folder plan

Following `docs/adding-a-marketplace.md` step 2:

```
lib/middleware/connectors/amazon/
  auth.ts          LWA token exchange
  finances.ts       (or reports.ts, if the Reports API wins the fallback question above)
  orders.ts
  inventory.ts       FBA Inventory API
  listings.ts        Listings Items API
  normalize.ts       raw SP-API shapes -> OrderLineSummary / AccountCharge
  connector.ts        AmazonConnector extends MarketplaceConnector
docs/amazon-api-notes.md   filled in during step 1, once real access exists
```

`descriptor`:

```ts
readonly descriptor: SourceDescriptor = {
  id: "amazon",
  label: "Amazon",
  credentialFields: [
    { key: "lwaClientId", label: "LWA Client ID", secret: false },
    { key: "lwaClientSecret", label: "LWA Client Secret", secret: true },
    {
      key: "refreshToken",
      label: "Refresh Token",
      secret: true,
      help: "From your self-authorized SP-API app (Seller Central > Apps & Services > Develop apps).",
    },
  ],
  capabilities: { settlements: true, recentOrders: true, stock: true, listings: true },
};
```

Marketplace ID is fixed for now: `ATVPDKIKX0DER` (US), matching the
plan's existing "USD only" / single-currency assumption - hardcode it in
`connector.ts` rather than adding a field, since the credentials table
already scopes this to "US marketplace" and multi-marketplace-per-seller
is a bigger, separate question.

## Implementation checklist (once credentials exist)

1. **Research** (`docs/adding-a-marketplace.md` step 1): confirm the LWA
   token flow works with `curl`/a throwaway script exactly as expected;
   confirm whether SigV4 signing is actually needed for the operations
   below; confirm which of Finances API vs Reports API to use for
   settlements; pull one real financial event group and note its exact
   JSON shape and every fee-event type observed. Write it all into
   `docs/amazon-api-notes.md`, dated, the same way
   `docs/walmart-api-notes.md` was built.
2. **`authenticate` + `listPeriods`** first, alone - prove the
   credential flow and period listing work before building out fee
   parsing. This is enough for `npm run test:walmart`-style connectivity
   script (`scripts/test-amazon-connection.ts`).
3. **`fetchSettled`** - settlement/financial data → `OrderLineSummary[]`
   + `AccountCharge[]`, satisfying the revenue/fee invariant above.
4. **`fetchRecentOrders`** - unsettled orders, fee-estimated from
   settled history (reuses engine code unchanged).
5. **The `StockItem.fulfillment` engine addition** (see the gap above) -
   do this alongside `fetchStock`, not after, so FBA inventory is never
   shipped mis-pooled even temporarily.
6. **`fetchStock`** and **`fetchListings`**.
7. Register in `lib/middleware/connectors/registry.ts` - one line, per
   `docs/adding-a-marketplace.md` step 4.
8. Full verification: `npm run test:engine`, `npm run test:csv`,
   `npm run check:boundary`, `npm run lint`, `npm run build`, plus a
   Playwright pass against the dev server the way phases 1-4 were
   verified (see the session history) - except here also connected
   *alongside* Walmart/demo to confirm multi-source behavior (source
   filter chips, Source column, per-SKU `bySource` breakdown, and the
   new FBA-vs-pool stock split) all still read correctly with three
   real sources instead of two.

Each numbered step above can land as its own PR/commit, same pattern as
phases 1-4 - `capabilities` flags let a connector go live with only
`settlements`/`recentOrders` working and `stock`/`listings` still
throwing "not supported" until steps 5-6 land, and `snapshot()`'s
per-part error collection means a partially-built connector degrades to
a `Report.notes` entry rather than breaking the dashboard.

## What can't be verified without real access

Everything in the tables above marked "confirm live" or "open question" -
concretely: the exact Finances-vs-Reports API choice, the complete fee
event type list, refund handling in practice, whether MFN stock should
be surfaced at all, SigV4 necessity, rate limits and backoff behavior,
and report/event pagination shape. None of these are guessable safely
enough to hardcode - guessing them and shipping is exactly the mistake
`docs/adding-a-marketplace.md` step 1 exists to prevent, and Walmart's
own notes document several cases where the "obvious" reading of vendor
docs was wrong.
