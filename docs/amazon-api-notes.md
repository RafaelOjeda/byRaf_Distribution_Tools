# Amazon SP-API notes

**Status: from public documentation only. Nothing below has been
verified against a live account.** Contrast with
[`docs/walmart-api-notes.md`](walmart-api-notes.md), which documents
behavior *observed* against a real seller account - Walmart's own docs
turned out thin or wrong in several places there, and Amazon's SP-API
docs have the same reputation, so treat every line here as a starting
hypothesis to check, not a confirmed fact. See
[`docs/amazon-connector-plan.md`](amazon-connector-plan.md) for what's
blocking that verification (Amazon developer registration).

Once real credentials exist, run `npm run test:amazon` first
(`scripts/test-amazon-connection.ts`), then update this file the way
`walmart-api-notes.md` was built: real calls, real responses, dated.

For the code that (unverified) implements this, see
[`lib/middleware/connectors/amazon/`](../lib/middleware/connectors/amazon/).

## Credentials and auth

- A **self-authorized private app** (Seller Central > Apps & Services >
  Develop apps) gives an LWA Client ID, LWA Client Secret and a Refresh
  Token, plus a Seller ID (Merchant Token) from Account Info.
- **Token:** `POST https://api.amazon.com/auth/o2/token`, standard OAuth2
  refresh-token grant (`grant_type=refresh_token`). This part is
  documented consistently everywhere and is the one piece of this file
  reasonably trusted without live verification - it's LWA, not
  SP-API-specific.
- **Every SP-API call** sends the access token as `x-amz-access-token`.
  **Unverified:** whether AWS SigV4 request signing is still required
  for any of the operations this connector uses. SP-API's 2023 "sunset
  of legacy authorization" is documented as having removed the SigV4
  requirement for most operations, but "most" isn't "all" - confirm
  against the specific endpoints below before assuming none of them need
  it.
- Base host used here: `https://sellingpartnerapi-na.amazon.com` (North
  America). Marketplace ID hardcoded to `ATVPDKIKX0DER` (US) - see
  `docs/amazon-connector-plan.md`, "Marketplace ID is fixed for now".

## Settlements (Finances API)

- **List periods:** `GET /finances/v0/financialEventGroups`. Each
  `FinancialEventGroupId` is treated as a settlement period.
  **Unverified:** the exact required/optional query parameters (this
  code sends `FinancialEventGroupStartedAfter` and
  `MaxResultsPerPage`), and whether groups page via `NextToken` the way
  assumed here.
- **Fetch one period:** `GET /finances/v0/financialEventGroups/{id}/financialEvents`,
  paged via `NextToken`. Returns several event list types; this code
  only reads `ShipmentEventList`, `RefundEventList`,
  `ServiceFeeEventList` and `AdjustmentEventList`.
  **Unverified:** whether a typical account produces meaningful money in
  any of the *other* event list types SP-API defines (chargebacks,
  guarantee claims, ...) that this code doesn't read yet - if so, that
  money is invisible today rather than miscategorized, a different
  failure mode than Walmart's catch-all `otherFees` (see
  `connectors/amazon/normalize.ts`).
- **Fee categorization** (`ChargeType`/`FeeType` -> revenue / commission /
  shipping / tax / otherFees) is a best guess from documented type
  names (`Principal`, `Commission`, `FBA*` fees). **Unverified:** the
  complete list of type strings a real account actually produces.
- **Refunds:** `RefundEventList` is assumed to carry the same shape as
  `ShipmentEventList`, either under `ShipmentItemList` or
  `ShipmentItemAdjustmentList` - the code checks both. **Unverified**
  which one (or something else entirely) a real refund event uses.
- **Alternative not built:** the Reports API's flat-file settlement
  report types (closer to Walmart's recon-report shape). The Finances
  API was chosen as the primary candidate because it's JSON-native with
  no report-generation/polling delay, but if it turns out to be missing
  fee categories the flat file has, that's the fallback - see
  `docs/amazon-connector-plan.md`.

## Orders

- `GET /orders/v0/orders?MarketplaceIds=...&CreatedAfter=...`, paged via
  `NextToken`. Then `GET /orders/v0/orders/{id}/orderItems` per order for
  line items (`SellerSKU`, `QuantityOrdered`, `ItemPrice`).
- **No fees on this endpoint** - same as Walmart's Orders API, fees are
  only known once settled, so recent orders are fee-estimated from
  settled history.
- **Never requests buyer PII.** The basic order object doesn't include
  buyer name/address/email; those need an explicit Restricted Data
  Token, which this connector never asks for.
- `FulfillmentChannel` (`AFN` = Amazon-fulfilled / FBA, `MFN` =
  merchant-fulfilled) is a documented field on the order object but
  **not currently read** by `normalize.ts` - display-only column,
  cosmetic, see `docs/amazon-connector-plan.md`.
- **Unverified:** rate limits, exact pagination behavior, and whether
  `OrderStatus` values beyond `"Canceled"` need special handling the way
  Walmart's cancelled-line filtering does.

## Stock (FBA Inventory API)

- `GET /fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=<marketplaceId>&marketplaceIds=<marketplaceId>&details=true`,
  paged via `nextToken`. Returns `sellerSku`, `totalQuantity`,
  `inventoryDetails.fulfillableQuantity`,
  `inventoryDetails.reservedQuantity.totalReservedQuantity`.
- **FBA only.** There is no equivalent live-count API for
  merchant-fulfilled (MFN) stock - the closest is the *listed* quantity
  on the Listings Items API, which is self-reported and goes stale (like
  Walmart's `inputQty` quirk), so MFN stock is not surfaced from Amazon
  at all today; only the purchased-minus-sold pool represents it. See
  `docs/amazon-connector-plan.md`'s stock-pooling section.

## Listings (price and publish status)

- **No single "every SKU" endpoint** like Walmart's `/v3/items`. Each SKU
  needs its own call: `GET /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=...&includedData=summaries,attributes`.
  This code seeds the SKU list from FBA inventory results, which misses
  any merchant-fulfilled-only SKU with zero FBA stock - **unverified**
  whether that gap matters in practice.
- **Price** is read from `attributes.purchasable_offer[0].our_price[0].schedule[0].value_with_tax`
  (falling back to `.value`). This is the least confident mapping in the
  whole connector - Amazon's own documentation is inconsistent about the
  `purchasable_offer` attribute shape across API versions. **Confirm
  live before trusting this number at all.**
- **Status:** `summaries[0].status` is an array (e.g.
  `["BUYABLE","DISCOVERABLE"]` for a sellable listing). Mapped to the
  literal string `"PUBLISHED"` when it includes `"BUYABLE"`, to match
  the engine's `publishedStatus === "PUBLISHED"` check (Walmart's own
  vocabulary) - **unverified** what an unpublished/suppressed Amazon
  listing's status array actually contains.

## Still unverified (essentially everything)

Unlike Walmart's notes, where this section lists a handful of edge
cases, here it's nearly the whole file - repeated for visibility:

- Whether SigV4 signing is needed for any operation above
- The Finances-vs-Reports-API choice for settlements
- The complete `ChargeType`/`FeeType` vocabulary and whether any
  unread financial event list carries real money
- Refund event shape (`ShipmentItemList` vs `ShipmentItemAdjustmentList`)
- Rate limits and backoff behavior for every endpoint
- The Listings Items API's price attribute path
- Whether FBA-inventory-derived SKU seeding misses real listings
- Pagination token behavior (`NextToken`/`nextToken`) end-to-end
