/**
 * Crude but effective: fails if anything under app/ names a marketplace
 * outside a comment - the ESLint rule in eslint.config.mjs catches import
 * paths, this catches copy like "Walmart says 3 on hand" creeping back
 * into a component. See docs/multi-marketplace-plan.md, "Keeping the
 * boundary honest".
 *
 * Run with: npx tsx scripts/check-boundary.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP_DIR = join(__dirname, "..", "app");
const MARKETPLACE_NAMES = ["walmart", "amazon", "ebay"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

/** Strips // line comments and /* block comments (JSX {/* *\/} included) so a doc comment doesn't trip the check. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function findHits(text: string): { name: string; line: number }[] {
  const hits: { name: string; line: number }[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const name of MARKETPLACE_NAMES) {
      if (new RegExp(`\\b${name}\\b`, "i").test(line)) {
        hits.push({ name, line: i + 1 });
      }
    }
  });
  return hits;
}

let failed = false;
for (const file of walk(APP_DIR)) {
  const stripped = stripComments(readFileSync(file, "utf8"));
  const hits = findHits(stripped);
  if (hits.length === 0) continue;
  failed = true;
  const rel = relative(process.cwd(), file);
  for (const hit of hits) {
    console.error(`${rel}:${hit.line}: names "${hit.name}" - app/ must stay marketplace-neutral`);
  }
}

if (failed) {
  console.error(
    "\ncheck:boundary failed - see docs/multi-marketplace-plan.md, \"Keeping the boundary honest\"."
  );
  process.exit(1);
}
console.log("check:boundary ok - no marketplace names found under app/.");
