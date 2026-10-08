/**
 * Fixture checks for the Receipts folder helpers in
 * app/(dashboard)/receipts/utils.ts (PDF sniffing, upload limits, name
 * cleanup, duplicate detection, zip backup). Same plain-tsx convention as
 * test-portable.ts. The React panel itself is checked by hand in a browser.
 * Run with: npx tsx scripts/test-receipts.ts
 */
import assert from "node:assert/strict";
import { strToU8, unzipSync } from "fflate";
import {
  MAX_NAME_LENGTH,
  MAX_RECEIPT_BYTES,
  MAX_TOTAL_BYTES,
  cleanFileName,
  formatBytes,
  looksLikePdf,
  precheck,
  sha256Hex,
  uniqueName,
  zipReceipts,
} from "../app/(dashboard)/receipts/utils";

let passed = 0;
const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  pending.push(
    (async () => {
      try {
        await fn();
        passed++;
        console.log(`ok - ${name}`);
      } catch (err) {
        console.error(`FAIL - ${name}`);
        console.error(err);
        process.exitCode = 1;
      }
    })()
  );
}

const pdf = strToU8("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");

check("recognises a PDF by its header, not its name", () => {
  assert.equal(looksLikePdf(pdf), true);
  assert.equal(looksLikePdf(strToU8("hello,world\n1,2")), false);
  assert.equal(looksLikePdf(strToU8("PK\u0003\u0004 zip data")), false);
  assert.equal(looksLikePdf(new Uint8Array()), false);
});

check("accepts a PDF header after up to 1024 bytes of leading junk, not beyond", () => {
  const junk = (n: number) => new Uint8Array(n).fill(0x20);
  const withJunk = (n: number) => Uint8Array.from([...junk(n), ...pdf]);
  assert.equal(looksLikePdf(withJunk(100)), true);
  assert.equal(looksLikePdf(withJunk(2000)), false);
});

check("precheck enforces empty, per-file and whole-folder limits", () => {
  assert.equal(precheck(1024, 0), null);
  assert.match(precheck(0, 0) ?? "", /empty/);
  assert.equal(precheck(MAX_RECEIPT_BYTES, 0), null);
  assert.match(precheck(MAX_RECEIPT_BYTES + 1, 0) ?? "", /per file/);
  assert.match(precheck(1024, MAX_TOTAL_BYTES - 1000) ?? "", /folder is full/);
  assert.equal(precheck(1000, MAX_TOTAL_BYTES - 1000), null);
});

check("cleanFileName strips paths and unsafe characters and always ends in .pdf", () => {
  assert.equal(cleanFileName("invoice.pdf"), "invoice.pdf");
  assert.equal(cleanFileName("INVOICE.PDF"), "INVOICE.pdf");
  assert.equal(cleanFileName("C:\\Users\\me\\scan.pdf"), "scan.pdf");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd.pdf");
  assert.equal(cleanFileName('a<b>c:d"e|f?g*h.pdf'), "abcdefgh.pdf");
  assert.equal(cleanFileName("bad\u0000name\u001f.pdf"), "badname.pdf");
  assert.equal(cleanFileName("  spaced   out  .pdf"), "spaced out.pdf");
  assert.equal(cleanFileName(".hidden.pdf"), "hidden.pdf");
  assert.equal(cleanFileName(""), "receipt.pdf");
  assert.equal(cleanFileName("???.pdf"), "receipt.pdf");
  assert.equal(cleanFileName("Café ☕ 2026.pdf"), "Café ☕ 2026.pdf");
  const long = cleanFileName(`${"x".repeat(500)}.pdf`);
  assert.equal(long.length <= MAX_NAME_LENGTH, true);
  assert.equal(long.endsWith(".pdf"), true);
});

check("uniqueName numbers collisions case-insensitively", () => {
  assert.equal(uniqueName("a.pdf", new Set()), "a.pdf");
  assert.equal(uniqueName("a.pdf", new Set(["a.pdf"])), "a (2).pdf");
  assert.equal(uniqueName("A.pdf", new Set(["a.pdf", "a (2).pdf"])), "A (3).pdf");
});

check("formatBytes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2.5 * 1024 * 1024), "2.5 MB");
});

check("sha256Hex is stable, and differs for different content", async () => {
  assert.equal(
    await sha256Hex(strToU8("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(await sha256Hex(pdf), await sha256Hex(Uint8Array.from(pdf)));
  assert.notEqual(await sha256Hex(pdf), await sha256Hex(strToU8("%PDF-1.4 other")));
});

check("zipReceipts round-trips every file byte for byte", async () => {
  const other = strToU8("%PDF-1.7\nsecond receipt");
  const zip = await zipReceipts([
    { name: "one.pdf", data: pdf },
    { name: "two (2).pdf", data: other },
  ]);
  const files = unzipSync(zip);
  assert.deepEqual(Object.keys(files).sort(), ["one.pdf", "two (2).pdf"]);
  assert.deepEqual(files["one.pdf"], pdf);
  assert.deepEqual(files["two (2).pdf"], other);
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
