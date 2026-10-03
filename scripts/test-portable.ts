/**
 * Fixture checks for the portable save/load file (zipped CSV bundle and
 * single CSV) in lib/gateway/engine/portable. Same plain-tsx convention
 * as test-csv-import.ts.
 * Run with: npx tsx scripts/test-portable.ts
 */
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import writeExcelFile from "write-excel-file/universal";
import {
  applyImport,
  exportCsvBundle,
  exportWorkbook,
  parseImportFile,
  type PortableData,
} from "../lib/gateway/engine/portable";
import { costsToCsv } from "../lib/gateway/engine/csv";

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

const sample: PortableData = {
  inputs: {
    "00123": {
      lots: [
        { qty: 24, unitCost: 3.5 },
        { qty: 12, unitCost: 3.75 },
      ],
      boxCost: 0.42,
      boxLength: 10,
      boxWidth: 8,
      boxHeight: 4,
      aliasSkus: ["AMZ-LEGO-01", "EBAY-LEGO-1"],
    },
    "CAFÉ-1": { boxCost: 0.3 },
    "=EVIL": { lots: [{ qty: 1, unitCost: 2 }] },
  },
  settings: {
    sourceFilter: ["walmart", "demo"],
    selectedPeriods: { walmart: ["2026-09-01", "2026-09-15"], demo: ["d1"] },
  },
};

const NOW = "2026-10-03T00:00:00.000Z";
const zipOf = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const csv = (s: string) => strToU8(s);

check("CSV bundle round-trips, incl. leading zeros, unicode and formula-looking SKUs", async () => {
  const r = await parseImportFile(await exportCsvBundle(sample, NOW));
  assert.deepEqual(r.errors, []);
  assert.equal(r.format, "zip");
  assert.equal(r.schemaVersion, 1);
  assert.deepEqual(r.data, sample);
  assert.deepEqual(r.stats, { skus: 3, batches: 3, boxed: 2, aliased: 1, skippedRows: 0 });
});

check("macOS-style zip (files in a folder, __MACOSX junk) still imports", async () => {
  const r = await parseImportFile(
    zipOf({
      "export/costs.csv": "SKU,Batch Qty,Batch Unit Cost\r\nA1,2,1.5\r\n",
      "__MACOSX/export/._costs.csv": "\u0000junk",
    })
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.inputs, { A1: { lots: [{ qty: 2, unitCost: 1.5 }] } });
});

check("legacy cost CSV (joined alias cell) imports", async () => {
  const text = costsToCsv(["ABC-1"], {
    "ABC-1": { lots: [{ qty: 5, unitCost: 2 }], boxCost: 1, aliasSkus: ["X-1", "Y-2"] },
  });
  const r = await parseImportFile(csv(text));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.inputs["ABC-1"].aliasSkus, ["X-1", "Y-2"]);
  assert.equal(r.data.inputs["ABC-1"].boxCost, 1);
});

check("a lone Costs / Boxes / Aliases CSV is detected from its headers", async () => {
  const costs = await parseImportFile(csv("sku,batch qty,batch unit cost\na,1,2\n"));
  assert.deepEqual(costs.data.inputs, { A: { lots: [{ qty: 1, unitCost: 2 }] } });
  const boxes = await parseImportFile(csv("SKU,Box Cost\nA,0.5\n"));
  assert.deepEqual(boxes.data.inputs, { A: { boxCost: 0.5 } });
  const aliases = await parseImportFile(csv("SKU,Alias SKU\nA,B\nA,B\nA,C\n"));
  assert.deepEqual(aliases.data.inputs, { A: { aliasSkus: ["B", "C"] } });
});

check("semicolon CSV with decimal commas imports", async () => {
  const r = await parseImportFile(csv("SKU;Batch Qty;Batch Unit Cost\nA;2;3,5\nB;1;\"1.234,50\"\n"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.inputs.A.lots, [{ qty: 2, unitCost: 3.5 }]);
  assert.deepEqual(r.data.inputs.B.lots, [{ qty: 1, unitCost: 1234.5 }]);
});

check("'$' and thousands commas are tolerated; '3,5' in a comma file is an error, not 35", async () => {
  const ok = await parseImportFile(csv('SKU,Batch Qty,Batch Unit Cost\nA,"1,000",$2.50\n'));
  assert.deepEqual(ok.data.inputs.A.lots, [{ qty: 1000, unitCost: 2.5 }]);
  const bad = await parseImportFile(csv('SKU,Batch Qty,Batch Unit Cost\nA,1,"3,5"\n'));
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.stats.skippedRows, 1);
});

check("row errors name the table and row; good rows still import", async () => {
  const r = await parseImportFile(
    csv("SKU,Batch Qty,Batch Unit Cost\nA,0,1\nB,2,3\n,1,1\nC,1,\n")
  );
  assert.deepEqual(r.data.inputs, { B: { lots: [{ qty: 2, unitCost: 3 }] } });
  assert.deepEqual(
    r.errors.map((e) => [e.table, e.row]),
    [["Costs", 2], ["Costs", 4], ["Costs", 5]]
  );
});

check("newer schema_version is rejected", async () => {
  const r = await parseImportFile(
    zipOf({
      "meta.csv": "Key,Value\r\nschema_version,99\r\n",
      "costs.csv": "SKU,Batch Qty,Batch Unit Cost\r\nA,1,1\r\n",
    })
  );
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /version 99/);
  assert.deepEqual(r.data.inputs, {});
});

check("rejects: empty, binary, unknown columns, missing SKU, zip with no tables", async () => {
  assert.equal((await parseImportFile(new Uint8Array())).errors.length, 1);
  assert.match((await parseImportFile(new Uint8Array([1, 0, 2, 3]))).errors[0].message, /isn't an/);
  assert.match((await parseImportFile(csv("a,b\n1,2\n"))).errors[0].message, /Unrecognized/);
  assert.match((await parseImportFile(csv("Box Cost,Batch Qty\n1,2\n"))).errors[0].message, /SKU/);
  const r = await parseImportFile(zipOf({ "readme.txt": "hi" }));
  assert.match(r.errors[0].message, /No Costs/);
});

check("zip bomb and corrupt zip are rejected, not thrown", async () => {
  const bomb = zipOf({ "costs.csv": "SKU,Batch Qty,Batch Unit Cost\n" + "A,1,1\n".repeat(400_000) });
  const r = await parseImportFile(bomb);
  assert.equal(r.errors.length > 0, true);
  const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);
  assert.equal((await parseImportFile(corrupt)).errors.length > 0, true);
});

check("settings round-trip; unknown settings keys warn", async () => {
  const r = await parseImportFile(
    zipOf({
      "settings.csv": "Key,Source,Value\r\nsource_filter,,all\r\nperiod,demo,d1\r\nfoo,,bar\r\n",
    })
  );
  assert.deepEqual(r.data.settings, { sourceFilter: "all", selectedPeriods: { demo: ["d1"] } });
  assert.equal(r.warnings.length, 1);
});

check("diff vs current inputs; merge keeps untouched SKUs, replace drops them", async () => {
  const current = {
    A: { lots: [{ qty: 1, unitCost: 1 }], boxCost: 9 },
    B: { lots: [{ qty: 1, unitCost: 1 }] },
    Z: { boxCost: 5 },
  };
  const file = zipOf({
    "costs.csv": "SKU,Batch Qty,Batch Unit Cost\r\nA,2,2\r\nB,1,1\r\nN,3,3\r\n",
  });
  const r = await parseImportFile(file, current);
  assert.deepEqual(r.diff, { added: ["N"], changed: ["A"], unchanged: ["B"] });
  const merged = applyImport(current, r.data.inputs, "merge");
  assert.deepEqual(merged.A, { lots: [{ qty: 2, unitCost: 2 }], boxCost: 9 });
  assert.deepEqual(merged.Z, { boxCost: 5 });
  const replaced = applyImport(current, r.data.inputs, "replace");
  assert.equal("Z" in replaced, false);
});

check("XLSX workbook round-trips, incl. leading zeros, unicode and formula-looking SKUs", async () => {
  const r = await parseImportFile(await exportWorkbook(sample, NOW));
  assert.deepEqual(r.errors, []);
  assert.equal(r.format, "xlsx");
  assert.deepEqual(r.data, sample);
});

check("XLSX and CSV bundle carry identical data", async () => {
  const x = await parseImportFile(await exportWorkbook(sample, NOW));
  const z = await parseImportFile(await exportCsvBundle(sample, NOW));
  assert.deepEqual(x.data, z.data);
  assert.deepEqual(x.stats, z.stats);
});

check("hand-edited workbook: numeric SKU cells, odd header case, extra sheet/column, blank rows", async () => {
  const blob = await writeExcelFile([
    {
      sheet: "costs",
      data: [
        ["sku", "BATCH QTY", "Batch Unit Cost", "Notes"],
        [123, 4, 2.5, "typed as a number"],
        [null, null, null, null],
        ["B-2", "6", 1, "qty typed as text"],
      ],
    },
    { sheet: "Report - By SKU", data: [["SKU", "Net"], ["A", 1]] },
  ]).toBlob();
  const r = await parseImportFile(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.inputs, {
    "123": { lots: [{ qty: 4, unitCost: 2.5 }] },
    "B-2": { lots: [{ qty: 6, unitCost: 1 }] },
  });
});

check("a non-xlsx zip-like or corrupt .xlsx is rejected, not thrown", async () => {
  const bogus = zipOf({ "xl/workbook.xml": "<nope/>" });
  const r = await parseImportFile(bogus);
  assert.equal(r.errors.length > 0, true);
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
