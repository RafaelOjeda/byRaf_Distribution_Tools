/**
 * Checks that every .env combination picks the right auth provider, and
 * that a half-configured one fails closed instead of leaving the app open.
 * Run with: npx tsx scripts/test-auth.ts
 */
import assert from "node:assert/strict";
import { AuthConfigError, resolveAuthConfig } from "../lib/auth/config";

const PK = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
const SK = "sk_test_abc123";

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

function rejects(env: Record<string, string>, pattern: RegExp) {
  assert.throws(
    () => resolveAuthConfig(env),
    (err: unknown) => err instanceof AuthConfigError && pattern.test(err.message)
  );
}

check("no env at all: auth off, implicitly", () => {
  assert.deepEqual(resolveAuthConfig({}), { provider: "none", explicit: false });
});

check("AUTH_PROVIDER=none: auth off, explicitly", () => {
  assert.deepEqual(resolveAuthConfig({ AUTH_PROVIDER: "none" }), {
    provider: "none",
    explicit: true,
  });
});

check("AUTH_PROVIDER=none wins over stray Clerk keys", () => {
  assert.equal(
    resolveAuthConfig({ AUTH_PROVIDER: "none", CLERK_SECRET_KEY: SK }).provider,
    "none"
  );
});

check("Clerk keys alone turn Clerk on", () => {
  assert.deepEqual(
    resolveAuthConfig({ CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: SK }),
    { provider: "clerk", publishableKey: PK }
  );
});

check("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is accepted (Clerk/Vercel naming)", () => {
  const config = resolveAuthConfig({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK,
    CLERK_SECRET_KEY: SK,
  });
  assert.equal(config.provider === "clerk" && config.publishableKey, PK);
});

check("the secret key never appears in the resolved config", () => {
  const config = resolveAuthConfig({ CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: SK });
  assert.ok(!JSON.stringify(config).includes(SK));
});

check("values are trimmed and AUTH_PROVIDER is case-insensitive", () => {
  const config = resolveAuthConfig({
    AUTH_PROVIDER: " Clerk ",
    CLERK_PUBLISHABLE_KEY: ` ${PK}\n`,
    CLERK_SECRET_KEY: SK,
  });
  assert.deepEqual(config, { provider: "clerk", publishableKey: PK });
});

check("only a secret key: fails closed, not open", () => {
  rejects({ CLERK_SECRET_KEY: SK }, /CLERK_PUBLISHABLE_KEY/);
});

check("only a publishable key: fails closed, not open", () => {
  rejects({ CLERK_PUBLISHABLE_KEY: PK }, /CLERK_SECRET_KEY/);
});

check("AUTH_PROVIDER=clerk with no keys names both", () => {
  rejects({ AUTH_PROVIDER: "clerk" }, /CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY/);
});

check("unknown AUTH_PROVIDER is rejected", () => {
  rejects({ AUTH_PROVIDER: "auth0" }, /not one of: none, clerk/);
});

check("keys swapped or malformed are rejected", () => {
  rejects({ CLERK_PUBLISHABLE_KEY: SK, CLERK_SECRET_KEY: PK }, /pk_test_ or pk_live_/);
  rejects({ CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: "secret" }, /sk_test_ or sk_live_/);
});

check("test publishable key with live secret key is rejected", () => {
  rejects(
    { CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: "sk_live_abc" },
    /different Clerk instances/
  );
});

check("blank values count as unset", () => {
  assert.equal(
    resolveAuthConfig({ CLERK_PUBLISHABLE_KEY: "  ", CLERK_SECRET_KEY: "" }).provider,
    "none"
  );
});

console.log(`\n${passed} passed`);
