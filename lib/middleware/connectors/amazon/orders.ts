import { SP_API_BASE, US_MARKETPLACE_ID, spApiHeaders } from "./auth";

/**
 * Orders API v0 shapes, deliberately narrowed to what we use. UNVERIFIED
 * against a live account - see docs/amazon-connector-plan.md. Buyer name/
 * address/email are never requested here - Orders API only returns those
 * with an explicit Restricted Data Token, which this connector never
 * asks for, matching the existing "customer data stays out of the
 * browser" stance (see README.md's privacy section - here it goes
 * further and never leaves Amazon's response at all).
 */
export interface Order {
  AmazonOrderId: string;
  PurchaseDate: string; // ISO
  OrderStatus: string; // "Shipped" | "Canceled" | "Pending" | ...
}

interface OrdersResponse {
  payload?: { Orders?: Order[]; NextToken?: string };
}

export interface OrderItem {
  OrderItemId: string;
  SellerSKU?: string;
  Title?: string;
  QuantityOrdered?: number;
  ItemPrice?: { Amount?: number; CurrencyCode?: string };
}

interface OrderItemsResponse {
  payload?: { OrderItems?: OrderItem[]; NextToken?: string };
}

const MAX_PAGES = 100;

async function spApiGet<T>(
  accessToken: string,
  path: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${SP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { headers: spApiHeaders(accessToken) });
  if (!res.ok) {
    throw new Error(
      `${path} failed: ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }
  return res.json();
}

/** GET /orders/v0/orders, paginated via NextToken. */
export async function fetchOrdersSince(
  accessToken: string,
  createdAfterIso: string
): Promise<Order[]> {
  const orders: Order[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await spApiGet<OrdersResponse>(accessToken, "/orders/v0/orders", {
      MarketplaceIds: US_MARKETPLACE_ID,
      CreatedAfter: createdAfterIso,
      ...(nextToken ? { NextToken: nextToken } : {}),
    });
    orders.push(...(data.payload?.Orders ?? []));
    nextToken = data.payload?.NextToken;
    if (!nextToken) return orders;
  }

  throw new Error(`orders exceeded ${MAX_PAGES} pages - refusing to loop further`);
}

/** GET /orders/v0/orders/{id}/orderItems, paginated via NextToken. */
export async function fetchOrderItems(
  accessToken: string,
  orderId: string
): Promise<OrderItem[]> {
  const items: OrderItem[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await spApiGet<OrderItemsResponse>(
      accessToken,
      `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`,
      nextToken ? { NextToken: nextToken } : {}
    );
    items.push(...(data.payload?.OrderItems ?? []));
    nextToken = data.payload?.NextToken;
    if (!nextToken) return items;
  }

  throw new Error(`orderItems exceeded ${MAX_PAGES} pages - refusing to loop further`);
}
