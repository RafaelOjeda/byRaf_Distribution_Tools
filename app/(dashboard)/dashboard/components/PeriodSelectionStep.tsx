import type { SourceDescriptor } from "@/lib/middleware";

export function PeriodSelectionStep({
  sources,
  filledSourceIds,
  periodsBySource,
  selectedPeriods,
  loading,
  error,
  onTogglePeriod,
  onStartOver,
  onLoadSelected,
}: {
  sources: SourceDescriptor[];
  filledSourceIds: string[];
  periodsBySource: Record<string, { periods: { id: string; label: string }[]; error?: string }>;
  selectedPeriods: Record<string, Set<string>>;
  loading: boolean;
  error: string | null;
  onTogglePeriod: (sourceId: string, periodId: string) => void;
  onStartOver: () => void;
  onLoadSelected: () => void;
}) {
  const settlementSources = sources.filter(
    (s) => filledSourceIds.includes(s.id) && s.capabilities.settlements
  );
  const totalSelected = Object.values(selectedPeriods).reduce(
    (n, set) => n + set.size,
    0
  );

  return (
    <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[28px] leading-9 font-normal">Settlement periods</h1>
        <button onClick={onStartOver} className="sc-link mt-2 shrink-0 text-sm">
          Start over
        </button>
      </div>
      {settlementSources.map((s) => {
        const list = periodsBySource[s.id];
        if (!list) return null;
        if (list.error) {
          return (
            <p key={s.id} className="text-sm text-red-600">
              {s.label}: {list.error}
            </p>
          );
        }
        return (
          <div key={s.id} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold">{s.label}</h2>
            <div className="flex flex-col overflow-hidden rounded-lg border border-sc-line">
              {list.periods.map((p) => (
                <label
                  key={p.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-sc-row px-3 py-2.5 text-sm last:border-b-0 hover:bg-sc-head"
                >
                  <input
                    type="checkbox"
                    checked={selectedPeriods[s.id]?.has(p.id) ?? false}
                    onChange={() => onTogglePeriod(s.id, p.id)}
                  />
                  {p.label}
                </label>
              ))}
              {list.periods.length === 0 && (
                <p className="px-3 py-2.5 text-sm text-sc-ink-2">
                  Nothing available for this account yet.
                </p>
              )}
            </div>
          </div>
        );
      })}
      <button
        onClick={onLoadSelected}
        disabled={loading || (settlementSources.length > 0 && totalSelected === 0)}
        className="sc-btn-primary w-full"
      >
        {loading ? "Loading…" : "Load data"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
