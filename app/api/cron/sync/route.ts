import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runWalmartSync } from "@/lib/walmart/sync";

/**
 * Cron target, scheduled in vercel.ts. Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set as a
 * project env var — confirm this still matches Vercel's cron docs at
 * deploy time (Phase 7 provisioning).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runWalmartSync("cron");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
