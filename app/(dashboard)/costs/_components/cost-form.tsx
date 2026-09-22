"use client";

import { useActionState } from "react";
import { addCost, type CostFormState } from "../actions";

const initialState: CostFormState = { error: null };

export function CostForm({ knownSkus }: { knownSkus: string[] }) {
  const [state, formAction, pending] = useActionState(addCost, initialState);

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-md border border-black/10 p-4 dark:border-white/15"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="sku" className="text-xs text-black/60 dark:text-white/60">
          SKU
        </label>
        <input
          id="sku"
          name="sku"
          list="known-skus"
          required
          className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
        />
        <datalist id="known-skus">
          {knownSkus.map((sku) => (
            <option key={sku} value={sku} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="unitCost" className="text-xs text-black/60 dark:text-white/60">
          Unit cost
        </label>
        <input
          id="unitCost"
          name="unitCost"
          type="number"
          step="0.0001"
          min="0"
          required
          className="w-28 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="effectiveFrom" className="text-xs text-black/60 dark:text-white/60">
          Effective from
        </label>
        <input
          id="effectiveFrom"
          name="effectiveFrom"
          type="date"
          required
          className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="note" className="text-xs text-black/60 dark:text-white/60">
          Note
        </label>
        <input
          id="note"
          name="note"
          className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Saving…" : "Add cost"}
      </button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
