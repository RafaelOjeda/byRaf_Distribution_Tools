/**
 * Pure helpers for the Receipts folder. No React and no browser-only APIs
 * beyond `crypto.subtle` (present in Node 20 too), so scripts/test-receipts.ts
 * can exercise them directly. Nothing here is persisted anywhere - the folder
 * lives in memory for the life of the tab.
 */

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // per file
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // whole folder, it is all held in memory
export const MAX_NAME_LENGTH = 120;

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * True when the bytes carry a PDF header. The spec lets "%PDF-" sit anywhere
 * in the first 1024 bytes, and viewers honour that, so this does too. The
 * file name proves nothing, which is why it is not consulted.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + PDF_SIGNATURE.length <= head.length; i++) {
    if (PDF_SIGNATURE.every((b, j) => head[i + j] === b)) return true;
  }
  return false;
}

/** A reason to refuse a file before reading it, or null when it is fine. */
export function precheck(size: number, folderBytes: number): string | null {
  if (size === 0) return "the file is empty";
  if (size > MAX_RECEIPT_BYTES) {
    return `over the ${formatBytes(MAX_RECEIPT_BYTES)} limit per file`;
  }
  if (folderBytes + size > MAX_TOTAL_BYTES) {
    return `the folder is full (${formatBytes(MAX_TOTAL_BYTES)} max)`;
  }
  return null;
}

/** Drops path parts and unsafe characters, and makes sure it ends in .pdf. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  let stem = "";
  for (const ch of base.replace(/\.pdf$/i, "")) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || '<>:"|?*'.includes(ch)) continue;
    stem += ch;
  }
  stem = stem.replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  if (!stem) stem = "receipt";
  return `${stem.slice(0, MAX_NAME_LENGTH - ".pdf".length).trim()}.pdf`;
}

/** "name.pdf" -> "name (2).pdf" until it no longer collides (case-insensitive). */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const stem = name.replace(/\.pdf$/i, "");
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n}).pdf`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fingerprint used to spot the same file added twice, whatever it is named. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bundles receipts into one zip. PDFs are already compressed, so entries are
 * stored rather than deflated. Callers pass names that are already unique.
 * fflate loads lazily, only when someone asks for the backup.
 */
export async function zipReceipts(
  entries: { name: string; data: Uint8Array }[]
): Promise<Uint8Array> {
  const { zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) files[e.name] = e.data;
  return zipSync(files, { level: 0 });
}
