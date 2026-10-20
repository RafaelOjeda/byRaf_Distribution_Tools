# Fee prediction — what isn't done yet

Status as of 2026-10-20, branch `claude/fee-prediction`. How the feature works is in [Engine — Fee prediction](./systems/engine.md#fee-prediction-fee-predictts-fee-fallbackts-fee-calculatorts). This page lists what was agreed but couldn't be finished, so it isn't lost.

## Needs data from the owner

1. **Walmart referral schedule is incomplete and unverified.** `lib/gateway/connectors/walmart/fees.ts` has 7 categories, taken from a search summary of Walmart's page, not from the page. `lastVerified` is `null`, so every prediction is marked low-confidence. Grocery, Baby and the other categories are missing; a SKU in a missing category gets no rate-table prediction. Source: <https://marketplacelearn.walmart.com/guides/Getting%20started/Onboarding/Referral-fee-schedule-for-contract-categories>. To finish: encode the full current schedule (including any minimum fees), then set `lastVerified`. The page couldn't be fetched from the build environment (DNS failure), so the rates need to be pasted in or fetched from a machine that can reach it.
2. **WFS fulfillment rate card is empty.** `managed: null` in the same file, so WFS lines report "not estimated". Walmart's WFS fees page: <https://marketplacelearn.walmart.com/guides/Getting%20started/Walmart%20Fulfillment%20Services%20(WFS)/WFS-fees>. Also encode the billable-weight rule (reported as the greater of unit and dimensional weight, with a packing allowance) and the surcharges, none of which the model has yet.

## Unconfirmed against live data

3. **Catalog category field names.** `walmart/items.ts` reads `shelf` and `productType` from the item response to suggest a fee category. Those names haven't been checked against a live response. If they're wrong the category is just left for the user to pick.
4. **Referral fee base.** Walmart charges the fee on the total sales price including shipping and handling the customer pays. The prediction uses item price only; the calculator says so in a note.

## Not built

5. **Accuracy report (predicted vs. actual).** Costs aren't stored in a database (they live in the browser and the save file), so predictions can't be kept until an order settles. Workable alternative with no storage: a backtest that predicts each settled line as if it were new, leaving that line out of the shipping history, and compares with what settled.
6. **Demo connector fee model.** The demo source has none, so the calculator doesn't list it.
7. **Category field in the inventory UI.** Weight has an input there (`BOX_FIELDS`); category can only be set from the calculator's "Save to SKU" or a file import.
8. **Single-CSV cost import** (`engine/csv.ts`) doesn't carry weight or category; only the portable bundle does.
9. **Other marketplaces.** The `FeeModel` interface and the `feeModel` property on `MarketplaceConnector` are ready; Amazon and eBay tables and shipping models don't exist.

## Deliberately left out

Break-even price and price-for-target-margin in the calculator (only profit and margin were requested).
