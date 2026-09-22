import { getKnownSkus, listSkuCosts } from "@/lib/db/queries";
import { CostForm } from "./_components/cost-form";
import { CsvImport } from "./_components/csv-import";
import { DeleteCostButton } from "./_components/delete-cost-button";

// Reads live DB data; DATABASE_URL isn't available at build time, so this
// can't be statically prerendered.
export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const [costs, knownSkus] = await Promise.all([listSkuCosts(), getKnownSkus()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Costs</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Per-SKU cost is effective-dated: adding a new entry for a SKU
          doesn&apos;t overwrite history, it takes effect going forward.
        </p>
      </div>

      <CostForm knownSkus={knownSkus.map((s) => s.partnerItemId)} />
      <CsvImport />

      <div className="overflow-auto rounded-md border border-black/10 dark:border-white/15">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left dark:bg-white/10">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Unit cost</th>
              <th className="px-3 py-2">Effective from</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {costs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-black/50 dark:text-white/50">
                  No costs entered yet.
                </td>
              </tr>
            )}
            {costs.map((cost) => (
              <tr key={cost.id} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2 font-mono text-xs">{cost.partnerItemId}</td>
                <td className="px-3 py-2">{cost.unitCost}</td>
                <td className="px-3 py-2">{cost.effectiveFrom}</td>
                <td className="px-3 py-2">{cost.note}</td>
                <td className="px-3 py-2 text-right">
                  <DeleteCostButton id={cost.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
