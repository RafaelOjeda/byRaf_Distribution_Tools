const TOKEN_URL = "https://api.amazon.com/auth/o2/token";

/**
 * SP-API's North America endpoint. Marketplace ID is fixed to the US
 * marketplace for now - see docs/amazon-connector-plan.md, "Marketplace
 * ID is fixed for now".
 */
export const SP_API_BASE = "https://sellingpartnerapi-na.amazon.com";
export const US_MARKETPLACE_ID = "ATVPDKIKX0DER";

/**
 * LWA (Login with Amazon) refresh-token grant - standard OAuth2, not
 * SP-API-specific, so unlike the endpoints in the other files here this
 * flow's shape doesn't need live-account verification to trust (see
 * docs/amazon-connector-plan.md). Deliberately uncached and re-run per
 * request: credentials arrive per-request from a pasted form, potentially
 * a different seller each time, same reasoning as Walmart's
 * fetchWalmartToken.
 *
 * UNVERIFIED against a live Amazon account - see
 * docs/amazon-connector-plan.md and docs/amazon-api-notes.md.
 */
export async function fetchAmazonAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(
      `Amazon LWA token request failed: ${res.status} ${res.statusText} - ${await res.text()}`
    );
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * As of SP-API's 2023 "sunset of legacy authorization", most operations
 * only need the LWA access token, not AWS SigV4 request signing -
 * confirm that holds for every operation this connector calls before
 * relying on it (docs/amazon-connector-plan.md marks this "confirm
 * live"). If an endpoint starts rejecting requests with a signature
 * error, that's the first thing to check.
 */
export function spApiHeaders(accessToken: string) {
  return {
    "x-amz-access-token": accessToken,
    Accept: "application/json",
  };
}
