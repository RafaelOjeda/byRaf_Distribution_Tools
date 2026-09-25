const TOKEN_URL = "https://marketplace.walmartapis.com/v3/token";

// Refresh a little before the real ~15 min expiry so a long-running sync
// never gets caught mid-request with a token that just died.
const EXPIRY_BUFFER_MS = 60_000;

function correlationId() {
  return crypto.randomUUID();
}

export function walmartBaseHeaders() {
  return {
    "WM_SVC.NAME": "Walmart Margin Tracker",
    "WM_QOS.CORRELATION_ID": correlationId(),
  };
}

/** Headers for every authenticated Walmart API call (not the token exchange itself). */
export function walmartHeaders(token: string) {
  return {
    Accept: "application/json",
    // Walmart's regular API calls authenticate via this custom header,
    // not a standard `Authorization: Bearer` header.
    "WM_SEC.ACCESS_TOKEN": token,
    ...walmartBaseHeaders(),
  };
}

/**
 * Fetches a client_credentials access token for the given credentials.
 * Deliberately uncached: credentials arrive per-request from a form (not
 * env vars), potentially a different seller each time. A shared cache
 * here would leak one seller's token to another seller's request.
 */
export async function fetchWalmartToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
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

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Env-var-credentialed variant, cached for the life of the instance.
 * For a single-tenant background job (cron/sync) or CLI script, not the
 * per-request multi-tenant flow above - each instance owns its own
 * cache, so nothing can accidentally share or reset another caller's.
 */
export class WalmartAuthService {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  async getToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }

    const clientId = process.env.WALMART_CLIENT_ID;
    const clientSecret = process.env.WALMART_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "WALMART_CLIENT_ID / WALMART_CLIENT_SECRET are not set (check .env.local)"
      );
    }

    const value = await fetchWalmartToken(clientId, clientSecret);
    this.cachedToken = {
      value,
      expiresAt: Date.now() + 15 * 60_000 - EXPIRY_BUFFER_MS,
    };
    return value;
  }
}
