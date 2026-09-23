const TOKEN_URL = "https://marketplace.walmartapis.com/v3/token";

// Refresh a little before the real ~15 min expiry so a long-running sync
// never gets caught mid-request with a token that just died.
const EXPIRY_BUFFER_MS = 60_000;

let cachedToken: { value: string; expiresAt: number } | null = null;

function correlationId() {
  return crypto.randomUUID();
}

export function walmartBaseHeaders() {
  return {
    "WM_SVC.NAME": "Walmart Margin Tracker",
    "WM_QOS.CORRELATION_ID": correlationId(),
  };
}

/**
 * Fetches (and caches for the life of this process/invocation) a
 * client_credentials access token. One token is reused across every
 * call in a sync run rather than fetched per-request.
 */
export async function getWalmartToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "WALMART_CLIENT_ID / WALMART_CLIENT_SECRET are not set (check .env.local)"
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...walmartBaseHeaders(),
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(
      `Walmart token request failed: ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS,
  };

  return cachedToken.value;
}
