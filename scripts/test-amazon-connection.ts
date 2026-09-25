/**
 * Amazon SP-API connectivity check: LWA token fetch + financialEventGroups.
 * This is the first thing to run once real credentials exist - see
 * docs/amazon-connector-plan.md, "Implementation checklist" step 2.
 *
 * Run with: npm run test:amazon
 * (reads AMAZON_LWA_CLIENT_ID / AMAZON_LWA_CLIENT_SECRET /
 * AMAZON_REFRESH_TOKEN from .env.local, same convention as
 * WALMART_CLIENT_ID/SECRET)
 */
import { fetchAmazonAccessToken } from "../lib/middleware/connectors/amazon/auth";
import { fetchFinancialEventGroups } from "../lib/middleware/connectors/amazon/finances";

async function main() {
  const clientId = process.env.AMAZON_LWA_CLIENT_ID;
  const clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "AMAZON_LWA_CLIENT_ID / AMAZON_LWA_CLIENT_SECRET / AMAZON_REFRESH_TOKEN are not set (check .env.local)"
    );
  }

  console.log("Exchanging the refresh token for an LWA access token...");
  const accessToken = await fetchAmazonAccessToken(clientId, clientSecret, refreshToken);
  console.log("Got an access token. Fetching settlement (financial event) groups...");

  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const groups = await fetchFinancialEventGroups(accessToken, since);
  console.log(JSON.stringify(groups, null, 2));
  console.log(`\n${groups.length} financial event group(s) found.`);
}

main().catch((err) => {
  console.error("Connectivity check failed:", err.message);
  process.exit(1);
});
