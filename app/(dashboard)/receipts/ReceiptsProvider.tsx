"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cleanFileName,
  looksLikePdf,
  precheck,
  sha256Hex,
  uniqueName,
} from "./utils";
import { ReceiptsPanel } from "./ReceiptsPanel";

export interface Receipt {
  /** The file's SHA-256, so the same file can't be added twice. */
  id: string;
  name: string;
  size: number;
  addedAt: number;
  blob: Blob;
}

export interface UploadResult {
  name: string;
  status: "added" | "duplicate" | "rejected";
  message: string;
}

interface ReceiptsContextValue {
  receipts: Receipt[];
  open: boolean;
  setOpen: (open: boolean) => void;
  addFiles: (files: File[]) => Promise<UploadResult[]>;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** A blob: URL for viewing/downloading, created on first use and reused. */
  urlFor: (receipt: Receipt) => string;
}

const ReceiptsContext = createContext<ReceiptsContextValue | null>(null);

export function useReceipts(): ReceiptsContextValue {
  const ctx = useContext(ReceiptsContext);
  if (!ctx) throw new Error("useReceipts must be used inside <ReceiptsProvider>");
  return ctx;
}

/**
 * The Receipts folder's state. It sits in the dashboard layout rather than on
 * its own page so that opening it never unmounts the dashboard (which would
 * throw away the credentials and costs typed in - nothing is saved anywhere).
 * Like everything else in the app it is stateless: a refresh empties it.
 */
export function ReceiptsProvider({ children }: { children: ReactNode }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [open, setOpen] = useState(false);
  // Mirrors `receipts` so overlapping uploads always see the latest list.
  const latest = useRef<Receipt[]>([]);
  const urls = useRef(new Map<string, string>());

  const commit = useCallback((next: Receipt[]) => {
    latest.current = next;
    setReceipts(next);
  }, []);

  const addFiles = useCallback(
    async (files: File[]): Promise<UploadResult[]> => {
      const results: UploadResult[] = [];
      for (const file of files) {
        const name = cleanFileName(file.name);
        const folderBytes = latest.current.reduce((n, r) => n + r.size, 0);
        const refusal = precheck(file.size, folderBytes);
        if (refusal) {
          results.push({ name, status: "rejected", message: `Not added: ${refusal}.` });
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!looksLikePdf(bytes)) {
            results.push({ name, status: "rejected", message: "Not added: it isn't a PDF." });
            continue;
          }
          const id = await sha256Hex(bytes);
          const existing = latest.current.find((r) => r.id === id);
          if (existing) {
            results.push({
              name,
              status: "duplicate",
              message: `Already added as ${existing.name}.`,
            });
            continue;
          }
          const taken = new Set(latest.current.map((r) => r.name.toLowerCase()));
          const finalName = uniqueName(name, taken);
          commit([
            {
              id,
              name: finalName,
              size: bytes.byteLength,
              addedAt: Date.now(),
              // Always served as a PDF, whatever the browser guessed from the file.
              blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            },
            ...latest.current,
          ]);
          results.push({ name: finalName, status: "added", message: "Added." });
        } catch {
          results.push({ name, status: "rejected", message: "Not added: the file couldn't be read." });
        }
      }
      return results;
    },
    [commit]
  );

  const rename = useCallback(
    (id: string, raw: string) => {
      const others = new Set(
        latest.current.filter((r) => r.id !== id).map((r) => r.name.toLowerCase())
      );
      const name = uniqueName(cleanFileName(raw), others);
      commit(latest.current.map((r) => (r.id === id ? { ...r, name } : r)));
    },
    [commit]
  );

  const remove = useCallback(
    (id: string) => {
      const url = urls.current.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        urls.current.delete(id);
      }
      commit(latest.current.filter((r) => r.id !== id));
    },
    [commit]
  );

  const urlFor = useCallback((receipt: Receipt) => {
    let url = urls.current.get(receipt.id);
    if (!url) {
      url = URL.createObjectURL(receipt.blob);
      urls.current.set(receipt.id, url);
    }
    return url;
  }, []);

  useEffect(() => {
    const held = urls.current;
    return () => {
      for (const url of held.values()) URL.revokeObjectURL(url);
      held.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ receipts, open, setOpen, addFiles, rename, remove, urlFor }),
    [receipts, open, addFiles, rename, remove, urlFor]
  );

  return (
    <ReceiptsContext.Provider value={value}>
      {children}
      <ReceiptsPanel />
    </ReceiptsContext.Provider>
  );
}
