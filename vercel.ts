import type { VercelConfig } from "@vercel/config/v1";

/**
 * Typed replacement for vercel.json (see walmart-margin-tracker-plan.md,
 * Phase 7). Vercel rejects a project that has both files.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  crons: [{ path: "/api/cron/sync", schedule: "0 6 * * *" }],
};
