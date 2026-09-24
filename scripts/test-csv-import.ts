/**
 * Fixture checks for the cost CSV import/export in lib/csv.ts. No test
 * framework is set up in this repo, so this follows the same plain-tsx-
 * script convention as test-walmart-connection.ts.
 * Run with: npx tsx scripts/test-csv-import.ts
 */
import assert from "node:assert/strict";
import { costsToCsv, parseCostImportCsv } from "../lib/csv";
import type { SkuInputs } from "../lib/margin";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

check("multi-batch file with a box-only row parses cleanly", () => {
  const csv = [
    "SKU,Batch Qty,Batch Unit Cost,Box Cost,Box Length,Box Width,Box Height",
    "abc-1,24,3.50,0.42,10,8,4",
    "abc-1,12,3.75,,,,",
    "abc-2,,,0.30,6,6,6",
  ].join("\r\n");
  const result = parseCostImportCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.skus, 2);
  assert.equal(result.stats.batches, 2);
  assert.equal(result.stats.boxed, 2);
  assert.deepEqual(result.inputs["ABC-1"].lots, [
    { qty: 24, unitCost: 3.5 },
    { qty: 12, unitCost: 3.75 },
  ]);
  assert.equal(result.inputs["ABC-1"].boxCost, 0.42);
  assert.equal(result.inputs["ABC-2"].lots, undefined);
  assert.equal(result.inputs["ABC-2"].boxLength, 6);
});

check("missing SKU column is a hard error", () => {
  const result = parseCostImportCsv("Batch Qty,Batch Unit Cost\n1,2\n");
  assert.equal(result.stats.skus, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /SKU/);
});

check("blank SKU is skipped with a row error", () => {
  const result = parseCostImportCsv(
    "SKU,Batch Qty,Batch Unit Cost\n,1,2\nSKU-1,1,2\n"
  );
  assert.equal(result.stats.skippedRows, 1);
  assert.equal(result.stats.skus, 1);
  assert.equal(result.errors[0].row, 2);
});

check("one-sided batch qty/cost is a row error, not a silent partial batch", () => {
  const result = parseCostImportCsv("SKU,Batch Qty,Batch Unit Cost\nSKU-1,5,\n");
  assert.equal(result.stats.batches, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /both/);
});

check("non-numeric and negative cells are row errors", () => {
  const result = parseCostImportCsv(
    [
      "SKU,Batch Qty,Batch Unit Cost,Box Cost",
      "SKU-1,abc,2,",
      "SKU-2,1,-2,",
      "SKU-3,,,-.5",
    ].join("\n")
  );
  assert.equal(result.stats.skippedRows, 3);
  assert.match(result.errors[0].message, /not a number/);
  assert.match(result.errors[1].message, /negative/);
  assert.match(result.errors[2].message, /negative/);
});

check("conflicting box values across rows warn and keep the last one", () => {
  const result = parseCostImportCsv(
    [
      "SKU,Batch Qty,Batch Unit Cost,Box Cost",
      "SKU-1,1,2,0.10",
      "SKU-1,1,2,0.20",
    ].join("\n")
  );
  assert.equal(result.warnings.length, 1);
  assert.equal(result.inputs["SKU-1"].boxCost, 0.2);
});

check("a quoted field with an embedded comma round-trips", () => {
  const result = parseCostImportCsv(
    'SKU,Batch Qty,Batch Unit Cost\n"SKU, WITH COMMA",1,2\n'
  );
  assert.equal(result.stats.skus, 1);
  assert.ok(result.inputs["SKU, WITH COMMA"]);
});

check("costsToCsv -> parseCostImportCsv round-trips", () => {
  const inputs: Record<string, SkuInputs> = {
    "SKU-1": {
      lots: [
        { qty: 24, unitCost: 3.5 },
        { qty: 12, unitCost: 3.75 },
      ],
      boxCost: 0.42,
      boxLength: 10,
      boxWidth: 8,
      boxHeight: 4,
    },
    "SKU-2": { boxCost: 0.3 },
  };
  const csv = costsToCsv(["SKU-1", "SKU-2"], inputs);
  const result = parseCostImportCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.inputs, inputs);
});

console.log(`\n${passed} check(s) passed.`);
