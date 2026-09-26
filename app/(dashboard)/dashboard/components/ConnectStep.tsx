import type { FormEvent } from "react";
import type { SourceDescriptor } from "@/lib/middleware";
import InstallPrompt from "../InstallPrompt";

export function ConnectStep({
  sources,
  connections,
  onCredentialChange,
  loading,
  error,
  filledSourceIds,
  onSubmit,
}: {
  sources: SourceDescriptor[];
  connections: Record<string, Record<string, string>>;
  onCredentialChange: (sourceId: string, key: string, value: string) => void;
  loading: boolean;
  error: string | null;
  filledSourceIds: string[];
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <>
      <div className="mx-auto mt-2 sm:mt-8 flex w-full max-w-md flex-col gap-5">
        <div>
          <h1 className="text-[28px] leading-9 font-normal">Connect a source</h1>
          <p className="mt-2 text-sm text-sc-ink-2">
            Paste API credentials for one or more marketplaces to see
            what&apos;s available. Nothing is saved anywhere — refresh this
            page and it&apos;s gone.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {sources.map((s) => (
            <fieldset key={s.id} className="sc-card flex flex-col gap-3 p-4">
              <legend className="px-1 text-sm font-bold">{s.label}</legend>
              {s.credentialFields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm font-bold">
                  {f.label}
                  <input
                    type={f.secret ? "password" : "text"}
                    value={connections[s.id]?.[f.key] ?? ""}
                    onChange={(e) => onCredentialChange(s.id, f.key, e.target.value)}
                    className="sc-input font-normal"
                    autoComplete="off"
                  />
                  {f.help && (
                    <span className="text-xs font-normal text-sc-ink-2">{f.help}</span>
                  )}
                </label>
              ))}
            </fieldset>
          ))}
          <button
            type="submit"
            disabled={loading || filledSourceIds.length === 0}
            className="sc-btn-primary mt-1 w-full"
          >
            {loading ? "Checking…" : "See what's available"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
      <InstallPrompt />
    </>
  );
}
