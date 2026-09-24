# Walmart Seller Margin Tracker — V1 Plan

## Current Build: Stateless MVP (status as of 2026-09-24)

**What is deployed deliberately deviates from the persisted design in the rest of this document.** This section is the current truth; for a user-facing description see the [README](README.md), and for verified Walmart API behavior see [docs/walmart-api-notes.md](docs/walmart-api-notes.md).

### What is live

- **No login, no database use.** Vercel Authentication was enabled and then explicitly turned back off (2026-09-23). The pasted API key is the access control; anyone with the URL can open the app but sees only the data of the credentials they paste in.
- **Flow:** paste Client ID and Secret, pick which settlement reports to load, then a dashboard styled after Seller Central (design language only, no Amazon branding; light mode only, by choice, 2026-09-24). Summary tiles (revenue, units, net after fees, profit, stock value) above five tabs: by SKU, order lines, price over time (line chart), inventory and costs, stock value. By SKU and order lines export to CSV.
- **Profit is never shown for a line with no cost entered** — tiles, cells and totals show "—". Before the redesign the tables showed a profit that assumed cost = 0; the new Profit tile made the contradiction visible side by side, so all views now follow the rule the CSV export already used.
- **Everything is live and ephemeral.** Server actions in `app/(dashboard)/margins/actions.ts` are the only code that sees credentials. Credentials and results exist only for the request and the browser tab. Nothing is written to Neon; the `sku_costs`, `walmart_recon_rows` and `sync_runs` tables from Phase 0/1 exist but are unused.
- **Recent orders are included as estimates.** Orders not yet on a settlement report show as "Est." rows: revenue is exact, commission and shipping are projected from each SKU's settled history, and a SKU with no history shows "no estimate" rather than a guessed rate. Settled and estimated totals are always kept separate.
- **Costs are purchase batches**, not one number: quantity × price each, averaged by quantity, because the same item is bought at different prices. Batches record what was paid *including for units already sold*, so they legitimately exceed current stock. The stock check is therefore a reconciliation (`purchased − sold` vs. Walmart's on-hand count, amber on mismatch, never blocking), not a cap. A cap would have been unusable: a product with many units sold and few left could not even have its first batch entered.
- **Stock value** is on-hand × average cost and on-hand × listed price. "Current price" comes from the catalog, not last sale price, because most stocked SKUs have never sold. A missing figure is blank, never $0, and totals state how many SKUs they cover. Unpublished listings show their price but are left out of the at-price total, since that stock cannot sell.
- **Price over time** places every sale on its real order date (Orders API, last 60 days); older settled lines fall back to the settlement posting date, which runs about two days after the sale, and are counted so the approximation is visible.
- **CSV export** leaves unknown cells blank rather than 0: lines whose fees cannot be estimated carry placeholder zeros internally, and a line with no cost entered would otherwise export a profit that silently assumed cost = 0.

### Trade-offs this accepts

- Costs must be re-entered every session; there is no bulk import.
- Every load re-fetches the selected settlement history plus orders, inventory and catalog. Fine at current volume, not at years of history, and there is no backfill checkpointing.
- No refund/adjustment reconciliation across periods (none have been observed to design against).
- WFS stock and WFS storage fees are not surfaced.
- Estimated shipping is an average; Walmart does not expose label cost before settlement.

### Deferred until the app becomes stateful

Decided 2026-09-24: persistence is coming, so workarounds for statelessness are not worth building first.

- **Persistence itself** (the user likes this feature and wants it later). Save only what the user types: purchase batches, box cost and dimensions. Walmart data stays live. Needs a lots table, since `sku_costs` holds one cost per SKU. **Open design question: who owns saved data**, given there is no login and other sellers may use the app. Recommended, not yet chosen: key it by a hash of the Client ID + Secret already pasted each visit (no new login; catch: rotating the secret orphans saved data). Alternatives: a real login, or Vercel Authentication back on for one user.
- **WFS storage fee rollup** — a correctness gap, not a nicety. `groupReconRows` in `lib/margin.ts` skips rows with no `Purchase Order #`, which is how WFS storage fees are expected to arrive, so once WFS activity appears those costs would silently vanish from the dashboard. Current data is all seller-fulfilled, so nothing is wrong yet.
- **CSV import** of costs and box dimensions.

### Where the original phases stand

The phases below describe the persisted design. Their *work* has mostly been done statelessly.

| Phase | Status |
|---|---|
| 0 Provision (Vercel, Neon, env vars) | Done |
| 1 Skeleton (Next.js, schema, pages) | Done |
| 2 Prove connectivity | Done |
| 3 Ingest raw, then look | Done statelessly: real field values inspected, nothing stored |
| 4 Classify + margin calculation | Done in `lib/margin.ts` (in memory, no query layer) |
| 5 Costs UI | Done as purchase batches, not persisted, no CSV import |
| 6 Margins UI | Done (by SKU, order lines, chart, stock value, CSV export); no WFS fee panel |
| 7 Automate (backfill, daily cron) | Not started; belongs with persistence |

---

## What We're Trying to Build

> **Everything from here down is the original persisted-architecture design (the V1 plan), kept as the roadmap.** Where it disagrees with "Current Build" above, "Current Build" is what is actually running.

Walmart Marketplace has no built-in way to enter what you paid for an item, so there's no native profit margin view — you only see your selling price and fees separately. This tool closes that gap for BYRAF Distribution's Walmart sales.

1. **Pull every sold item and its fees automatically** from the Walmart Marketplace API, using the Reconciliation Report as the source of truth (it already contains sale price and every associated fee per order line).
2. **Let you enter your cost per SKU** — manually or by CSV — since this data doesn't exist anywhere on Walmart's side.
3. **Calculate true profit margin per item** by combining Walmart's revenue/fee data with your cost data.
4. **Display it in a simple interface** — one table to manage costs, one to view margins.

Walmart-only for V1. Amazon (which has a native cost field) is out of scope and may become a second data source later.

**You fulfill both ways — WFS and self-fulfilled — and that matters for accuracy, not just scope.** For WFS orders, Walmart's fees cover the whole fulfillment cost, so the recon report alone gives a true margin. For self-fulfilled orders it's true too, but only because you buy shipping labels *through Walmart* (confirmed below) — that label cost lands on the settlement report as a fee, same as WFS. If that ever changes (an external carrier account, a label tool like ShipStation), self-fulfilled margins would start reading too high with no warning, since nothing would flag the missing cost. Worth remembering if the label-buying habit changes.

---

## Stack Decisions

Deployed as a **single Vercel project**. Three changes from the original plan, each with a reason:

| Original | Now | Why |
|---|---|---|
| FastAPI backend + separate Next.js frontend | **Next.js App Router only** (Route Handlers + Server Actions) | One repo, one deploy, one domain, no CORS, no second host to pay for. The backend work here is "call an API, parse JSON, write rows" — it needs no Python. |
| SQLite | **Neon Postgres** via Vercel Marketplace, with Drizzle ORM | Vercel's filesystem is ephemeral — a SQLite file is wiped on every deploy and not shared between function instances. Neon provisions through the Marketplace and injects `DATABASE_URL` automatically. |
| AWS | **Vercel** | Cron, secrets, and access control are all built in. |

**Access control: Vercel Authentication (deployment protection).** Worth being explicit, because this was an open question.

> **Superseded 2026-09-23: Vercel Authentication was later switched off** and the pasted API key became the access control (see "Current Build"). The reasoning below still applies if a login is ever reinstated, and the verification lesson at the end of this section applies to any protection change.

The Walmart Marketplace API uses `grant_type=client_credentials` — machine-to-machine. There is no "Sign in with Walmart" identity provider, so the Client ID + Secret are *server-side app secrets*, not user credentials. Our backend holds them and acts as the seller account on every call; nobody logs in "as" the seller.

That leaves the app itself ungated, and the sensitive dataset here is **your supplier cost per SKU** — the one thing not already on Walmart's side. Vercel Authentication restricts the deployment to your Vercel account: zero code, zero cost, one toggle, swappable for Clerk if teammates ever need in.

✅ **Enabled, 2026-09-23**, scope `all` (via the Vercel API — `ssoProtection.deploymentType`). Worth recording exactly how this went, since the first attempt looked done but wasn't:

The CLI's `vercel project protection enable --sso` only sets `deploymentType: "prod_deployment_urls_and_all_previews"` ("Standard Protection" in the dashboard) — which, despite the name, does **not** cover the assigned production domain alias (`by-raf-distribution-tools.vercel.app`), only the raw per-deployment URLs and previews. After enabling it and deploying, a plain unauthenticated `curl` to the production URL returned `200` — the app, including the costs page, was genuinely public. Caught by testing the actual URL rather than trusting the CLI's confirmation. Fixed by setting `deploymentType: "all"` directly via `vercel api` (the CLI has no flag for this scope); re-verified with curl afterward — confirmed redirecting to `vercel.com/sso-api` on the real production URL.

**Takeaway kept for later:** after any deployment-protection change, verify with an actual unauthenticated request to the real URL being used — not just the command's own success output.

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

### Fulfillment Channel (WFS vs. Self)

Walmart's row-level fields (confirmed in the docs) don't include an explicit "fulfillment channel" flag. Rather than guess, **channel is derived from which fee types show up on a line**: if any row in the group has a WFS-specific `Amount Type`/`Transaction Type` (e.g. a WFS fulfillment or pick-and-pack fee — exact strings confirmed in Phase 3 against a real report), the line is `wfs`; otherwise `self`. This is computed in the margin query, not stored — a line's channel is a property of its fee rows, not something we assign upfront.

**WFS storage fees are account-level, not order-level**, and will arrive with no `Purchase Order #` at all — they're billed monthly per SKU held in inventory, not per sale. Grouping by `(purchase_order_no, purchase_order_line)` would either drop these rows or dump them into one meaningless null-group. V1 handles this explicitly: rows with a null `purchase_order_no` are excluded from the per-line margin query and rolled up separately into a monthly **per-SKU storage cost** view — visible, but not allocated into any single order's margin. Folding storage cost into per-unit margin is a real V2 improvement (e.g. amortized across that SKU's units sold that month) but adds a second allocation model V1 doesn't need yet.

### Margin Calculation

A **derived query, not a stored table.** Refunds and adjustments for a sale routinely land in a *later* settlement period, so any stored margin would go stale the moment a refund arrives. Computing on read means late-arriving rows are automatically reflected.

Group by `(purchase_order_no, purchase_order_line)` where `purchase_order_no is not null`:

```
fulfillment_channel = 'wfs' if any row's amount_type/transaction_type is WFS-specific, else 'self'

net_settlement = SUM(amount)                       -- every row for the line, all periods
gross_revenue  = SUM(amount) WHERE amount_type IN (<revenue types>)
total_fees     = net_settlement − gross_revenue

unit_cost      = latest sku_costs row for that SKU where effective_from <= order date
profit         = net_settlement − (unit_cost × ship_qty)
margin         = profit / gross_revenue
```

One useful property falls out of this: because `net_settlement` sums *everything*, **profit is correct even if we misclassify a fee type** — including getting `fulfillment_channel` wrong. Only the margin *percentage* and the channel label depend on classification; the dollar profit doesn't. So profit works from day one and both get refined as we learn the real `Amount Type` taxonomy.

Order lines with **no matching cost row are flagged**, never shown as 100% margin. `fulfillment_channel` is shown as its own column so you can sanity-check WFS vs. self-fulfilled margins separately — since only self-fulfilled margins currently depend on the "labels bought through Walmart" assumption above.

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

✅ **Done, 2026-09-23.** Linked to `by-raf-distribution-tools`; Neon connected and schema pushed (all 3 tables live); `DATABASE_URL` + both Walmart vars set consistently across Development/Preview/Production; Vercel Authentication enabled with correct `all` scope (see above — the CLI's default scope silently missed the production domain, caught by testing the live URL). Global install of the CLI hit an EACCES permissions error on the system Node install — used `npx vercel` throughout instead of fighting it.

The project turned out to already be connected to GitHub (`productionBranch: main`, auto-deploy enabled) from when it was first created — not obvious from `vercel project inspect`'s summary view, only from the raw API response. Confirmed for real by matching a deployment's commit SHA to a git push. **So: no manual `vercel deploy` needed going forward — every push to `main` deploys to production automatically.** First production deploy is done.

**Phase 1 — Skeleton.** Next.js + TypeScript + Tailwind, Drizzle schema, first migration, both pages stubbed. Deploy. Confirms the whole pipeline works before any Walmart logic exists.

**Phase 2 — Prove connectivity.** Token fetch + `availableReconFiles`, surfaced as a list of dates in the UI. This is the smallest possible real API call; it validates credentials, headers, and correlation IDs in isolation. **Hard gate on Walmart keys** — everything before this runs without them.

✅ **Done, 2026-09-22.** Token exchange and the `WM_SEC.ACCESS_TOKEN` header both work. One correction to this plan came out of it: the response field is `availableApReportDates`, not `reportDates` — Walmart's docs never actually stated the real name. Current result is `[]` (empty), confirmed **not** an integration bug: `v1` is the only valid `reportVersion` (`v2` errors outright with `INVALID_REPORT_VERSION`), and Seller Center's own Reports UI shows zero reconciliation reports too. So this is upstream account-state — no settlement period has produced a report yet — not something to debug further on our end. Re-run `npm run test:walmart` periodically; Phase 3 starts the moment it returns a non-empty list.

**Phase 3 — Ingest raw, then look.** Pull one period, follow `nextOffset`, write to `walmart_recon_rows`. Then **inspect the actual distinct `Amount Type` and `Transaction Type` values** — including which ones are WFS-specific (for channel detection) and confirming storage fees really do arrive with a null `Purchase Order #` as expected. No classification logic is written before this point — writing it first means guessing at a taxonomy we can simply read.

**Phase 4 — Classify + margin query.** Now informed by real values: revenue/fee classification and WFS-vs-self detection in `margin.ts`, margin query (incl. the separate account-level storage-fee rollup) in `queries.ts`. Unit-test the calc against one hand-checked WFS line and one hand-checked self-fulfilled line.

**Phase 5 — Costs UI.** Editable table (Server Actions) + CSV import with a preview-before-commit step and per-row validation.

**Phase 6 — Margins UI.** Date filter, sort by profit/margin, `fulfillment_channel` shown as a column and filter, visible "missing cost" flag, a small separate panel for monthly WFS storage fees, CSV export.

**Phase 7 — Automate.** Backfill **every period `availableReconFiles` returns** — full history, no cutoff. Loop period-by-period, writing a `sync_runs` row per period so a failed or interrupted backfill resumes from the last completed period instead of restarting. Then daily cron in `vercel.ts`. `sync_runs` also guards against overlapping runs.

Phases 0–2 are a short evening. Phase 3 is where real information arrives.

---

## Risks and Known Limitations

**Settlement lag (accepted).** Fees only appear once a settlement period closes — roughly every two weeks — so your most recent sales won't show a margin until then. Acceptable for V1. A later version could use the Orders API to show recent sales with an *estimated* commission.

**`Amount Type` taxonomy is the main unknown.** The docs confirm the field exists and name a couple of `Transaction Type` values ("Sale", "PaymentSummary") but not the full set. Phase 3 exists specifically to resolve this from a real report rather than guessing. Mitigated by `raw jsonb` + profit-from-`net_settlement`.

**Late-arriving refunds.** Handled by design: append-only rows, margin computed on read.

**Function duration.** The 300s default is ample for *one* settlement period at your volume — but "backfill to the beginning" means looping over however many periods `availableReconFiles` has, which could be years of them. Phase 7's per-period `sync_runs` checkpointing exists specifically so this loop can run as repeated short invocations instead of one long one. If a single period ever grows large enough to threaten the timeout on its own, the escape hatch is Vercel Workflow (durable, resumable steps) — not a bigger timeout.

**Report retention is unverified.** Nothing in the docs states how far back `availableReconFiles` actually goes — Walmart may not retain reconciliation reports indefinitely. "The beginning" means whatever that endpoint returns; Phase 2 (the first real API call) will reveal the actual retention window. If it's shorter than your full sales history, older periods are simply unrecoverable from this API — worth knowing early rather than assuming.

**Cost-to-line matching by `Partner Item Id`.** Assumes one cost per SKU per effective date. Multi-pack SKUs priced per unit will need a units-per-pack field; flagged if it comes up.

**Mixed fulfillment (WFS + self).** Channel is *inferred* from fee-type presence per line, not asserted by Walmart directly — confirmed against real data in Phase 3, but worth re-checking if a margin's channel label looks wrong. Self-fulfilled margin accuracy is contingent on labels staying purchased through Walmart, per the note above; if that changes, self-fulfilled numbers will silently read high until a shipping-cost input is added. WFS storage fees are tracked but not yet allocated into any order's per-unit margin (V1 shows them separately, see above).

---

## Scope, Confirmed

- **Backfill: full history.** Every period `availableReconFiles` returns, no fiscal cutoff — see Phase 7 and the retention-window risk above.
- **US only, single currency.** No other markets to account for.

---

*Sources for the API surface: [Recon Report](https://developer.walmart.com/us-marketplace/docs/recon-report) · [Recon Report JSON](https://developer.walmart.com/us-marketplace/docs/recon-report-json) · [Marketplace payment reports overview](https://developer.walmart.com/us-marketplace/docs/marketplace-payment-reports-overview)*
