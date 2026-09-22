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

The app builds and runs without a database or Walmart API keys — `/margins` and `/costs` are stubbed pending Phase 2+. Once Neon is provisioned (`vercel integration add neon` + `vercel env pull`), run `npm run db:push` to apply the schema in [lib/db/schema.ts](lib/db/schema.ts).
