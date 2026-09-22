# Walmart Seller Margin Tracker — V1 Plan

## What We're Trying to Build

Walmart Marketplace has no built-in way to enter what you paid for an item, so there's no native profit margin view — you only see your selling price and fees separately. This tool closes that gap for BYRAF Distribution's Walmart sales.

1. **Pull every sold item and its fees automatically** from the Walmart Marketplace API, using the Reconciliation Report as the source of truth (it already contains sale price and every associated fee per order line).
2. **Let you enter your cost per SKU** — manually or by CSV — since this data doesn't exist anywhere on Walmart's side.
3. **Calculate true profit margin per item** by combining Walmart's revenue/fee data with your cost data.
4. **Display it in a simple interface** — one table to manage costs, one to view margins.

Walmart-only for V1. Amazon (which has a native cost field) is out of scope and may become a second data source later.

---

## Stack Decisions

Deployed as a **single Vercel project**. Three changes from the original plan, each with a reason:

| Original | Now | Why |
|---|---|---|
| FastAPI backend + separate Next.js frontend | **Next.js App Router only** (Route Handlers + Server Actions) | One repo, one deploy, one domain, no CORS, no second host to pay for. The backend work here is "call an API, parse JSON, write rows" — it needs no Python. |
| SQLite | **Neon Postgres** via Vercel Marketplace, with Drizzle ORM | Vercel's filesystem is ephemeral — a SQLite file is wiped on every deploy and not shared between function instances. Neon provisions through the Marketplace and injects `DATABASE_URL` automatically. |
| AWS | **Vercel** | Cron, secrets, and access control are all built in. |

**Access control: Vercel Authentication (deployment protection).** Worth being explicit, because this was an open question:

The Walmart Marketplace API uses `grant_type=client_credentials` — machine-to-machine. There is no "Sign in with Walmart" identity provider, so the Client ID + Secret are *server-side app secrets*, not user credentials. Our backend holds them and acts as the seller account on every call; nobody logs in "as" the seller.

That leaves the app itself ungated, and the sensitive dataset here is **your supplier cost per SKU** — the one thing not already on Walmart's side. Vercel Authentication restricts the deployment to your Vercel account: zero code, zero cost, one toggle, swappable for Clerk if teammates ever need in.

**This repo is public.** Secrets live only in Vercel env vars. Nothing credential-shaped is ever committed — `.env*` is already gitignored.

**No Redis.** Walmart tokens expire in ~15 minutes, but a sync run finishes well inside that, so the token is fetched once per run and held in a local variable. Nothing to provision.

---

## V1 Scope

**In scope**
- Walmart sales + fees ingestion via the Reconciliation Report
- Cost entry per SKU: editable table *and* CSV import
- Margin calculation and display
- Manual "Sync" button + daily cron

**Out of scope for V1**
- Amazon integration
- Real-time order estimates before settlement closes
- Multi-user accounts, roles, audit log

---

## API Surface (verified against Walmart's docs)

**Auth** — `POST /v3/token`, Basic auth (Client ID:Secret), `grant_type=client_credentials`. Tokens last ~15 min. Every request also needs `WM_SVC.NAME` and `WM_QOS.CORRELATION_ID` headers.

**List periods** — `GET /v3/report/reconreport/availableReconFiles?reportVersion=v1`

**Fetch a period** — `GET /v3/report/reconreport/reconFileJson`

Two corrections to the original plan came out of checking the live docs:

1. **Use the JSON endpoint, not the zipped CSV.** `reconFileJson` returns structured JSON directly. This removes an unzip step and a CSV-header-parsing step from inside a serverless function — both of which are avoidable failure points.
2. **The response is paginated.** It returns `{ reportData: [...], nextOffset, totalRecords, description }`. The ingestion loop must follow `nextOffset` until exhausted, or you silently ingest only the first page and every margin is wrong.

Each `reportData` element is **one money line, not one order** — confirming the original plan's instinct. Fields, exactly as Walmart names them:

`Customer Order #` · `Customer Order line #` · `Purchase Order #` · `Purchase Order line #` · `Transaction Key` · `Partner Item Id` · `Partner Item Name` · `Partner GTIN` · `Amount` · `Amount Type` · `Transaction Type` · `Transaction Description` · `Ship Qty` · `Shipping Method` · `Period Start Date` · `Period End Date` · `Transaction Posted Timestamp`

Sales and fees are distinguished by `Amount Type` / `Transaction Type` — not by separate sections. `Transaction Key` is unique per line and becomes our idempotency key, so re-syncing a period is safe.

---

## Data Model

Three tables plus a derived query. Raw rows are **append-only** — never updated, never deleted.

```
walmart_recon_rows          -- raw, append-only, one row per money line
  id                  bigserial pk
  transaction_key     text unique not null   -- Walmart's key; makes re-sync idempotent
  report_date         date not null          -- settlement period this row arrived in
  period_start        date
  period_end          date
  customer_order_no   text
  customer_order_line text
  purchase_order_no   text
  purchase_order_line text
  partner_item_id     text                   -- SKU
  partner_item_name   text
  transaction_type    text
  amount_type         text
  transaction_desc    text
  amount              numeric(12,2) not null  -- signed: sales +, fees/refunds −
  ship_qty            integer
  posted_at           timestamptz
  raw                 jsonb not null          -- the untouched original row
  ingested_at         timestamptz default now()

  index on (purchase_order_no, purchase_order_line)
  index on (partner_item_id)
  index on (report_date)
```

`raw jsonb` is deliberate. Walmart adds and renames amount types, and we will not anticipate all of them. Keeping the original row means a classification bug is fixed with a query change instead of a full re-download.

```
sku_costs                   -- effective-dated so cost changes don't rewrite history
  id              serial pk
  partner_item_id text not null
  unit_cost       numeric(12,4) not null
  effective_from  date not null
  note            text
  created_at      timestamptz default now()
  unique (partner_item_id, effective_from)
```

```
sync_runs                   -- observability + prevents overlapping syncs
  id             serial pk
  trigger        text not null       -- 'manual' | 'cron'
  status         text not null       -- 'running' | 'success' | 'error'
  started_at     timestamptz default now()
  finished_at    timestamptz
  report_dates   text[]
  rows_ingested  integer
  error          text
```

No `skus` table — the SKU list derives from `SELECT DISTINCT partner_item_id FROM walmart_recon_rows`. One less thing to keep in sync.

### Margin Calculation

A **derived query, not a stored table.** Refunds and adjustments for a sale routinely land in a *later* settlement period, so any stored margin would go stale the moment a refund arrives. Computing on read means late-arriving rows are automatically reflected.

Group by `(purchase_order_no, purchase_order_line)`:

```
net_settlement = SUM(amount)                       -- every row for the line, all periods
gross_revenue  = SUM(amount) WHERE amount_type IN (<revenue types>)
total_fees     = net_settlement − gross_revenue

unit_cost      = latest sku_costs row for that SKU where effective_from <= order date
profit         = net_settlement − (unit_cost × ship_qty)
margin         = profit / gross_revenue
```

One useful property falls out of this: because `net_settlement` sums *everything*, **profit is correct even if we misclassify a fee type.** Only the margin *percentage* depends on classification, since it needs a revenue denominator. So profit works from day one and margin % gets refined as we learn the real `Amount Type` taxonomy.

Order lines with **no matching cost row are flagged**, never shown as 100% margin.

---

## Repo Structure

```
app/
  (dashboard)/
    costs/page.tsx            -- editable cost table + CSV import
    margins/page.tsx          -- margins table, date-filterable
    layout.tsx
  api/
    sync/walmart/route.ts     -- POST, manual trigger
    cron/sync/route.ts        -- GET, cron target
lib/
  walmart/
    auth.ts                   -- token fetch, per-run cache
    recon.ts                  -- availableReconFiles + reconFileJson w/ nextOffset paging
    normalize.ts              -- raw JSON row -> typed insert
  db/
    index.ts                  -- lazy getDb()
    schema.ts                 -- Drizzle schema
    queries.ts                -- margin query, cost CRUD
  margin.ts                   -- pure calc + amount-type classification rules
drizzle/                      -- migrations
vercel.ts                     -- cron schedule (typed config, replaces vercel.json)
```

Two implementation notes that will otherwise cost an afternoon each:

- **`getDb()` must be lazily initialized as a plain function.** `neon()` throws when `DATABASE_URL` is unset, and Next.js evaluates top-level module code at build time — so a module-level `const db = ...` crashes `next build` on the first deploy, before Neon is provisioned. Do **not** use a `Proxy` wrapper for the laziness; use a simple cached `let`.
- **`drizzle-kit` does not read `.env.local`.** Migrations need `npx dotenv -e .env.local -- npx drizzle-kit push`.

---

## Build Phases

Ordered so that each phase de-risks the next, and so the riskiest unknown is confronted early with real data.

**Phase 0 — Provision.** Install the Vercel CLI (`npm i -g vercel`, not currently installed). `vercel link`. `vercel integration add neon`. Enable Vercel Authentication. Add `WALMART_CLIENT_ID` / `WALMART_CLIENT_SECRET`. `vercel env pull`.

**Phase 1 — Skeleton.** Next.js + TypeScript + Tailwind, Drizzle schema, first migration, both pages stubbed. Deploy. Confirms the whole pipeline works before any Walmart logic exists.

**Phase 2 — Prove connectivity.** Token fetch + `availableReconFiles`, surfaced as a list of dates in the UI. This is the smallest possible real API call; it validates credentials, headers, and correlation IDs in isolation. **Hard gate on Walmart keys** — everything before this runs without them.

**Phase 3 — Ingest raw, then look.** Pull one period, follow `nextOffset`, write to `walmart_recon_rows`. Then **inspect the actual distinct `Amount Type` and `Transaction Type` values.** No classification logic is written before this point — writing it first means guessing at a taxonomy we can simply read.

**Phase 4 — Classify + margin query.** Now informed by real values: revenue/fee classification in `margin.ts`, margin query in `queries.ts`. Unit-test the calc against a hand-checked order line.

**Phase 5 — Costs UI.** Editable table (Server Actions) + CSV import with a preview-before-commit step and per-row validation.

**Phase 6 — Margins UI.** Date filter, sort by profit/margin, visible "missing cost" flag, CSV export.

**Phase 7 — Automate.** Backfill all available periods. Daily cron in `vercel.ts`. `sync_runs` guard against overlapping runs.

Phases 0–2 are a short evening. Phase 3 is where real information arrives.

---

## Risks and Known Limitations

**Settlement lag (accepted).** Fees only appear once a settlement period closes — roughly every two weeks — so your most recent sales won't show a margin until then. Acceptable for V1. A later version could use the Orders API to show recent sales with an *estimated* commission.

**`Amount Type` taxonomy is the main unknown.** The docs confirm the field exists and name a couple of `Transaction Type` values ("Sale", "PaymentSummary") but not the full set. Phase 3 exists specifically to resolve this from a real report rather than guessing. Mitigated by `raw jsonb` + profit-from-`net_settlement`.

**Late-arriving refunds.** Handled by design: append-only rows, margin computed on read.

**Function duration.** The 300s default is ample for a two-week period at your volume. If a full backfill ever exceeds it, the escape hatch is Vercel Workflow (durable, resumable steps) — not a bigger timeout.

**Cost-to-line matching by `Partner Item Id`.** Assumes one cost per SKU per effective date. Multi-pack SKUs priced per unit will need a units-per-pack field; flagged if it comes up.

---

## Open Questions

1. **Do you use WFS (Walmart Fulfillment Services)?** Changes which fee types appear in the report and whether we need to handle WFS storage/fulfillment fees as non-line-level costs.
2. **How far back should the initial backfill go?** All available periods, or a fiscal cutoff?
3. **Any non-US marketplaces?** Plan assumes US only, single currency.

None of these block Phases 0–3.

---

*Sources for the API surface: [Recon Report](https://developer.walmart.com/us-marketplace/docs/recon-report) · [Recon Report JSON](https://developer.walmart.com/us-marketplace/docs/recon-report-json) · [Marketplace payment reports overview](https://developer.walmart.com/us-marketplace/docs/marketplace-payment-reports-overview)*
