import { SP_API_BASE, US_MARKETPLACE_ID, spApiHeaders } from "./auth";

/**
 * Finances API v0 shapes. UNVERIFIED against a live account - see
 * docs/amazon-connector-plan.md, "Confirm live: which one actually
 * carries every fee category needed". Fields are kept optional/loose
 * rather than asserted, since a wrong-but-confident type here would fail
 * silently at the `as` cast instead of loudly at a live call.
 */

export interface FinancialEventGroup {
  FinancialEventGroupId: string;
  ProcessingStatus?: string;
  FundTransferDate?: string;
  OriginalTotal?: { CurrencyAmount?: number; CurrencyCode?: string };
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
}

interface FinancialEventGroupsResponse {
  payload?: {
    FinancialEventGroupList?: FinancialEventGroup[];
    NextToken?: string;
  };
}

export interface Money {
  CurrencyAmount?: number;
  CurrencyCode?: string;
}

export interface ChargeComponent {
  ChargeType?: string;
  ChargeAmount?: Money;
}

export interface FeeComponent {
  FeeType?: string;
  FeeAmount?: Money;
}

export interface ShipmentItem {
  SellerSKU?: string;
  OrderItemId?: string;
  QuantityShipped?: number;
  ItemChargeList?: ChargeComponent[];
  ItemFeeList?: FeeComponent[];
  ItemTaxWithheldList?: unknown[];
}

/** Refunds carry the same shape as a shipment event, with adjustment lists instead of charge/fee lists in some accounts - handle both, see normalize.ts. */
export interface ShipmentEvent {
  AmazonOrderId?: string;
  SellerOrderId?: string;
  PostedDate?: string;
  ShipmentItemList?: ShipmentItem[];
  ShipmentItemAdjustmentList?: ShipmentItem[];
}

export interface ServiceFeeEvent {
  AmazonOrderId?: string;
  FeeReason?: string;
  FeeList?: FeeComponent[];
  SellerSKU?: string;
}

export interface AdjustmentEvent {
  AdjustmentType?: string;
  AdjustmentAmount?: Money;
}

export interface FinancialEvents {
  ShipmentEventList?: ShipmentEvent[];
  RefundEventList?: ShipmentEvent[];
  ServiceFeeEventList?: ServiceFeeEvent[];
  AdjustmentEventList?: AdjustmentEvent[];
  // Amazon has many more event list types (chargebacks, guarantee
  // claims, ...). Anything not listed here isn't dropped - it's simply
  // not read, which is different from Walmart's classify() catch-all
  // (which sees every row). Confirm live whether any unread list
  // carries meaningful money for a typical seller before shipping.
}

interface FinancialEventsResponse {
  payload?: {
    FinancialEvents?: FinancialEvents;
    NextToken?: string;
  };
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

/**
 * GET /finances/v0/financialEventGroups - one group per settlement
 * period. `financialEventGroupStartedAfter` bounds how far back to look;
 * UNVERIFIED: the exact param name/format and whether it's required.
 */
export async function fetchFinancialEventGroups(
  accessToken: string,
  startedAfterIso: string
): Promise<FinancialEventGroup[]> {
  const groups: FinancialEventGroup[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await spApiGet<FinancialEventGroupsResponse>(
      accessToken,
      "/finances/v0/financialEventGroups",
      {
        MaxResultsPerPage: "100",
        FinancialEventGroupStartedAfter: startedAfterIso,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }
    );
    groups.push(...(data.payload?.FinancialEventGroupList ?? []));
    nextToken = data.payload?.NextToken;
    if (!nextToken) return groups;
  }

  throw new Error(`financialEventGroups exceeded ${MAX_PAGES} pages - refusing to loop further`);
}

/** GET /finances/v0/financialEventGroups/{id}/financialEvents, merging every event list across pages. */
export async function fetchFinancialEventsForGroup(
  accessToken: string,
  groupId: string
): Promise<FinancialEvents> {
  const merged: FinancialEvents = {
    ShipmentEventList: [],
    RefundEventList: [],
    ServiceFeeEventList: [],
    AdjustmentEventList: [],
  };
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await spApiGet<FinancialEventsResponse>(
      accessToken,
      `/finances/v0/financialEventGroups/${encodeURIComponent(groupId)}/financialEvents`,
      {
        MaxResultsPerPage: "100",
        MarketplaceId: US_MARKETPLACE_ID,
        ...(nextToken ? { NextToken: nextToken } : {}),
      }
    );
    const events = data.payload?.FinancialEvents ?? {};
    merged.ShipmentEventList!.push(...(events.ShipmentEventList ?? []));
    merged.RefundEventList!.push(...(events.RefundEventList ?? []));
    merged.ServiceFeeEventList!.push(...(events.ServiceFeeEventList ?? []));
    merged.AdjustmentEventList!.push(...(events.AdjustmentEventList ?? []));
    nextToken = data.payload?.NextToken;
    if (!nextToken) return merged;
  }

  throw new Error(`financialEvents exceeded ${MAX_PAGES} pages - refusing to loop further`);
}
