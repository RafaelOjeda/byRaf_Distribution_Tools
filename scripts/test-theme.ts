/**
 * Checks for the design switcher in components/ui: theme parsing, that both
 * designs style every slot, that neither design leaks the other's class
 * names, and that app/globals.css backs every class and colour token the
 * class map relies on. Same plain-tsx convention as test-portable.ts.
 * Run with: npx tsx scripts/test-theme.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { themeConfig } from "../components/ui/config";
import { styles } from "../components/ui/styles";
import { THEMES, parseTheme, resolveTheme } from "../components/ui/theme";

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

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Every class-name string in a ThemeStyles object, flattened to single tokens. */
function tokens(node: unknown): string[] {
  if (typeof node === "string") return node.split(/\s+/).filter(Boolean);
  return Object.values(node as Record<string, unknown>).flatMap(tokens);
}
/** The shape of a ThemeStyles object: its key paths. */
function shape(node: unknown, path = ""): string[] {
  if (typeof node === "string") return [path];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => shape(v, `${path}.${k}`));
}

check("parseTheme accepts known themes and falls back to the configured default", () => {
  for (const t of THEMES) assert.equal(parseTheme(t), t);
  for (const bad of [undefined, null, "", "dark", "RETRO", "modern ", "__proto__"]) {
    assert.equal(parseTheme(bad), themeConfig.defaultTheme, String(bad));
  }
});

check("the configured default is a real theme with its own file", () => {
  assert.ok((THEMES as readonly string[]).includes(themeConfig.defaultTheme));
  for (const t of THEMES) {
    assert.ok(existsSync(new URL(`../components/ui/themes/${t}.ts`, import.meta.url)), `themes/${t}.ts`);
  }
});

check("a different configured default is honoured for unknown or missing values", () => {
  const cfg = { defaultTheme: "modern", allowSwitching: true } as const;
  assert.equal(parseTheme(undefined, cfg), "modern");
  assert.equal(parseTheme("nonsense", cfg), "modern");
  assert.equal(parseTheme("retro", cfg), "retro");
});

check("resolveTheme honours the saved choice only while switching is allowed", () => {
  const open = { defaultTheme: "retro", allowSwitching: true } as const;
  const locked = { defaultTheme: "modern", allowSwitching: false } as const;
  assert.equal(resolveTheme("modern", open), "modern");
  assert.equal(resolveTheme(undefined, open), "retro");
  for (const saved of ["retro", "modern", "junk", undefined]) {
    assert.equal(resolveTheme(saved, locked), "modern", String(saved));
  }
});

check("the class map has exactly one entry per theme", () => {
  assert.deepEqual(Object.keys(styles).sort(), [...THEMES].sort());
});

check("every theme styles every slot (same shape)", () => {
  const [first, ...rest] = THEMES;
  for (const t of rest) assert.deepEqual(shape(styles[t]), shape(styles[first]), t);
});

const RETRO_COMPONENT = /^sc-(card|btn|btn-primary|link|input|table|tab)$/;
const DAISY_COMPONENT = /^(btn|card|input|table|tabs|tab|link)$/;

check("modern uses no retro component classes", () => {
  assert.deepEqual(tokens(styles.modern).filter((t) => RETRO_COMPONENT.test(t)), []);
});

check("retro uses no daisyUI component classes", () => {
  assert.deepEqual(tokens(styles.retro).filter((t) => DAISY_COMPONENT.test(t)), []);
});

check("every retro sc-* class is defined in globals.css", () => {
  for (const token of tokens(styles.retro).filter((t) => RETRO_COMPONENT.test(t))) {
    assert.match(css, new RegExp(`\\.${token}\\b`), token);
  }
});

check("every --color-sc-* token is overridden by the modern theme", () => {
  const theme = css.match(/@plugin "daisyui\/theme" \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(theme, /name: "modern";/);
  const themeBlock = css.match(/@theme \{[\s\S]*?\n\}/)?.[0] ?? "";
  const declared = [...themeBlock.matchAll(/(--color-sc-[a-z0-9-]+):/g)].map((m) => m[1]);
  assert.ok(declared.length >= 8, `found only ${declared.length} sc tokens`);
  for (const token of declared) {
    assert.match(theme, new RegExp(`${token}:`), `${token} is not overridden by the modern theme`);
  }
});

check("the retro-only global rules are scoped to the retro theme", () => {
  // Unlayered rules beat Tailwind utilities, so an unscoped body/scrollbar rule would leak into modern.
  assert.doesNotMatch(css, /^body\s*\{/m);
  assert.doesNotMatch(css, /^::-webkit-scrollbar/m);
  assert.match(css, /\[data-theme="retro"\] body/);
});

console.log(`\n${passed} passed`);
