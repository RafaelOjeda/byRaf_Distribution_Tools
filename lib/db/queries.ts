import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { getDb } from "./index";
import { skuCosts, syncRuns, walmartReconRows } from "./schema";
import { computeLineMargin, type ReconLineForMargin } from "@/lib/margin";

// ---- Recon row ingestion ----

export async function insertReconRows(
  rows: (typeof walmartReconRows.$inferInsert)[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  const inserted = await db
    .insert(walmartReconRows)
    .values(rows)
    .onConflictDoNothing({ target: walmartReconRows.transactionKey })
    .returning({ id: walmartReconRows.id });
  return inserted.length;
}

/** Phase 3: read the real distinct values before writing classification rules. */
export async function getDistinctAmountTypes(): Promise<
  { amountType: string | null; transactionType: string | null }[]
> {
  const db = getDb();
  return db
    .selectDistinct({
      amountType: walmartReconRows.amountType,
      transactionType: walmartReconRows.transactionType,
    })
    .from(walmartReconRows);
}

/** SKU list derives from what's been seen, not a maintained table. */
export async function getKnownSkus(): Promise<
  { partnerItemId: string; partnerItemName: string | null }[]
> {
  const db = getDb();
  const rows = await db
    .selectDistinct({
      partnerItemId: walmartReconRows.partnerItemId,
      partnerItemName: walmartReconRows.partnerItemName,
    })
    .from(walmartReconRows)
    .where(isNotNull(walmartReconRows.partnerItemId));

  const bySku = new Map<string, string | null>();
  for (const row of rows) {
    if (row.partnerItemId) bySku.set(row.partnerItemId, row.partnerItemName);
  }
  return [...bySku.entries()]
    .map(([partnerItemId, partnerItemName]) => ({ partnerItemId, partnerItemName }))
    .sort((a, b) => a.partnerItemId.localeCompare(b.partnerItemId));
}

// ---- sku_costs ----

export async function listSkuCosts() {
  const db = getDb();
  return db
    .select()
    .from(skuCosts)
    .orderBy(asc(skuCosts.partnerItemId), desc(skuCosts.effectiveFrom));
}

/** Latest effective cost per SKU, as of today. */
export async function listLatestSkuCosts() {
  const all = await listSkuCosts();
  const latest = new Map<string, (typeof all)[number]>();
  for (const cost of all) {
    if (!latest.has(cost.partnerItemId)) latest.set(cost.partnerItemId, cost);
  }
  return [...latest.values()];
}

export async function upsertSkuCost(input: {
  partnerItemId: string;
  unitCost: string;
  effectiveFrom: string;
  note?: string | null;
}) {
  const db = getDb();
  await db
    .insert(skuCosts)
    .values(input)
    .onConflictDoUpdate({
      target: [skuCosts.partnerItemId, skuCosts.effectiveFrom],
      set: { unitCost: input.unitCost, note: input.note ?? null },
    });
}

export async function deleteSkuCost(id: number) {
  const db = getDb();
  await db.delete(skuCosts).where(eq(skuCosts.id, id));
}

// ---- sync_runs ----

export async function startSyncRun(trigger: "manual" | "cron"): Promise<number> {
  const db = getDb();
  const [run] = await db
    .insert(syncRuns)
    .values({ trigger, status: "running" })
    .returning({ id: syncRuns.id });
  return run.id;
}

export async function updateSyncRunProgress(
  id: number,
  reportDates: string[],
  rowsIngested: number
) {
  const db = getDb();
  await db
    .update(syncRuns)
    .set({ reportDates, rowsIngested })
    .where(eq(syncRuns.id, id));
}

export async function finishSyncRun(
  id: number,
  result: {
    status: "success" | "error";
    reportDates: string[];
    rowsIngested: number;
    error?: string;
  }
) {
  const db = getDb();
  await db
    .update(syncRuns)
    .set({
      status: result.status,
      finishedAt: new Date(),
      reportDates: result.reportDates,
      rowsIngested: result.rowsIngested,
      error: result.error ?? null,
    })
    .where(eq(syncRuns.id, id));
}

export async function hasRunningSyncRun(): Promise<boolean> {
  const db = getDb();
  const running = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"))
    .limit(1);
  return running.length > 0;
}

export async function listSyncRuns(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit);
}

/**
 * Periods already ingested by any run (success or error) — a run only
 * appends a date to its `reportDates` after that period's rows are
 * actually committed (see lib/walmart/sync.ts), so this is safe to use
 * as the backfill resume point even after a crashed run.
 */
export async function getSyncedReportDates(): Promise<Set<string>> {
  const db = getDb();
  const runs = await db.select({ reportDates: syncRuns.reportDates }).from(syncRuns);
  const dates = new Set<string>();
  for (const run of runs) {
    for (const d of run.reportDates ?? []) dates.add(d);
  }
  return dates;
}

// ---- margin query (derived on read, see plan's Margin Calculation section) ----

export interface MarginRow {
  purchaseOrderNo: string;
  purchaseOrderLine: string | null;
  partnerItemId: string | null;
  partnerItemName: string | null;
  fulfillmentChannel: "wfs" | "self";
  netSettlement: number;
  grossRevenue: number;
  totalFees: number;
  unitCost: number | null;
  profit: number;
  margin: number | null;
  missingCost: boolean;
  shipQty: number;
  lastPostedAt: Date | null;
}

export async function getMarginRows(filter?: {
  from?: string;
  to?: string;
}): Promise<MarginRow[]> {
  const db = getDb();
  const conditions = [isNotNull(walmartReconRows.purchaseOrderNo)];
  if (filter?.from) conditions.push(gte(walmartReconRows.reportDate, filter.from));
  if (filter?.to) conditions.push(lte(walmartReconRows.reportDate, filter.to));

  const rows = await db
    .select()
    .from(walmartReconRows)
    .where(and(...conditions));

  const costs = await listSkuCosts(); // desc effectiveFrom per SKU already
  const costsBySku = new Map<string, { unitCost: string; effectiveFrom: string }[]>();
  for (const c of costs) {
    const list = costsBySku.get(c.partnerItemId) ?? [];
    list.push({ unitCost: c.unitCost, effectiveFrom: c.effectiveFrom });
    costsBySku.set(c.partnerItemId, list);
  }

  function costFor(partnerItemId: string | null, asOf: string): number | null {
    if (!partnerItemId) return null;
    const match = costsBySku.get(partnerItemId)?.find((c) => c.effectiveFrom <= asOf);
    return match ? Number(match.unitCost) : null;
  }

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.purchaseOrderNo}::${row.purchaseOrderLine ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: MarginRow[] = [];
  for (const lines of groups.values()) {
    const first = lines[0];
    const forMargin: ReconLineForMargin[] = lines.map((l) => ({
      amount: Number(l.amount),
      amountType: l.amountType,
      transactionType: l.transactionType,
    }));
    const shipQty =
      lines.reduce((max, l) => Math.max(max, l.shipQty ?? 0), 0) || 1;
    const asOfDate = lines.reduce(
      (min, l) => (l.reportDate < min ? l.reportDate : min),
      first.reportDate
    );
    const unitCost = costFor(first.partnerItemId, asOfDate);
    const margin = computeLineMargin(forMargin, unitCost, shipQty);
    const lastPostedAt = lines.reduce<Date | null>((latest, l) => {
      if (!l.postedAt) return latest;
      return !latest || l.postedAt > latest ? l.postedAt : latest;
    }, null);

    result.push({
      purchaseOrderNo: first.purchaseOrderNo!,
      purchaseOrderLine: first.purchaseOrderLine,
      partnerItemId: first.partnerItemId,
      partnerItemName: first.partnerItemName,
      shipQty,
      lastPostedAt,
      ...margin,
    });
  }

  return result.sort((a, b) => b.profit - a.profit);
}

// ---- WFS storage fee rollup — account-level, arrives with no Purchase Order # ----

export interface StorageFeeRow {
  partnerItemId: string | null;
  month: string; // yyyy-MM
  amount: number;
}

export async function getStorageFeeRollup(): Promise<StorageFeeRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      partnerItemId: walmartReconRows.partnerItemId,
      reportDate: walmartReconRows.reportDate,
      amount: walmartReconRows.amount,
    })
    .from(walmartReconRows)
    .where(isNull(walmartReconRows.purchaseOrderNo));

  const byKey = new Map<string, StorageFeeRow>();
  for (const row of rows) {
    const month = row.reportDate.slice(0, 7);
    const key = `${row.partnerItemId ?? ""}::${month}`;
    const amount = Number(row.amount);
    const existing = byKey.get(key);
    if (existing) existing.amount += amount;
    else byKey.set(key, { partnerItemId: row.partnerItemId, month, amount });
  }

  return [...byKey.values()].sort((a, b) => b.month.localeCompare(a.month));
}
