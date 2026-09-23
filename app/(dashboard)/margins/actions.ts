"use server";

import { fetchWalmartToken } from "@/lib/walmart/auth";
import {
  fetchRowsForDates,
  listAvailableReconFiles,
  type ReconRow,
} from "@/lib/walmart/recon";

type Result<T> = T | { error: string };

async function withToken<T>(
  clientId: string,
  clientSecret: string,
  fn: (token: string) => Promise<T>
): Promise<Result<T>> {
  if (!clientId.trim() || !clientSecret.trim()) {
    return { error: "Client ID and Client Secret are both required." };
  }
  try {
    const token = await fetchWalmartToken(clientId.trim(), clientSecret.trim());
    return await fn(token);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error contacting Walmart.",
    };
  }
}

/**
 * Step 1: authenticate and list the settlement periods Walmart has
 * available, without pulling any line-item data yet. Mirrors what
 * you'd see picking a date/report in Seller Center's own Payments page.
 */
export async function listAvailableReports(
  clientId: string,
  clientSecret: string
): Promise<Result<{ reportDates: string[] }>> {
  return withToken(clientId, clientSecret, async (token) => {
    const { availableApReportDates } = await listAvailableReconFiles(token);
    // Newest first - that's what you'd want to look at first.
    return { reportDates: [...availableApReportDates].sort().reverse() };
  });
}

/**
 * Step 2: pull the actual line-item data for whichever periods were
 * selected. Nothing here is written to a database, a file, or a log -
 * the credentials and the fetched rows exist only for this one request.
 */
export async function loadWalmartData(
  clientId: string,
  clientSecret: string,
  reportDates: string[]
): Promise<Result<{ rows: ReconRow[] }>> {
  if (reportDates.length === 0) {
    return { error: "Select at least one settlement report." };
  }
  return withToken(clientId, clientSecret, async (token) => ({
    rows: await fetchRowsForDates(token, reportDates),
  }));
}
