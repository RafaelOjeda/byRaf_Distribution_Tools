import { walmartBaseHeaders } from "./auth";

const BASE_URL = "https://marketplace.walmartapis.com/v3/report/reconreport";

function walmartHeaders(token: string) {
  return {
    Accept: "application/json",
    // Walmart's regular API calls authenticate via this custom header,
    // not a standard `Authorization: Bearer` header.
    "WM_SEC.ACCESS_TOKEN": token,
    ...walmartBaseHeaders(),
  };
}

export interface AvailableReconFiles {
  // Confirmed against a live response 2026-09-22 - Walmart's docs never
  // actually state this field name.
  availableApReportDates: string[];
}

/** GET /v3/report/reconreport/availableReconFiles?reportVersion=v1 */
export async function listAvailableReconFiles(
  token: string
): Promise<AvailableReconFiles> {
  const res = await fetch(`${BASE_URL}/availableReconFiles?reportVersion=v1`, {
    headers: walmartHeaders(token),
  });

  if (!res.ok) {
    throw new Error(
      `availableReconFiles failed: ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }

  return res.json();
}

/** One money-line row, exactly as Walmart names its fields. */
export type ReconRow = Record<string, string> & {
  "Transaction Key": string;
  "Transaction Type": string;
  "Amount Type": string;
  Amount: string;
  "Purchase Order #": string;
  "Purchase Order line #": string;
  "Partner Item Id": string;
  "Partner Item Name": string;
  "Ship Qty": string;
  "Fulfillment Type": string;
};

interface ReconFileJsonResponse {
  reportData: ReconRow[];
  nextOffset: number;
  totalRecords: number;
  description: string;
}

const PAGE_SIZE = 1000;

/**
 * GET /v3/report/reconreport/reconFileJson
 *
 * Required params confirmed live 2026-09-23 (Walmart's docs state none
 * of this - discovered from the API's own "required param missing"
 * error messages): reportDate (MMDDYYYY, matches availableReconFiles'
 * format), offset (starts at 0), noOfRecords (page size). Pagination
 * ends when the response's nextOffset is -1.
 */
export async function fetchReconFileJsonPage(
  token: string,
  reportDate: string,
  offset: number
): Promise<ReconFileJsonResponse> {
  const url = `${BASE_URL}/reconFileJson?reportDate=${reportDate}&offset=${offset}&noOfRecords=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: walmartHeaders(token) });

  if (!res.ok) {
    throw new Error(
      `reconFileJson failed (reportDate=${reportDate}, offset=${offset}): ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }

  return res.json();
}

/** Follows nextOffset until exhausted (-1), returning every row for one settlement period. */
export async function fetchAllRowsForDate(
  token: string,
  reportDate: string
): Promise<ReconRow[]> {
  const rows: ReconRow[] = [];
  let offset = 0;

  while (offset !== -1) {
    const page = await fetchReconFileJsonPage(token, reportDate, offset);
    rows.push(...page.reportData);
    offset = page.nextOffset;
  }

  return rows;
}

/** Pulls rows for a chosen set of settlement periods. */
export async function fetchRowsForDates(
  token: string,
  reportDates: string[]
): Promise<ReconRow[]> {
  const rows: ReconRow[] = [];
  for (const reportDate of reportDates) {
    rows.push(...(await fetchAllRowsForDate(token, reportDate)));
  }
  return rows;
}

/** Pulls every available settlement period's rows in one shot. */
export async function fetchAllAvailableRows(token: string): Promise<ReconRow[]> {
  const { availableApReportDates } = await listAvailableReconFiles(token);
  return fetchRowsForDates(token, availableApReportDates);
}
