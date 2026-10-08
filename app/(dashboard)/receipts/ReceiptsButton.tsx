"use client";

import { useReceipts } from "./ReceiptsProvider";

/** Header button that opens the Receipts folder. */
export function ReceiptsButton() {
  const { receipts, setOpen } = useReceipts();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      className="sc-btn px-3 py-0.5 text-xs"
    >
      Receipts{receipts.length > 0 ? ` (${receipts.length})` : ""}
    </button>
  );
}
