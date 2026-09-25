import { walmartHeaders } from "./auth";

const ORDERS_URL = "https://marketplace.walmartapis.com/v3/orders";

interface Charge {
  chargeType: string; // "PRODUCT", "SHIPPING", ...
  chargeAmount: { amount: number };
}

interface OrderLine {
  lineNumber: string;
  item: { sku: string; productName: string };
  orderLineQuantity: { amount: string };
  charges?: { charge?: Charge[] };
  orderLineStatuses?: {
    orderLineStatus?: { status: string; statusQuantity: { amount: string } }[];
  };
}

/**
 * Only the fields we use. The real payload also carries the customer's
 * name, address and email - never pass a raw Order to the browser.
 */
export interface Order {
  purchaseOrderId: string;
  orderDate: number; // epoch ms
  shipNode?: { type?: string };
  orderLines: { orderLine: OrderLine[] };
}

interface OrdersResponse {
  list: {
    meta: { nextCursor: string | null };
    elements: { order: Order[] };
  };
}

/**
 * GET /v3/orders, following meta.nextCursor. The cursor is a query
 * string appended to the base URL; not yet exercised live, since the
 * account had fewer orders than one page when this was written.
 */
export async function fetchOrdersSince(
  token: string,
  createdStartDate: string // YYYY-MM-DD
): Promise<Order[]> {
  const headers = walmartHeaders(token);

  const orders: Order[] = [];
  let url: string | null =
    `${ORDERS_URL}?createdStartDate=${createdStartDate}&limit=200`;

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(
        `orders failed: ${res.status} ${res.statusText} - ${await res.text()}`
      );
    }
    const data: OrdersResponse = await res.json();
    orders.push(...(data.list?.elements?.order ?? []));
    const cursor = data.list?.meta?.nextCursor;
    url = cursor ? `${ORDERS_URL}${cursor}` : null;
  }

  return orders;
}
