"use client";

import { Button } from "@/components/ui";
import { useReceipts } from "./ReceiptsProvider";

/** Header button that opens the Receipts folder. */
export function ReceiptsButton() {
  const { receipts, setOpen } = useReceipts();
  return (
    <Button
      size="sm"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
    >
      Receipts{receipts.length > 0 ? ` (${receipts.length})` : ""}
    </Button>
  );
}
