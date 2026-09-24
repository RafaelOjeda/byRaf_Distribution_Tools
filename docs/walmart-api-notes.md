# Walmart Marketplace API notes

What the Walmart Marketplace API actually does, as observed against a live seller account. Walmart's public docs are thin or wrong in several places below, so most of this was found by making real calls and reading the responses and error messages. Where something is still unconfirmed it is marked **unverified**.

Last verified: 2026-09-24. All calls use the US marketplace host `https://marketplace.walmartapis.com`.

For the code that uses these, see [`lib/walmart/`](../lib/walmart/).

## Credentials and headers

- API keys (a Client ID and Client Secret) come from **Walmart Seller Center** (seller.walmart.com). `developer.walmart.com` is documentation only.
- There is no "sign in with Walmart". The keys use the `client_credentials` grant, so they are machine credentials, not a user login.

**Token:** `POST /v3/token`

| | |
|---|---|
| `Authorization` | `Basic base64(clientId:clientSecret)` |
| `Content-Type` | `application/x-www-form-urlencoded` |
| `Accept` | `application/json` |
| `WM_SVC.NAME` | any string naming your integration |
| `WM_QOS.CORRELATION_ID` | a fresh UUID per request |
| body | `grant_type=client_credentials` |

The response has `access_token` and `expires_in` (900 seconds).

**Every other call** authenticates with a custom header, **not** `Authorization: Bearer`:

```
WM_SEC.ACCESS_TOKEN: <access_token>
WM_SVC.NAME: <integration name>
WM_QOS.CORRELATION_ID: <uuid>
Accept: application/json
```

## Settlement (reconciliation) reports

### List periods

`GET /v3/report/reconreport/availableReconFiles?reportVersion=v1`

```json
{ "availableApReportDates": ["MMDDYYYY"] }
```

- The field is `availableApReportDates`. The docs never state this.
- `v1` is the only valid `reportVersion`; `v2` returns `404 INVALID_REPORT_VERSION`.
- The list is empty until a settlement period has closed, which takes about two weeks after the first sales. An empty list is account state, not an integration error. Seller Center's own Payments reports show the same.

### Fetch one period

`GET /v3/report/reconreport/reconFileJson?reportDate=MMDDYYYY&offset=0&noOfRecords=1000`

- All three parameters are required. None are documented; they were found from the API's own "required parameter is not present" errors.
- Response: `{ reportData: [...], nextOffset, totalRecords, description }`. **Paging ends when `nextOffset` is `-1`.**

### What a row is

Each `reportData` row is one **money line**, not one order. An order line is spread across several rows:

| Transaction Type | Amount Type | Meaning |
|---|---|---|
| `Sale` | `Product Price` | revenue |
| `Sale` | `Product tax` / `Product tax withheld` | tax collected and withheld; cancels to zero |
| `Sale` | `Commission on Product` | Walmart's commission (negative) |
| `Adjustment` | `Fee/Reimbursement` | catch-all fee; shipping label charges appear here |
| `PaymentSummary` | (blank) | account-level deposit summary; no order number |

Things worth knowing:

- **Fulfillment channel is a real field**, `Fulfillment Type` (`Seller Fulfilled` seen so far). It does not need to be inferred from fee types. The WFS value has not appeared yet in observed data.
- **Shipping label cost** for labels bought through Walmart lands as an `Adjustment` / `Fee/Reimbursement` row with the description `Walmart Shipping Label Service Charge`. Match shipping on the description, not the Amount Type.
- **The effective commission rate differs from the listed rate** on some products (an incentive program), so a flat category rate would be wrong. Compute it from revenue and commission actually charged.
- **Reconciliation holds:** revenue + commission + shipping + tax + other, summed over every line in a period, equals the `PaymentSummary` row's `Total Payable` to the cent.
- **Dates** (`Transaction Posted Timestamp`) are `MM/DD/YYYY`, and are the *settlement posting* date, about two days after the order.
- Rows with no `Purchase Order #` do not belong to an order line. `PaymentSummary` is one. WFS storage fees are expected to arrive the same way (**unverified**, none observed).
- Refunds and returns: **unverified**, none observed yet.

## Orders

`GET /v3/orders?createdStartDate=YYYY-MM-DD&limit=N`

Returns orders as soon as they are placed, including ones that have not settled, so they are the only source for recent sales.

- Shape: `list.elements.order[]`, with `list.meta.nextCursor` for paging.
- Each order has `purchaseOrderId`, `orderDate` (epoch milliseconds), `shipNode.type`, and `orderLines.orderLine[]` with `lineNumber`, `item.sku`, `item.productName`, `orderLineQuantity.amount`, `charges.charge[]` and `orderLineStatuses.orderLineStatus[]`.
- Statuses seen: `Shipped`, `Delivered`, `Cancelled`. A line can carry a mix.
- **Only the product price is present.** Commission and shipping are not on an order until it settles, so they can only be estimated beforehand.
- **Contains customer PII** (name, address, email). Reduce it to line-level numbers on the server and never send the raw order to a browser.
- Cursor form (appended to the base URL): **unverified**. The test account had fewer orders than one page.
- **Line numbers disagree with the settlement report** for the same order (line 2 in one, line 1 in the other). Join the two sources on Purchase Order # **plus SKU**, never on line number.
- `chargeAmount` is assumed to be the line total. Every observed line has quantity 1, so this is **unverified** for larger quantities.

## Shipping labels

`GET /v3/shipping/labels/purchase-orders/{purchaseOrderId}` works and returns the carrier, service type and tracking number. It returns **no cost**, so label cost cannot be known before settlement.

## Inventory

`GET /v3/inventories?limit=N`

- **`limit` maxes out at 50** (`INVALID_REQUEST_PARAM` above that), unlike other endpoints.
- **Paging:** `meta.nextCursor` is an opaque token, sent back as the **`nextCursor` query parameter**. Appending it to the URL 404s, and a parameter named `cursor` is silently ignored and returns page 1 again. Every page must repeat the same `limit` or the cursor is rejected as invalid or expired. Verified by forcing tiny page sizes on a small account.
- **`inputQty` is not an on-hand count.** It is the quantity the seller last told Walmart they have, and it does not drop as units ship. A product that has sold through can still read a positive `inputQty` while `availToSellQty` is 0. The stock still in hand is **`availToSellQty + reservedQty`**.
- This endpoint covers **seller-fulfilled stock only.** WFS stock is separate (`GET /v3/fulfillment/inventory`, with `onHandQty` per ship node). It was probed once and is not used yet.

## Catalog (listed prices)

`GET /v3/items?limit=N&nextCursor=*`

Used for each SKU's currently listed price (`price.amount`) and `publishedStatus`. `PUBLISHED` is sellable; `SYSTEM_PROBLEM` means the listing has been pulled, for example for a policy violation.

Paging is the least intuitive of the four:

- **Offset paging is unsafe.** The item order changes between calls, so `offset=3` and `offset=6` can return the same SKU and skip others.
- **A cursor is only returned if the first request asks for one** with `nextCursor=*`. Without it the response has no `nextCursor` at all, whatever the page size.
- Each response's `nextCursor` goes back as the `nextCursor` parameter, with the same `limit` (at least 500 is accepted).
- **The end of data is a `404 CONTENT_NOT_FOUND`, not an empty page.** When the last page fills exactly, Walmart still returns a cursor and the next request 404s. Treat that one specific error as "done" and let every other error fail loudly.

## Cross-cutting gotchas

- **SKU casing differs between endpoints.** The inventory and catalog APIs can return `Jurassic-World-001` where the settlement report says `JURASSIC-WORLD-001`. Normalize case on every SKU-keyed lookup, or one product silently becomes two.
- **Settlement lags sales by about two weeks.** Sales in the most recent period have no fees on any report yet.
- **Cancelled orders never appear on a settlement report.**
- **Do not trust an empty-looking or partial response as complete.** Two of the paging bugs above (inventory over 50 SKUs, and catalog end-of-data) only showed up by deliberately forcing multiple pages on a small account. Any new paged endpoint should be tested that way.

## Still unverified

- Refund and return rows in the settlement report
- WFS `Fulfillment Type` value, WFS fee types, and WFS storage fee rows
- The Orders API cursor form, and `chargeAmount` semantics for quantities above 1
- Inventory paging past 50 SKUs on a real account (verified only with small forced pages)
