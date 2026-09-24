/**
 * Phase 2 connectivity check: token fetch + availableReconFiles.
 * Run with: npm run test:walmart
 */
import { getWalmartToken } from "../lib/middleware/connectors/walmart/auth";
import { listAvailableReconFiles } from "../lib/middleware/connectors/walmart/recon";

async function main() {
  console.log("Fetching available recon report dates from Walmart...");
  const token = await getWalmartToken();
  const result = await listAvailableReconFiles(token);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Connectivity check failed:", err.message);
  process.exit(1);
});
