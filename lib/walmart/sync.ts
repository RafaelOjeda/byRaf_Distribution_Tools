import { fetchWalmartToken } from "./auth";
import { fetchReconFilePages, listAvailableReconFiles } from "./recon";
import { normalizeReconLine } from "./normalize";
import {
  finishSyncRun,
  getSyncedReportDates,
  hasRunningSyncRun,
  insertReconRows,
  startSyncRun,
  updateSyncRunProgress,
} from "@/lib/db/queries";

export interface SyncResult {
  runId: number;
  reportDates: string[];
  rowsIngested: number;
}

/**
 * Backfills every period `availableReconFiles` returns that hasn't been
 * synced yet, one period at a time (Phase 7). Progress is persisted to
 * `sync_runs` after each period completes, so a crash mid-backfill
 * resumes from the next period instead of re-fetching everything
 * already ingested. `sync_runs` also guards against overlapping runs.
 */
export async function runWalmartSync(
  trigger: "manual" | "cron"
): Promise<SyncResult> {
  if (await hasRunningSyncRun()) {
    throw new Error("A sync run is already in progress");
  }

  const runId = await startSyncRun(trigger);
  const reportDates: string[] = [];
  let rowsIngested = 0;

  try {
    const token = await fetchWalmartToken();
    const available = await listAvailableReconFiles(token);
    const alreadySynced = await getSyncedReportDates();
    const pending = available
      .map((a) => a.reportDate)
      .filter((d) => !alreadySynced.has(d));

    for (const reportDate of pending) {
      for await (const page of fetchReconFilePages(token, reportDate)) {
        const rows = page.map((line) => normalizeReconLine(line, reportDate));
        rowsIngested += await insertReconRows(rows);
      }
      reportDates.push(reportDate);
      await updateSyncRunProgress(runId, reportDates, rowsIngested);
    }

    await finishSyncRun(runId, { status: "success", reportDates, rowsIngested });
    return { runId, reportDates, rowsIngested };
  } catch (err) {
    await finishSyncRun(runId, {
      status: "error",
      reportDates,
      rowsIngested,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
