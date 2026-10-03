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
    // The auth boundary (docs/systems/authentication.md): only a provider
    // adapter may touch a provider SDK, so swapping providers stays a
    // one-file change. The app/ block below repeats this pattern because
    // a later block's rule options replace this one for app/ files.
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/auth/providers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@clerk/*"],
              message:
                "Only lib/auth/providers/ may import an auth SDK - use '@/lib/auth' (see docs/systems/authentication.md).",
            },
          ],
        },
      ],
    },
  },
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
            {
              group: ["@/lib/auth/*"],
              message: "app/ may only import '@/lib/auth' - see docs/systems/authentication.md.",
            },
            {
              group: ["@clerk/*"],
              message:
                "Only lib/auth/providers/ may import an auth SDK - use '@/lib/auth' (see docs/systems/authentication.md).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
