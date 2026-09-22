# byRaf Distribution Tools

Internal tools for BYRAF Distribution.

## Projects

- **Walmart Seller Margin Tracker** — pulls sales and fees from the Walmart Marketplace Reconciliation Report, combines them with manually entered SKU costs, and displays true profit margin per item. Self-hosted alternative to paid tools like Sellerboard or SellerApp. See [walmart-margin-tracker-plan.md](walmart-margin-tracker-plan.md) for the full plan.

## Stack

Next.js (App Router) on Vercel, Neon Postgres via the Vercel Marketplace, Drizzle ORM.

## Getting Started

```bash
npm install
npm run dev
```

`npm run build` succeeds without a database or Walmart API keys — `/costs` and `/margins` are `force-dynamic` (DB-backed) so they render empty/error at request time rather than failing the build, but they need both to actually work:

1. Provision: `vercel link`, `vercel integration add neon`, enable Vercel Authentication, add `WALMART_CLIENT_ID` / `WALMART_CLIENT_SECRET` / `CRON_SECRET` as env vars, `vercel env pull`.
2. `npm run db:push` to apply the schema in [lib/db/schema.ts](lib/db/schema.ts).
3. Once Walmart keys are set, use "Sync Now" in the header (or `POST /api/sync/walmart`) to backfill.

**Status against the plan:** Phases 0–6 are code-complete (ingestion, margin calc, Costs and Margins UI, manual sync + daily cron via `vercel.ts`). The `Amount Type`/`Transaction Type` classification in [lib/margin.ts](lib/margin.ts) is provisional — Phase 3 calls for reading the real distinct values from a synced period (`getDistinctAmountTypes` in [lib/db/queries.ts](lib/db/queries.ts)) and correcting it; nothing has been run against the live API yet.
