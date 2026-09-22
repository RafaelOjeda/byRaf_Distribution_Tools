"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setState("syncing");
    setMessage(null);
    try {
      const res = await fetch("/api/sync/walmart", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Sync failed (${res.status})`);
      setMessage(
        `Synced ${data.reportDates.length} period(s), ${data.rowsIngested} row(s).`
      );
      setState("idle");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  return (
    <div className="ml-auto flex items-center gap-3">
      {message && (
        <span
          className={`text-xs ${state === "error" ? "text-red-600" : "text-black/60 dark:text-white/60"}`}
        >
          {message}
        </span>
      )}
      <button
        onClick={handleClick}
        disabled={state === "syncing"}
        className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
      >
        {state === "syncing" ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}
