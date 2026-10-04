import "server-only";

import { connection } from "next/server";
import type { NextProxy } from "next/server";
import type { ReactNode } from "react";
import { resolveAuthConfig, type AuthProviderId } from "./config";
import { noneAdapter } from "./providers/none";
import type { AuthAdapter, AuthSession } from "./types";

/**
 * The app's only door to authentication. app/, proxy.ts and lib/gateway
 * use these exports and never a provider SDK directly, so switching
 * providers is a .env change plus one adapter file.
 */

export type { AuthSession, AuthProviderId };
export { SIGN_IN_PATH, HOME_PATH } from "./types";

let cached: Promise<AuthAdapter> | undefined;

function loadAdapter(): Promise<AuthAdapter> {
  // process.env is read here, at request time, never at build time - so a
  // single build (or Docker image) takes its auth settings from the host.
  const config = resolveAuthConfig(process.env);
  switch (config.provider) {
    case "clerk":
      // Lazy, so Clerk's code never runs when auth is off.
      return import("./providers/clerk").then((m) =>
        m.createClerkAdapter(config.publishableKey)
      );
    case "none":
      if (!config.explicit && process.env.NODE_ENV === "production") {
        console.warn(
          "[auth] No auth provider configured - the app is open to anyone. Set AUTH_PROVIDER=none to silence this."
        );
      }
      return Promise.resolve(noneAdapter);
  }
}

export function getAuthAdapter(): Promise<AuthAdapter> {
  // Don't cache a rejection: a misconfigured env should fail every request
  // loudly (closed), not once and then hang on a settled promise.
  cached ??= loadAdapter().catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

/** The signed-in user, or null. With auth off, always the anonymous user. */
export async function getSession(): Promise<AuthSession | null> {
  return (await getAuthAdapter()).getSession();
}

/** For server actions: they are public POST endpoints, so the proxy alone isn't enough. */
export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw new Error("Sign in required.");
  return session;
}

export const authProxy: NextProxy = async (req, event) =>
  (await getAuthAdapter()).proxy(req, event);

// The components below call connection() first: it marks the render as
// per-request, which is what keeps the env lookup out of the build.

export async function AuthProvider({ children }: { children: ReactNode }) {
  await connection();
  const { Provider } = await getAuthAdapter();
  return <Provider>{children}</Provider>;
}

export async function UserMenu() {
  await connection();
  const adapter = await getAuthAdapter();
  return adapter.UserMenu();
}

export async function SignInScreen() {
  await connection();
  const adapter = await getAuthAdapter();
  return adapter.SignIn();
}
