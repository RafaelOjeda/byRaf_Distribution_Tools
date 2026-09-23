import { getWalmartToken, walmartBaseHeaders } from "./auth";

const BASE_URL = "https://marketplace.walmartapis.com/v3/report/reconreport";

async function walmartHeaders() {
  return {
    Accept: "application/json",
    // Walmart's regular API calls authenticate via this custom header,
    // not a standard `Authorization: Bearer` header.
    "WM_SEC.ACCESS_TOKEN": await getWalmartToken(),
    ...walmartBaseHeaders(),
  };
}

export interface AvailableReconFiles {
  reportDates: string[];
}

/** GET /v3/report/reconreport/availableReconFiles?reportVersion=v1 */
export async function listAvailableReconFiles(): Promise<AvailableReconFiles> {
  const res = await fetch(`${BASE_URL}/availableReconFiles?reportVersion=v1`, {
    headers: await walmartHeaders(),
  });

  if (!res.ok) {
    throw new Error(
      `availableReconFiles failed: ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }

  return res.json();
}

/**
 * GET /v3/report/reconreport/reconFileJson
 *
 * NOT YET IMPLEMENTED. Walmart's public docs don't specify the exact
 * query params (report date format, pagination param name for the
 * response's `nextOffset`). Per the plan (Phase 3), this gets built
 * against a real response from listAvailableReconFiles + one manual
 * call, rather than guessed.
 */
