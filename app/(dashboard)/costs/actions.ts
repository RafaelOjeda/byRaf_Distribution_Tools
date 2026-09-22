"use server";

import { revalidatePath } from "next/cache";
import { deleteSkuCost, upsertSkuCost } from "@/lib/db/queries";
import { parseCsv } from "@/lib/csv";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CostFormState {
  error: string | null;
}

export async function addCost(
  _prev: CostFormState,
  formData: FormData
): Promise<CostFormState> {
  const partnerItemId = String(formData.get("sku") ?? "").trim();
  const unitCost = String(formData.get("unitCost") ?? "").trim();
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!partnerItemId) return { error: "SKU is required." };
  if (!unitCost || Number.isNaN(Number(unitCost)) || Number(unitCost) < 0) {
    return { error: "Unit cost must be a non-negative number." };
  }
  if (!DATE_RE.test(effectiveFrom)) {
    return { error: "Effective date must be YYYY-MM-DD." };
  }

  await upsertSkuCost({
    partnerItemId,
    unitCost,
    effectiveFrom,
    note: note || null,
  });
  revalidatePath("/costs");
  return { error: null };
}

export async function removeCost(id: number) {
  await deleteSkuCost(id);
  revalidatePath("/costs");
}

export interface CsvPreviewRow {
  line: number;
  partnerItemId: string;
  unitCost: string;
  effectiveFrom: string;
  note: string | null;
  valid: boolean;
  error?: string;
}

/** Parses + validates a costs CSV (sku,unit_cost,effective_from,note) without writing anything. */
export async function previewCostsCsv(text: string): Promise<CsvPreviewRow[]> {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const skuIdx = header.indexOf("sku");
  const costIdx = header.indexOf("unit_cost");
  const dateIdx = header.indexOf("effective_from");
  const noteIdx = header.indexOf("note");

  if (skuIdx === -1 || costIdx === -1 || dateIdx === -1) {
    throw new Error(
      "CSV header must include sku, unit_cost, effective_from (note is optional)."
    );
  }

  return rows.slice(1).map((cols, i) => {
    const partnerItemId = (cols[skuIdx] ?? "").trim();
    const unitCost = (cols[costIdx] ?? "").trim();
    const effectiveFrom = (cols[dateIdx] ?? "").trim();
    const note = noteIdx !== -1 ? (cols[noteIdx] ?? "").trim() || null : null;

    let error: string | undefined;
    if (!partnerItemId) error = "Missing SKU";
    else if (!unitCost || Number.isNaN(Number(unitCost)) || Number(unitCost) < 0)
      error = "Invalid unit cost";
    else if (!DATE_RE.test(effectiveFrom)) error = "Invalid effective_from (want YYYY-MM-DD)";

    return {
      line: i + 2, // +1 for header, +1 for 1-indexing
      partnerItemId,
      unitCost,
      effectiveFrom,
      note,
      valid: !error,
      error,
    };
  });
}

/** Commits only the valid, previously previewed rows. */
export async function commitCostsCsv(
  rows: CsvPreviewRow[]
): Promise<{ imported: number }> {
  const valid = rows.filter((r) => r.valid);
  for (const row of valid) {
    await upsertSkuCost({
      partnerItemId: row.partnerItemId,
      unitCost: row.unitCost,
      effectiveFrom: row.effectiveFrom,
      note: row.note,
    });
  }
  revalidatePath("/costs");
  return { imported: valid.length };
}
