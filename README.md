# byRaf Distribution Tools

Internal tools for BYRAF Distribution.

## Walmart Seller Margin Tracker

Walmart Marketplace shows a seller their sale price and their fees, but has no place to enter what an item *cost*, so there is no real profit margin anywhere. This tool pulls sales, fees, inventory and prices from the Walmart Marketplace API, lets you enter your purchase costs, and shows true profit and margin per order and per product. It is a free, self-hosted alternative to paid tools like Sellerboard.

**Live:** https://by-raf-distribution-tools.vercel.app/margins

### How it works

1. **Paste your Walmart API credentials** (Client ID and Secret, from Seller Center). Nothing is saved.
2. **Pick which settlement reports to load.** These are the same periodic reports Walmart shows under Payments in Seller Center.
3. The page pulls everything live into a dashboard styled after Seller Central (the design language only; no Amazon branding). A row of summary tiles sits at the top: revenue, units sold, net after fees, profit and stock value. Below them, tabs switch between five views:

| Tab | What it shows |
|---|---|
| **By SKU** | One row per product: units, average price, revenue, commission, shipping, shipping % of revenue (amber above 15%, red above 25%), net, cost, profit, margin. |
| **Order lines** | One row per order line with revenue, commission, shipping, other fees, net, cost, profit and margin, plus settled and estimated totals. |
| **Price over time** | A line chart of average selling price per unit by order date, one line per product, with a tooltip, keyboard support and a table view. |
| **Inventory & costs** | Every SKU you stock, with on-hand count. Enter purchase batches (quantity × price each) and box cost and dimensions by hand, or **import a CSV** (and export the current ones, which doubles as a fill-in template). Average cost is quantity-weighted across batches. "Left" (bought − sold) turns amber when it disagrees with Walmart's count. |
| **Stock value** | Units on hand at your average cost and at the listed price, with totals that say how many SKUs they cover. |

By SKU and Order lines each have a **Download CSV** button. The app is light-mode only.

**Mobile first.** On a phone, every table becomes a list of cards showing all of its figures, with no sideways scrolling; the tables take over from tablet width (768px) up. The price chart redraws at the phone's real width so its text stays readable, and tapping it shows the tooltip across the chart.

**Profit is never shown for a product with no cost entered.** Tiles, table cells and totals show "—" instead, because a profit that assumed the item was free would look real.

### Settled vs. estimated

Walmart only reports fees once a settlement period closes, about two weeks after a sale, so the most recent orders have no fees yet. The page handles this in two ways:

- **Settled** lines use exact figures from a settlement report.
- **Estimated** ("Est.", italic) lines are recent orders not yet settled. Revenue is exact; commission and shipping are projected from that product's settled history. A product with no settled history shows "no estimate" rather than a guessed rate.

Settled and estimated totals are always shown separately, never blended.

### Privacy and security model

- **Nothing is stored.** No database is used. Credentials and all fetched data live only in your browser tab and the single server request that needs them. Refresh and it is gone, including anything you typed.
- **The API key is the access control.** There is no login. The app itself is public, and it shows data only for whichever credentials are pasted in. This was a deliberate choice; Vercel Authentication is switched off.
- **Credentials are used per request and never cached or logged** server-side. Token fetching is deliberately not shared between requests, so one seller's session can never reach another's. Note that Next.js's *dev* server prints every server-action call with its arguments by default, which would print the Client Secret; `next.config.ts` turns that off (`logging.serverFunctions: false`). Production never logged them — verified with fake credentials against `next start`.
- **Customer data stays on the server.** Walmart's orders include customer names and addresses. Only derived line-level numbers (SKU, quantity, amounts, date) are sent to the browser.
- **CSV exports guard against formula injection.** Text starting with `=`, `+`, `-` or `@` is prefixed so a spreadsheet cannot run it as a formula.

### Known limitations

- **Costs are re-entered every session**, since nothing is saved. CSV import (Inventory & costs tab) makes bulk re-entry fast; saving them for good is the planned next step.
- **Every page load re-fetches** the selected settlement history plus orders, inventory and catalog. It is quick at current volume but does not scale to years of history.
- **WFS stock is not included** in inventory or stock value, and WFS storage fees are not surfaced yet.
- **Refunds and returns are not handled** (none have been observed to design against).
- Shipping shown on estimated lines is an average, not the actual label cost. Walmart does not expose label cost before settlement.

See [walmart-margin-tracker-plan.md](walmart-margin-tracker-plan.md) for design decisions and the roadmap, and [docs/walmart-api-notes.md](docs/walmart-api-notes.md) for what the Walmart API actually does. Support for more marketplaces (Amazon, then eBay) in one dashboard, behind a middleware layer the dashboard talks to instead of any marketplace, is planned in [docs/multi-marketplace-plan.md](docs/multi-marketplace-plan.md).

## Development

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4. Deployed on Vercel; every push to `main` deploys to production.

> This is not the Next.js you may know: version 16 has breaking changes. See [AGENTS.md](AGENTS.md), and read `node_modules/next/dist/docs/` before writing framework code.

```bash
npm install
npm run dev        # http://localhost:3000/margins
```

**No configuration is needed to run the app.** You paste credentials into the page.

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Standard Next.js |
| `npm run lint` | ESLint |
| `npm run test:walmart` | Checks that credentials in `.env.local` can fetch a token and list settlement reports |
| `npm run test:csv` | Fixture checks for the cost CSV import/export parser |
| `npm run db:push` | Applies the Drizzle schema to Neon (unused by the app today, see below) |

Only the scripts read environment variables. Copy [.env.example](.env.example) to `.env.local` and fill in `WALMART_CLIENT_ID` and `WALMART_CLIENT_SECRET`. Never commit `.env.local`; it is gitignored.

If `next build` fails with "Failed to open database" (a corrupted Turbopack cache), delete `.next` and rebuild.

### Project layout

```
app/(dashboard)/margins/
  page.tsx          the page: credential form, report picker, all five sections
  actions.ts        server actions: the only code that touches credentials and Walmart
  PriceChart.tsx    the price-over-time chart (hand-built SVG, no chart library)
lib/
  margin.ts         grouping, estimation, costs, stock value: the core calculations
  prices.ts         price-over-time series
  csv.ts            CSV export
  walmart/          one small client per API (auth, recon, orders, inventory, items)
  db/, drizzle/     Postgres schema for the planned persisted version
docs/walmart-api-notes.md   verified API behavior and gotchas
scripts/                    connectivity check
```

### Persistence (planned, not built)

A Neon Postgres database is provisioned and a schema exists for the original persisted design, but **the running app does not use it.** The intended next step is saving purchase batches and box details. See the plan for the open design question of how saved data would be tied to a seller when there is no login.
