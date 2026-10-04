/**
 * Which auth provider to run, decided from environment variables alone so
 * the same build works on Vercel, a Linux box, AWS, Google Cloud or Docker.
 *
 * Pure (no Next or provider imports) so scripts/test-auth.ts can exercise
 * every env combination. See docs/systems/authentication.md.
 */

export const AUTH_PROVIDERS = ["none", "clerk"] as const;
export type AuthProviderId = (typeof AUTH_PROVIDERS)[number];

export type AuthConfig =
  | { provider: "none"; explicit: boolean }
  // The secret key is validated but deliberately not carried here: Clerk
  // reads CLERK_SECRET_KEY itself, so it can't leak into a client prop.
  | { provider: "clerk"; publishableKey: string };

export type Env = Record<string, string | undefined>;

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(`Auth misconfigured: ${message} See docs/systems/authentication.md.`);
    this.name = "AuthConfigError";
  }
}

function read(env: Env, ...names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function resolveClerk(env: Env): AuthConfig {
  // NEXT_PUBLIC_ is accepted because Clerk's own docs and its Vercel
  // integration use it; the unprefixed name is preferred because Next
  // freezes NEXT_PUBLIC_ values into the bundle at build time.
  const publishableKey = read(
    env,
    "CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  );
  const secretKey = read(env, "CLERK_SECRET_KEY");

  const missing = [
    !publishableKey && "CLERK_PUBLISHABLE_KEY",
    !secretKey && "CLERK_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AuthConfigError(`Clerk needs ${missing.join(" and ")}.`);
  }
  if (!/^pk_(test|live)_/.test(publishableKey)) {
    throw new AuthConfigError(
      "CLERK_PUBLISHABLE_KEY should start with pk_test_ or pk_live_."
    );
  }
  if (!/^sk_(test|live)_/.test(secretKey)) {
    throw new AuthConfigError(
      "CLERK_SECRET_KEY should start with sk_test_ or sk_live_."
    );
  }
  if (publishableKey.slice(3, 7) !== secretKey.slice(3, 7)) {
    throw new AuthConfigError(
      "CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are from different Clerk instances (one test, one live)."
    );
  }
  return { provider: "clerk", publishableKey };
}

/**
 * AUTH_PROVIDER picks the provider explicitly. Left unset, any Clerk key
 * turns Clerk on, and no keys means auth is off. A half-set provider throws
 * rather than quietly falling back to "none" and leaving the app open.
 */
export function resolveAuthConfig(env: Env): AuthConfig {
  const requested = read(env, "AUTH_PROVIDER").toLowerCase();

  if (requested) {
    if (!(AUTH_PROVIDERS as readonly string[]).includes(requested)) {
      throw new AuthConfigError(
        `AUTH_PROVIDER="${requested}" is not one of: ${AUTH_PROVIDERS.join(", ")}.`
      );
    }
    if (requested === "clerk") return resolveClerk(env);
    return { provider: "none", explicit: true };
  }

  const anyClerkKey = read(
    env,
    "CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY"
  );
  if (anyClerkKey) return resolveClerk(env);
  return { provider: "none", explicit: false };
}
