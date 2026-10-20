import type { FeeModel } from "../../engine/fee-model";

/**
 * Walmart's published fee schedules, for estimating fees on a SKU with no
 * settled history to learn from.
 *
 * NOT YET VERIFIED. lastVerified is null on purpose. The categories below
 * come from a search summary of Walmart's referral schedule, not from
 * reading the page itself (it couldn't be fetched from the build
 * environment on 2026-10-20). Check each rate against the schedule and
 * Seller Center's Statements page, then set lastVerified. Categories the
 * summary didn't give exact figures for (Grocery, Baby, and the rest) are
 * left out rather than guessed: a SKU in an unlisted category gets no
 * rate-table prediction, and says so.
 *
 * The WFS rate card is empty for the same reason, so WFS lines report "not
 * estimated" until it is filled in.
 *
 * Walmart charges the referral fee on the total sales price, which
 * includes shipping and handling charged to the customer, not just the
 * item price.
 */
export const WALMART_FEE_MODEL: FeeModel = {
  sourceId: "walmart",
  sourceLabel: "Walmart",
  managedFulfillmentLabels: ["WFS"],
  referral: {
    sourceUrl:
      "https://marketplacelearn.walmart.com/guides/Getting%20started/Onboarding/Referral-fee-schedule-for-contract-categories",
    lastVerified: null,
    note: "Charged on the total sales price, including any shipping and handling the customer pays.",
    categories: [
      {
        id: "books",
        label: "Books",
        aliases: ["book"],
        mode: "flat",
        bands: [{ upTo: null, rate: 0.15 }],
      },
      {
        id: "consumer-electronics",
        label: "Consumer Electronics",
        aliases: ["electronics"],
        mode: "flat",
        bands: [{ upTo: null, rate: 0.08 }],
      },
      {
        id: "home-kitchen-decor-garden",
        label: "Home, Kitchen, Decor & Garden",
        aliases: ["home", "kitchen", "decor", "garden"],
        mode: "flat",
        bands: [{ upTo: null, rate: 0.15 }],
      },
      {
        id: "automotive-powersports",
        label: "Automotive & Powersports",
        aliases: ["automotive", "powersports"],
        mode: "flat",
        bands: [{ upTo: null, rate: 0.12 }],
      },
      {
        id: "industrial-scientific",
        label: "Industrial & Scientific Supplies",
        aliases: ["industrial", "scientific"],
        mode: "flat",
        bands: [{ upTo: null, rate: 0.12 }],
      },
      {
        id: "apparel-accessories",
        label: "Apparel & Accessories",
        aliases: ["apparel", "clothing", "accessories"],
        mode: "tiered",
        bands: [
          { upTo: 15, rate: 0.05 },
          { upTo: 20, rate: 0.1 },
          { upTo: null, rate: 0.15 },
        ],
      },
      {
        id: "jewelry",
        label: "Jewelry & Precious Metals",
        aliases: ["jewelry", "jewellery", "precious"],
        mode: "marginal",
        bands: [
          { upTo: 250, rate: 0.2 },
          { upTo: null, rate: 0.05 },
        ],
      },
    ],
  },
  managed: null,
};
