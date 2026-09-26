/**
 * Mocked-fetch regression check for the Walmart connector's network and
 * auth code - the layer test-engine.ts doesn't reach (it only exercises
 * groupReconRows/estimateUnsettled as pure functions over already-parsed
 * data, never the fetch()-calling functions around them).
 *
 * Covers: shared auth headers, the cursor-pagination helper and its two
 * real callers (inventory, items), the URL-cursor and offset-cursor
 * pagination in orders/recon, WalmartAuthService's token cache, and the
 * percent-string output normalize.ts produces (commissionRate/estimateNote)
 * that no existing test asserted on.
 *
 * Run with: npx tsx scripts/test-connectors.ts
 */
import assert from "node:assert/strict";
import {
  WalmartAuthService,
  fetchWalmartToken,
  walmartBaseHeaders,
  walmartHeaders,
} from "../lib/middleware/connectors/walmart/auth";
import { fetchInventory } from "../lib/middleware/connectors/walmart/inventory";
import { fetchCatalogPrices } from "../lib/middleware/connectors/walmart/items";
import { fetchOrdersSince, type Order } from "../lib/middleware/connectors/walmart/orders";
import {
  fetchAllAvailableRows,
  fetchAllRowsForDate,
  fetchRowsForDates,
  listAvailableReconFiles,
  type ReconRow,
} from "../lib/middleware/connectors/walmart/recon";
import { estimateUnsettled, groupReconRows } from "../lib/middleware/connectors/walmart/normalize";
import { buildSkuHistory } from "../lib/middleware/engine/margins";
import { paginate } from "../lib/middleware/connectors/pagination";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/** Installs a mock fetch for the duration of one check, then restores the real one. */
async function withMockFetch<T>(handler: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function row(fields: Partial<ReconRow> & Record<string, string>): ReconRow {
  return {
    "Transaction Key": "",
    "Transaction Type": "",
    "Amount Type": "",
    Amount: "0",
    "Purchase Order #": "",
    "Purchase Order line #": "",
    "Partner Item Id": "",
    "Partner Item Name": "",
    "Ship Qty": "",
    "Fulfillment Type": "",
    ...fields,
  };
}

async function main() {
  // ---------------------------------------------------------------------
  // Shared auth headers
  // ---------------------------------------------------------------------

  await check("walmartBaseHeaders carries the service name and a fresh correlation id each call", () => {
    const a = walmartBaseHeaders();
    const b = walmartBaseHeaders();
    assert.equal(a["WM_SVC.NAME"], "Walmart Margin Tracker");
    assert.notEqual(a["WM_QOS.CORRELATION_ID"], b["WM_QOS.CORRELATION_ID"]);
  });

  await check("walmartHeaders carries the access token plus the base headers", () => {
    const h = walmartHeaders("tok-123");
    assert.equal(h.Accept, "application/json");
    assert.equal(h["WM_SEC.ACCESS_TOKEN"], "tok-123");
    assert.equal(h["WM_SVC.NAME"], "Walmart Margin Tracker");
  });

  // ---------------------------------------------------------------------
  // paginate() - the shared cursor-pagination helper
  // ---------------------------------------------------------------------

  await check("paginate stops as soon as nextCursor is null and aggregates in call order", async () => {
    let calls = 0;
    const items = await paginate<number>(async (cursor) => {
      calls++;
      if (cursor === null) return { items: [1, 2], nextCursor: "x" };
      return { items: [3], nextCursor: null };
    }, 10);
    assert.deepEqual(items, [1, 2, 3]);
    assert.equal(calls, 2);
  });

  await check("paginate's page-cap error names the label passed in", async () => {
    await assert.rejects(
      paginate<number>(async () => ({ items: [], nextCursor: "loop" }), 3, "widgets"),
      /widgets exceeded 3 pages/
    );
  });

  // ---------------------------------------------------------------------
  // fetchInventory - cursor via meta.nextCursor query param
  // ---------------------------------------------------------------------

  await check("fetchInventory paginates via meta.nextCursor and aggregates in order", async () => {
    let calls = 0;
    const items = await withMockFetch(async (url) => {
      calls++;
      const u = String(url);
      if (calls === 1) {
        assert.ok(!u.includes("nextCursor"), "first page sends no nextCursor param");
        return jsonResponse({
          elements: { inventories: [{ sku: "A", nodes: [{ availToSellQty: { amount: 1 } }] }] },
          meta: { nextCursor: "c2" },
        });
      }
      if (calls === 2) {
        assert.ok(u.includes("nextCursor=c2"), "second page requests cursor c2");
        return jsonResponse({
          elements: { inventories: [{ sku: "B", nodes: [{ availToSellQty: { amount: 2 } }] }] },
          meta: {},
        });
      }
      throw new Error("unexpected extra fetch call");
    }, () => fetchInventory("tok"));
    assert.deepEqual(items.map((i) => i.sku), ["A", "B"]);
    assert.equal(calls, 2);
  });

  await check("fetchInventory throws a labeled error when the page cap is exceeded", async () => {
    await assert.rejects(
      withMockFetch(
        async () => jsonResponse({ elements: { inventories: [] }, meta: { nextCursor: "loop" } }),
        () => fetchInventory("tok")
      ),
      /inventories exceeded \d+ pages/
    );
  });

  await check("fetchInventory throws on an HTTP failure, naming the page", async () => {
    await assert.rejects(
      withMockFetch(async () => textResponse("boom", 500), () => fetchInventory("tok")),
      /inventories failed \(page 1\)/
    );
  });

  // ---------------------------------------------------------------------
  // fetchCatalogPrices - cursor starts at "*", dedupes, 404 = end of data
  // ---------------------------------------------------------------------

  await check("fetchCatalogPrices requests cursor '*' on the first page", async () => {
    await withMockFetch(async (url) => {
      assert.ok(String(url).includes("nextCursor=*"));
      return jsonResponse({ ItemResponse: [], nextCursor: undefined });
    }, () => fetchCatalogPrices("tok"));
  });

  await check("fetchCatalogPrices dedupes a SKU repeated across pages and aggregates the rest", async () => {
    let calls = 0;
    const items = await withMockFetch(async (url) => {
      calls++;
      const u = String(url);
      if (calls === 1) {
        assert.ok(u.includes("nextCursor=*"));
        return jsonResponse({
          ItemResponse: [{ sku: "X", price: { amount: 9.99 }, publishedStatus: "PUBLISHED" }],
          nextCursor: "n2",
        });
      }
      if (calls === 2) {
        assert.ok(u.includes("nextCursor=n2"));
        return jsonResponse({
          ItemResponse: [
            { sku: "X", price: { amount: 9.99 } }, // duplicate, must not double-count
            { sku: "Y", price: null, publishedStatus: "UNPUBLISHED" },
          ],
          nextCursor: undefined,
        });
      }
      throw new Error("unexpected extra fetch call");
    }, () => fetchCatalogPrices("tok"));
    assert.deepEqual(
      items.map((i) => i.sku),
      ["X", "Y"]
    );
    assert.equal(items[1].price, null);
  });

  await check("fetchCatalogPrices treats a 404 CONTENT_NOT_FOUND page as end of data, not a failure", async () => {
    let calls = 0;
    const items = await withMockFetch(async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({ ItemResponse: [{ sku: "Z", publishedStatus: "PUBLISHED" }], nextCursor: "n2" });
      }
      return textResponse("CONTENT_NOT_FOUND", 404);
    }, () => fetchCatalogPrices("tok"));
    assert.deepEqual(items.map((i) => i.sku), ["Z"]);
  });

  await check("fetchCatalogPrices throws on a real (non-CONTENT_NOT_FOUND) failure", async () => {
    await assert.rejects(
      withMockFetch(async () => textResponse("server error", 500), () => fetchCatalogPrices("tok")),
      /items failed \(page 1\)/
    );
  });

  // ---------------------------------------------------------------------
  // fetchOrdersSince - cursor is a raw URL fragment appended to the base URL
  // ---------------------------------------------------------------------

  await check("fetchOrdersSince follows a raw URL-fragment cursor across pages", async () => {
    let calls = 0;
    const orders = await withMockFetch(async (url) => {
      calls++;
      const u = String(url);
      if (calls === 1) {
        assert.equal(
          u,
          "https://marketplace.walmartapis.com/v3/orders?createdStartDate=2026-01-01&limit=200"
        );
        return jsonResponse({
          list: {
            meta: { nextCursor: "&cursor=abc" },
            elements: { order: [{ purchaseOrderId: "P1", orderDate: 1, orderLines: { orderLine: [] } }] },
          },
        });
      }
      if (calls === 2) {
        assert.equal(u, "https://marketplace.walmartapis.com/v3/orders&cursor=abc");
        return jsonResponse({
          list: {
            meta: { nextCursor: null },
            elements: { order: [{ purchaseOrderId: "P2", orderDate: 2, orderLines: { orderLine: [] } }] },
          },
        });
      }
      throw new Error("unexpected extra fetch call");
    }, () => fetchOrdersSince("tok", "2026-01-01"));
    assert.deepEqual(orders.map((o) => o.purchaseOrderId), ["P1", "P2"]);
  });

  await check("fetchOrdersSince throws on an HTTP failure", async () => {
    await assert.rejects(
      withMockFetch(async () => textResponse("nope", 503), () => fetchOrdersSince("tok", "2026-01-01")),
      /orders failed/
    );
  });

  // ---------------------------------------------------------------------
  // recon.ts - offset-based pagination via nextOffset until -1
  // ---------------------------------------------------------------------

  await check("fetchAllRowsForDate follows nextOffset until -1", async () => {
    let calls = 0;
    const rows = await withMockFetch(async (url) => {
      calls++;
      const u = String(url);
      if (calls === 1) {
        assert.ok(u.includes("offset=0"));
        return jsonResponse({ reportData: [row({ "Transaction Key": "R1" })], nextOffset: 1000, totalRecords: 2, description: "" });
      }
      if (calls === 2) {
        assert.ok(u.includes("offset=1000"));
        return jsonResponse({ reportData: [row({ "Transaction Key": "R2" })], nextOffset: -1, totalRecords: 2, description: "" });
      }
      throw new Error("unexpected extra fetch call");
    }, () => fetchAllRowsForDate("tok", "09012026"));
    assert.deepEqual(rows.map((r) => r["Transaction Key"]), ["R1", "R2"]);
  });

  await check("fetchRowsForDates concatenates rows across multiple settlement periods", async () => {
    let calls = 0;
    const rows = await withMockFetch(async () => {
      calls++;
      return jsonResponse({ reportData: [row({ "Transaction Key": `R${calls}` })], nextOffset: -1, totalRecords: 1, description: "" });
    }, () => fetchRowsForDates("tok", ["09012026", "09082026"]));
    assert.equal(rows.length, 2);
  });

  await check("fetchAllAvailableRows composes listAvailableReconFiles with fetchRowsForDates", async () => {
    const rows = await withMockFetch(async (url) => {
      if (String(url).includes("availableReconFiles")) {
        return jsonResponse({ availableApReportDates: ["09012026"] });
      }
      return jsonResponse({ reportData: [row({ "Transaction Key": "R1" })], nextOffset: -1, totalRecords: 1, description: "" });
    }, () => fetchAllAvailableRows("tok"));
    assert.equal(rows.length, 1);
  });

  await check("listAvailableReconFiles throws on an HTTP failure", async () => {
    await assert.rejects(
      withMockFetch(async () => textResponse("down", 500), () => listAvailableReconFiles("tok")),
      /availableReconFiles failed/
    );
  });

  // ---------------------------------------------------------------------
  // fetchWalmartToken - per-request, deliberately uncached token exchange
  // ---------------------------------------------------------------------

  await check("fetchWalmartToken sends Basic auth built from clientId:clientSecret", async () => {
    let seenAuth = "";
    const token = await withMockFetch(async (_url, init) => {
      seenAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization);
      return jsonResponse({ access_token: "abc" });
    }, () => fetchWalmartToken("myid", "mysecret"));
    assert.equal(token, "abc");
    assert.equal(seenAuth, `Basic ${Buffer.from("myid:mysecret").toString("base64")}`);
  });

  await check("fetchWalmartToken throws on a failed token exchange", async () => {
    await assert.rejects(
      withMockFetch(async () => textResponse("invalid_client", 401), () => fetchWalmartToken("bad", "bad")),
      /Walmart token request failed/
    );
  });

  // ---------------------------------------------------------------------
  // WalmartAuthService - per-instance token cache
  // ---------------------------------------------------------------------

  await check("WalmartAuthService caches the token within its expiry, without refetching", async () => {
    process.env.WALMART_CLIENT_ID = "id";
    process.env.WALMART_CLIENT_SECRET = "secret";
    try {
      let calls = 0;
      await withMockFetch(
        async () => {
          calls++;
          return jsonResponse({ access_token: `tok-${calls}` });
        },
        async () => {
          const svc = new WalmartAuthService();
          const first = await svc.getToken();
          const second = await svc.getToken();
          assert.equal(first, "tok-1");
          assert.equal(second, "tok-1");
          assert.equal(calls, 1);
        }
      );
    } finally {
      delete process.env.WALMART_CLIENT_ID;
      delete process.env.WALMART_CLIENT_SECRET;
    }
  });

  await check("WalmartAuthService instances don't share a cache", async () => {
    process.env.WALMART_CLIENT_ID = "id";
    process.env.WALMART_CLIENT_SECRET = "secret";
    try {
      let calls = 0;
      await withMockFetch(
        async () => {
          calls++;
          return jsonResponse({ access_token: `tok-${calls}` });
        },
        async () => {
          const a = await new WalmartAuthService().getToken();
          const b = await new WalmartAuthService().getToken();
          assert.equal(a, "tok-1");
          assert.equal(b, "tok-2");
        }
      );
    } finally {
      delete process.env.WALMART_CLIENT_ID;
      delete process.env.WALMART_CLIENT_SECRET;
    }
  });

  await check("WalmartAuthService throws when credentials are not configured", async () => {
    delete process.env.WALMART_CLIENT_ID;
    delete process.env.WALMART_CLIENT_SECRET;
    await assert.rejects(new WalmartAuthService().getToken(), /WALMART_CLIENT_ID/);
  });

  // ---------------------------------------------------------------------
  // normalize.ts - the percent-string output the Week 3 pct1() refactor
  // produces (a real gap: test-engine.ts asserts the money values from
  // estimateUnsettled but never the commissionRate/estimateNote strings).
  // ---------------------------------------------------------------------

  const settledForHistory = groupReconRows([
    row({
      "Purchase Order #": "PO1",
      "Purchase Order line #": "1",
      "Partner Item Id": "SKU-X",
      "Partner Item Name": "X",
      "Ship Qty": "1",
      "Fulfillment Type": "SellerFulfilled",
      "Amount Type": "Product Price",
      Amount: "20.00",
      "Transaction Posted Timestamp": "09/01/2026",
      "Transaction Description": "Product Price",
    }),
    row({
      "Purchase Order #": "PO1",
      "Purchase Order line #": "1",
      "Amount Type": "Commission on Product",
      Amount: "-2.00",
      "Transaction Posted Timestamp": "09/01/2026",
      "Transaction Description": "Commission",
    }),
    row({
      "Purchase Order #": "PO1",
      "Purchase Order line #": "1",
      "Amount Type": "Fee/Reimbursement",
      Amount: "-3.00",
      "Transaction Posted Timestamp": "09/01/2026",
      "Transaction Description": "Shipping label charge",
    }),
  ]);
  const historyForPct = buildSkuHistory(settledForHistory);

  const unsettledOrder: Order = {
    purchaseOrderId: "PO2",
    orderDate: Date.UTC(2026, 8, 5),
    shipNode: { type: "SellerFulfilled" },
    orderLines: {
      orderLine: [
        {
          lineNumber: "1",
          item: { sku: "SKU-X", productName: "X" },
          orderLineQuantity: { amount: "1" },
          charges: { charge: [{ chargeType: "PRODUCT", chargeAmount: { amount: 20 } }] },
          orderLineStatuses: { orderLineStatus: [{ status: "Shipped", statusQuantity: { amount: "1" } }] },
        },
      ],
    },
  };
  const estimatedForPct = estimateUnsettled([unsettledOrder], new Set(), historyForPct);

  await check("estimateUnsettled's commissionRate is a bare percent number-string (no % sign)", () => {
    assert.equal(estimatedForPct[0].commissionRate, "10.0");
  });

  await check("estimateUnsettled's estimateNote embeds the same percent, with a % sign, and singular 'shipment'", () => {
    assert.match(estimatedForPct[0].estimateNote!, /commission at 10\.0%/);
    assert.match(estimatedForPct[0].estimateNote!, /average of 1 settled shipment(?!s)/);
  });

  console.log(`\n${passed} check(s) passed.`);
}

main();
