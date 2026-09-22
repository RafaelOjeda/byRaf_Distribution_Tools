# Walmart Seller Margin Tracker — V1 Plan

## What We're Trying to Build

Walmart Marketplace has no built-in way to enter what you paid for an item, so there's no native profit margin view — you only see your selling price and fees separately. The goal of this project is to build a small internal tool that closes that gap for your BYRAF Distribution Walmart sales.

At its core, the tool will:

1. **Pull every sold item and its fees automatically** from Walmart's Marketplace API, using the Reconciliation Report as the source of truth (it already contains sale price and every associated fee per order line).
2. **Let you manually enter your cost per SKU** (what you actually paid to acquire the item), since this data doesn't exist anywhere on Walmart's side.
3. **Calculate true profit margin per item** by combining Walmart's revenue/fee data with your entered cost data.
4. **Display it in a simple interface** — one table to manage costs, one table to view margins — so you can see profitability without exporting spreadsheets or paying for a third-party tool like Sellerboard or SellerApp.

This is scoped as **Walmart-only for V1**. Amazon (which does have a native cost field and profitability dashboard) is intentionally out of scope for now, and may be added as a second data source later once the Walmart pipeline is working.

The end result is a self-hosted, free alternative to paid margin-tracking tools, built on infrastructure you already know (FastAPI, Next.js, AWS).

---

## V1 Scope

**In scope:**
- Walmart sales + fees ingestion via the Reconciliation Report
- Manual cost entry per SKU
- Margin calculation and display

**Out of scope for V1:**
- Amazon integration
- Real-time/recent order estimates (before settlement closes)
- Automated scheduling (manual "Sync" button is fine)

---

## Step-by-Step Plan

### 1. Auth
- Create API keys (Client ID + Secret) in the Walmart Developer Portal.
- Get a token via `POST /v3/token` using Basic auth and `grant_type=client_credentials`.
- Tokens expire in ~15 minutes — cache and refresh as needed.
- Every request needs `WM_SVC.NAME` and `WM_QOS.CORRELATION_ID` headers.

### 2. Pull the Data
- `GET /v3/report/reconreport/availableReconFiles` — lists available settlement dates.
- `GET /v3/report/reconreport/reconFile?reportDate=MMDDYYYY` — downloads one period as a zipped CSV.
- Backfill by downloading all available dates once, then fetch only new dates going forward.

### 3. Parse and Store
- Each CSV row is one **money line**, not one order — expect sale rows, commission rows, WFS fee rows (if applicable), refunds, and adjustments.
- Store raw rows keyed on: order number, line, SKU (Partner Item Id), transaction type, amount type, and amount.
- Group raw rows into one row per order line: revenue, total fees, qty, date.
- Keep the raw rows around — refunds/adjustments often land in a later settlement period than the original sale.

### 4. Costs and Margin
- `costs` table: SKU, unit cost, effective date (so cost changes don't overwrite history).
- Margin formula:
  - `Profit = Revenue − Fees − (Unit Cost × Qty)`
  - `Margin = Profit ÷ Revenue`
- Flag any order line with no matching cost entry, rather than showing a false 100% margin.

### 5. Interface
- **Backend:** FastAPI with a `/sync/walmart` endpoint that triggers the report pull/parse.
- **Database:** SQLite (sufficient for V1 volume).
- **Frontend:** Next.js page with two views:
  - Editable cost table (by SKU)
  - Margins table (filterable by date)

---

## Known Limitation

Fees only appear once a settlement period closes — roughly every two weeks. This means your most recent sales won't show a margin until that period settles. This is acceptable for V1; a later version could use the Orders API to show recent sales with an *estimated* commission before settlement.
