import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The gateway boundary (docs/multi-marketplace-plan.md, "Keeping
    // the boundary honest"): app/ may see the public contract and the
    // server actions, never a connector, the engine internals, or any
    // other lib/gateway/* subpath directly.
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/gateway/*/**",
                "!@/lib/gateway/actions",
              ],
              message:
                "app/ may only import '@/lib/gateway' and '@/lib/gateway/actions' - see docs/multi-marketplace-plan.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
