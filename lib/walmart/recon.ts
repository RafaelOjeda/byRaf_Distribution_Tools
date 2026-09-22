import { WALMART_API_BASE, walmartHeaders } from "./auth";

const RECON_BASE = `${WALMART_API_BASE}/v3/report/reconreport`;

export interface AvailableReconFile {
  reportDate: string; // yyyy-MM-dd
}

/**
 * The exact response envelope (bare array of dates vs. a wrapper object)
 * isn't nailed down from the docs alone — this is Phase 2's job to
 * confirm against a live call (walmart-margin-tracker-plan.md). Handles
 * the shapes Walmart's examples show; adjust the `list` extraction below
 * once a real response is seen.
 */
export async function listAvailableReconFiles(
  token: string
): Promise<AvailableReconFile[]> {
  const res = await fetch(
    `${RECON_BASE}/availableReconFiles?reportVersion=v1`,
    { headers: walmartHeaders(token) }
  );
  if (!res.ok) {
    throw new Error(
      `availableReconFiles failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as unknown;
  const list: unknown[] = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown[]>)?.reportDates ??
      (data as Record<string, unknown[]>)?.availableReconFiles ??
      []);

  return list.map((entry) =>
    typeof entry === "string"
      ? { reportDate: entry }
      : (entry as AvailableReconFile)
  );
}

/** One money line from reconFileJson, fields exactly as Walmart names them. */
export interface WalmartReconLine {
  "Customer Order #"?: string;
  "Customer Order line #"?: string;
  "Purchase Order #"?: string;
  "Purchase Order line #"?: string;
  "Transaction Key": string;
  "Partner Item Id"?: string;
  "Partner Item Name"?: string;
  "Partner GTIN"?: string;
  Amount: number | string;
  "Amount Type"?: string;
  "Transaction Type"?: string;
  "Transaction Description"?: string;
  "Ship Qty"?: number | string;
  "Shipping Method"?: string;
  "Period Start Date"?: string;
  "Period End Date"?: string;
  "Transaction Posted Timestamp"?: string;
  [key: string]: unknown;
}

interface ReconFileJsonResponse {
  reportData: WalmartReconLine[];
  nextOffset?: number | null;
  totalRecords?: number;
  description?: string;
}

/**
 * Yields each page of `reportData` for one settlement period, following
 * `nextOffset` until Walmart stops returning one. `reportDate` and
 * `offset` are Walmart's published query param names for this style of
 * report endpoint — confirm against a live call in Phase 2 before
 * depending on them for the backfill.
 */
export async function* fetchReconFilePages(
  token: string,
  reportDate: string
): AsyncGenerator<WalmartReconLine[]> {
  let offset = 0;

  while (true) {
    const url = new URL(`${RECON_BASE}/reconFileJson`);
    url.searchParams.set("reportVersion", "v1");
    url.searchParams.set("reportDate", reportDate);
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url, { headers: walmartHeaders(token) });
    if (!res.ok) {
      throw new Error(
        `reconFileJson failed: ${res.status} ${await res.text()}`
      );
    }

    const page = (await res.json()) as ReconFileJsonResponse;
    yield page.reportData ?? [];

    if (!page.nextOffset || page.nextOffset === offset) break;
    offset = page.nextOffset;
  }
}
