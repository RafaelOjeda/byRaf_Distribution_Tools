import { NextResponse } from "next/server";
import { runWalmartSync } from "@/lib/walmart/sync";

/** Manual "Sync" button target. */
export async function POST() {
  try {
    const result = await runWalmartSync("manual");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
