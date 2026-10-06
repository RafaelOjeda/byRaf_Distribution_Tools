"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useReceipts, type Receipt, type UploadResult } from "./ReceiptsProvider";
import { formatBytes, zipReceipts } from "./utils";

const RESULT_MARK: Record<UploadResult["status"], string> = {
  added: "✓",
  duplicate: "⚠",
  rejected: "✗",
};

function when(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function saveUrl(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The Receipts folder: a modal window over whatever page is showing. */
export function ReceiptsPanel() {
  const { receipts, open, setOpen, addFiles, rename, remove, urlFor } = useReceipts();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function handleFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setResults(await addFiles(files));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  function view(r: Receipt) {
    window.open(urlFor(r), "_blank", "noopener");
  }

  function startRename(r: Receipt) {
    setConfirmId(null);
    setRenamingId(r.id);
    setRenameValue(r.name.replace(/\.pdf$/i, ""));
  }

  function submitRename(e: FormEvent) {
    e.preventDefault();
    if (renamingId) rename(renamingId, renameValue);
    setRenamingId(null);
  }

  async function downloadAll() {
    setZipping(true);
    try {
      const entries = await Promise.all(
        receipts.map(async (r) => ({
          name: r.name,
          data: new Uint8Array(await r.blob.arrayBuffer()),
        }))
      );
      const zip = await zipReceipts(entries);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      saveUrl(url, `receipts-${new Date().toISOString().slice(0, 10)}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setZipping(false);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = q ? receipts.filter((r) => r.name.toLowerCase().includes(q)) : receipts;
  const totalBytes = receipts.reduce((n, r) => n + r.size, 0);

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setOpen(false)}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      aria-labelledby="receipts-title"
      className="sc-card m-auto max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-2xl p-0 backdrop:bg-black/40 open:flex open:flex-col"
    >
      <div className="flex items-center justify-between gap-3 border-b border-sc-line bg-sc-head px-4 py-2">
        <h2 id="receipts-title" className="text-lg font-bold">
          Receipts
        </h2>
        <button type="button" onClick={() => setOpen(false)} className="sc-btn px-3 py-0.5 text-xs">
          Close
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="text-sm text-sc-ink-2">
          A folder for your PDF receipts. They stay in this tab only —{" "}
          <strong className="text-sc-ink">refresh or close the page and they&apos;re gone</strong>,
          so download a backup before you leave. They aren&apos;t attached to any product yet.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 border-[1.5px] border-dashed border-sc-ink p-4 text-center ${
            dragging ? "bg-sc-head" : ""
          }`}
        >
          <span className="hidden text-sm text-sc-ink-2 sm:inline">Drag PDFs here, or</span>
          <button type="button" onClick={() => fileRef.current?.click()} className="sc-btn-primary">
            + Add receipts
          </button>
          <span className="text-xs text-sc-ink-2">PDF only, up to 10 MB each</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose PDF receipts"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = ""; // so the same file can be picked again
            }}
          />
        </div>

        {results.length > 0 && (
          <div className="flex flex-col gap-1 border-[1.5px] border-sc-ink p-3 text-sm">
            <ul aria-live="polite" className="flex flex-col gap-1">
              {results.map((r, i) => (
                <li key={i} className={r.status === "rejected" ? "text-red-600" : undefined}>
                  <span aria-hidden="true">{RESULT_MARK[r.status]}</span>{" "}
                  <strong>{r.name}</strong> — {r.message}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setResults([])} className="sc-link self-start text-xs">
              Dismiss
            </button>
          </div>
        )}

        {receipts.length > 1 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search receipts by name"
            className="sc-input w-full"
          />
        )}

        {receipts.length === 0 ? (
          <p className="text-sm text-sc-ink-2">No receipts yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-sc-ink-2">No receipts match &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 border-b border-sc-line/30 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                {renamingId === r.id ? (
                  <form onSubmit={submitRename} className="flex w-full flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation(); // don't also close the dialog
                          setRenamingId(null);
                        }
                      }}
                      aria-label={`New name for ${r.name}`}
                      className="sc-input min-w-0 flex-1"
                    />
                    <span className="text-sm text-sc-ink-2">.pdf</span>
                    <button type="submit" className="sc-btn px-3 py-0.5 text-xs">
                      Save
                    </button>
                    <button type="button" onClick={() => setRenamingId(null)} className="sc-link text-xs">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold" title={r.name}>
                        {r.name}
                      </div>
                      <div className="text-xs text-sc-ink-2">
                        {when(r.addedAt)} · {formatBytes(r.size)}
                      </div>
                    </div>
                    {confirmId === r.id ? (
                      <div className="flex shrink-0 items-center gap-3 text-sm">
                        <span>Delete? Can&apos;t be undone.</span>
                        <button
                          type="button"
                          onClick={() => {
                            remove(r.id);
                            setConfirmId(null);
                          }}
                          className="sc-link font-bold"
                        >
                          Yes, delete
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)} className="sc-link">
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <button type="button" onClick={() => view(r)} className="sc-link" aria-label={`View ${r.name}`}>
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => saveUrl(urlFor(r), r.name)}
                          className="sc-link"
                          aria-label={`Download ${r.name}`}
                        >
                          Download
                        </button>
                        <button type="button" onClick={() => startRename(r)} className="sc-link" aria-label={`Rename ${r.name}`}>
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(null);
                            setConfirmId(r.id);
                          }}
                          className="sc-link"
                          aria-label={`Delete ${r.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sc-line bg-sc-head px-4 py-2">
        <span className="text-sm text-sc-ink-2">
          {receipts.length} receipt{receipts.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
        </span>
        <button
          type="button"
          onClick={() => void downloadAll()}
          disabled={receipts.length === 0 || zipping}
          className="sc-btn px-3 py-0.5 text-xs"
        >
          {zipping ? "Zipping…" : "Download all (.zip)"}
        </button>
      </div>
    </dialog>
  );
}
