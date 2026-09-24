# Adding a marketplace

Checklist for adding a new connector to the middleware. See
`docs/multi-marketplace-plan.md` for the overall architecture; this file
is the practical "what do I actually create" companion. `lib/middleware/connectors/demo/`
is the reference implementation to copy from - it exercises every part
of the `MarketplaceConnector` contract with no real network calls. `lib/middleware/connectors/walmart/`
is the reference for a *real* API-backed connector.

If the phases in `docs/multi-marketplace-plan.md` haven't landed yet in
this checkout, do those first - a connector needs `lib/middleware/connectors/base.ts`
(`MarketplaceConnector`) and `lib/middleware/connectors/registry.ts` to exist.

## 1. Research the API first

Before writing any code, spend time against the real API (a sandbox/dev
account is fine) and write down what you find in `docs/<marketplace>-api-notes.md`
(see `docs/walmart-api-notes.md` for the shape). At minimum, confirm:

- **Auth.** What grant type, what the token lifetime is, and exactly which
  fields the seller needs to paste in (this becomes `credentialFields`).
- **Settlement/payout periods.** How they're listed, and what an opaque
  period id looks like.
- **Pagination.** Cursor or offset, page size limits, and what happens on
  the last page (some APIs 404 instead of returning an empty page - Walmart
  does this).
- **Field quirks.** Vendor docs are frequently wrong or incomplete; note
  anything discovered from live responses or error messages rather than
  assumed from the docs, and the date you confirmed it.

## 2. Create the connector folder

```
lib/middleware/connectors/<marketplace>/
  <api-client-files>.ts   one file per API area, mirroring walmart/ (auth, orders, inventory, ...)
  normalize.ts             raw API shapes -> OrderLineSummary/AccountCharge (only if the raw
                            shapes need real transformation - the demo connector skips this
                            because its fixtures are already normalized)
  connector.ts              the MarketplaceConnector subclass
```

Put `import "server-only";` at the top of `connector.ts` (and any other
file that isn't also exercised directly by a `scripts/test-*.ts` script -
see the comment in `lib/middleware/connectors/base.ts` for why the raw
API client files skip it).

## 3. Implement `MarketplaceConnector`

```ts
export class ExampleConnector extends MarketplaceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "example",              // opaque, lowercase, stable - never renames once shipped
    label: "Example",           // shown as-is in the dashboard
    credentialFields: [
      { key: "apiKey", label: "API Key", secret: true },
    ],
    capabilities: {
      settlements: true,   // does listPeriods()/fetchSettled() make sense?
      recentOrders: true,  // does fetchRecentOrders() make sense?
      stock: true,          // does fetchStock() make sense?
      listings: true,       // does fetchListings() make sense?
    },
  };

  protected async authenticate(creds) { /* token exchange -> a session value */ }
  async listPeriods(session) { /* -> { id, label }[] */ }
  async fetchSettled(session, periodIds) { /* -> { lines, charges } */ }
  async fetchRecentOrders(session, sinceIsoDate) { /* -> { lines, orderDates } */ }
  async fetchStock(session) { /* -> StockItem[]; omit if capabilities.stock is false */ }
  async fetchListings(session) { /* -> catalog rows; omit if capabilities.listings is false */ }
}
```

Notes:

- `authenticate` is `protected` - the base class calls it for you from
  `snapshot()` and `listPeriodsFor()`. Nothing above the connector ever
  sees a raw credential past this point.
- Every `OrderLineSummary` you produce needs `sku`, `revenue`, `commission`,
  `shipping`, `tax`, `otherFees` and `netAmount` such that the fee
  components always sum to `netAmount` - the engine (margins, CSV export,
  the dashboard) depends on that invariant, not on any particular fee
  category being "right".
- If nothing has settled yet for a SKU, project fees from that SKU's
  settled history via `buildSkuHistory`/estimate logic (see
  `connectors/walmart/normalize.ts::estimateUnsettled` for the pattern) -
  don't invent a commission rate from a rate card; use what's actually
  been charged.
- `fetchStock`/`fetchListings` are optional overrides (the base class
  throws "not supported" by default) - only implement the ones your
  `capabilities` flags claim.
- Never let a raw API payload escape the connector folder. Only
  `OrderLineSummary`, `AccountCharge`, and the plain stock/catalog row
  shapes cross into the engine.

## 4. Register it

Add one line to `lib/middleware/connectors/registry.ts`:

```ts
export const CONNECTORS: MarketplaceConnector[] = [
  new WalmartConnector(),
  new DemoConnector(),
  new ExampleConnector(),
];
```

That's the entire dashboard-visible change. `describeSources()` picks it
up automatically, the credential form renders itself from `descriptor.credentialFields`,
and the source filter chips/Source column appear once a snapshot includes
more than one source.

## 5. Prove it against the demo connector's pattern

Add fixtures (`connectors/<marketplace>/fixtures.ts` if you want a
demo-only mode of your own) or, for the real thing, a small connectivity
script under `scripts/` (see `scripts/test-walmart-connection.ts`) run
with real sandbox credentials via `dotenv -e .env.local`.

Run the full check before calling it done:

```
npm run test:engine     # pins the neutral math - should need zero changes
npm run test:csv
npm run check:boundary  # app/ must still name no marketplace
npm run lint
npm run build
```

If `test:engine` fails, you've likely changed something in `lib/middleware/engine/`
rather than staying inside your connector folder - the engine is meant to be
marketplace-neutral, so a new connector shouldn't need to touch it (aside
from possibly adding a canonical field everyone needs, which is a larger,
deliberate change discussed in `docs/multi-marketplace-plan.md`, not a
per-connector one).

## 6. What you get for free

- Pagination helper (`this.paginate(...)` in the base class) for
  cursor-paged endpoints.
- Parallel fetch + per-part error collection in `snapshot()` - one failed
  API call (e.g. the catalog endpoint 404s) doesn't take down the whole
  source; it shows up in `Report.notes` instead.
- Fee estimation, SKU normalization, per-source stock pooling and
  possible-duplicate detection (phase 4) all work automatically once your
  connector emits normalized `OrderLineSummary`/stock rows with `sku`
  filled in - nothing marketplace-specific to opt into.
