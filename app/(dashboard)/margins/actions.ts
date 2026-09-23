"use server";

import { fetchWalmartToken } from "@/lib/walmart/auth";
import { fetchAllAvailableRows, type ReconRow } from "@/lib/walmart/recon";

/**
 * Takes credentials straight from the browser form and returns raw rows.
 * Nothing here is written to a database, a file, or a log - the
 * credentials and the fetched rows exist only for this one request.
 */
export async function loadWalmartData(
  clientId: string,
  clientSecret: string
): Promise<{ rows: ReconRow[] } | { error: string }> {
  if (!clientId.trim() || !clientSecret.trim()) {
    return { error: "Client ID and Client Secret are both required." };
  }

  try {
    const token = await fetchWalmartToken(clientId.trim(), clientSecret.trim());
    const rows = await fetchAllAvailableRows(token);
    return { rows };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error contacting Walmart.",
    };
  }
}
