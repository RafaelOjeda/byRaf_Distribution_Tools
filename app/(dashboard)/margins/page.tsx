export default async function MarginsPage({
  searchParams,
}: PageProps<"/margins">) {
  await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Margins</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Per-order-line profit and margin, computed from synced Walmart
        settlement data and your SKU costs. Not wired up yet — see
        walmart-margin-tracker-plan.md, Phase 6.
      </p>
    </div>
  );
}
