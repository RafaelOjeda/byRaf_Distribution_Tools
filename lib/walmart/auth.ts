const WALMART_API_BASE = "https://marketplace.walmartapis.com";

/**
 * No caching layer here by design (see walmart-margin-tracker-plan.md,
 * "No Redis"): tokens last ~15 min and a sync run finishes well inside
 * that, so callers fetch once per run and thread the token through.
 */
export async function fetchWalmartToken(): Promise<string> {
  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "WALMART_CLIENT_ID / WALMART_CLIENT_SECRET are not set"
    );
  }

  const res = await fetch(`${WALMART_API_BASE}/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(
      `Walmart token request failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/** Headers every authenticated Walmart Marketplace API call needs. */
export function walmartHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "WM_SVC.NAME": "Walmart Marketplace",
    "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
  };
}

export { WALMART_API_BASE };
