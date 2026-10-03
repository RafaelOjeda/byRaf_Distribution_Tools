import type { NextProxy } from "next/server";
import type { ReactNode } from "react";
import type { AuthProviderId } from "./config";

/** Who is making this request. `userId` is the key future saved data hangs off. */
export interface AuthSession {
  provider: AuthProviderId;
  /** Stable per user for the provider. "anonymous" when auth is off. */
  userId: string;
}

/**
 * Everything the app needs from an auth provider. Adding a provider (Auth0,
 * Cognito, Supabase, Auth.js...) means one file in ./providers implementing
 * this, plus a case in ./index.ts and ./config.ts - nothing under app/.
 */
export interface AuthAdapter {
  id: AuthProviderId;
  /** Runs in proxy.ts on every page request: redirect or reject the signed-out. */
  proxy: NextProxy;
  /** Null when signed out. Must be cheap: called by every server action. */
  getSession(): Promise<AuthSession | null>;
  /** Wraps the whole app in app/layout.tsx. */
  Provider(props: { children: ReactNode }): ReactNode;
  /** Account button in the dashboard header; null when there's nothing to show. */
  UserMenu(): ReactNode;
  /** The /sign-in page body. */
  SignIn(): ReactNode;
}

export const SIGN_IN_PATH = "/sign-in";
export const HOME_PATH = "/dashboard";
