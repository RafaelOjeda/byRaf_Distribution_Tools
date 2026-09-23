/**
 * Phase 2 connectivity check: token fetch + availableReconFiles.
 * Run with: npm run test:walmart
 */
import { listAvailableReconFiles } from "../lib/walmart/recon";

async function main() {
  console.log("Fetching available recon report dates from Walmart...");
  const result = await listAvailableReconFiles();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Connectivity check failed:", err.message);
  process.exit(1);
});
