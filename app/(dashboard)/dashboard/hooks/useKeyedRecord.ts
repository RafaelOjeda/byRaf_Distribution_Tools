import { useState } from "react";

/**
 * State shaped as Record<string, T> - SKU- or source-keyed connection
 * credentials, cost inputs, lot drafts, alias drafts, selected periods -
 * with one per-key updater instead of a bespoke setState wrapper for
 * each field. `update(key, value)` replaces that key outright;
 * `update(key, prev => next)` is fed the key's current value
 * (undefined if unset) for merge/append/toggle. The raw setter is also
 * returned for bulk resets and full replacements.
 */
export function useKeyedRecord<T>(initial: Record<string, T> = {}) {
  const [record, setRecord] = useState<Record<string, T>>(initial);

  function update(key: string, next: T | ((prev: T | undefined) => T)) {
    setRecord((prev) => ({
      ...prev,
      [key]: typeof next === "function" ? (next as (p: T | undefined) => T)(prev[key]) : next,
    }));
  }

  return [record, update, setRecord] as const;
}
