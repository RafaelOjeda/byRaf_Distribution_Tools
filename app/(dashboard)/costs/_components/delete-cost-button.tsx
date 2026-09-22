"use client";

import { useTransition } from "react";
import { removeCost } from "../actions";

export function DeleteCostButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => removeCost(id))}
      disabled={pending}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
