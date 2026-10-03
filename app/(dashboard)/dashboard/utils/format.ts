export const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Hands a string to the browser as a file. Nothing leaves the page. */
export function downloadCsv(prefix: string, csv: string) {
  downloadBlob(
    `${prefix}-${localDate()}.csv`,
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
}

/** Binary exports (xlsx, zip), named `<prefix>-YYYY-MM-DD.<ext>`. */
export function downloadBytes(
  prefix: string,
  ext: "xlsx" | "zip",
  bytes: Uint8Array,
  mime: string
) {
  downloadBlob(
    `${prefix}-${localDate()}.${ext}`,
    new Blob([bytes as BlobPart], { type: mime })
  );
}
