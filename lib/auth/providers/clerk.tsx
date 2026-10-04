import "server-only";

import { ClerkProvider, SignIn, UserButton } from "@clerk/nextjs";
import {
  auth,
  clerkMiddleware,
  createRouteMatcher,
} from "@clerk/nextjs/server";
import type { NextProxy } from "next/server";
import type { AuthAdapter } from "../types";
import { HOME_PATH, SIGN_IN_PATH } from "../types";

const isPublicRoute = createRouteMatcher([`${SIGN_IN_PATH}(.*)`]);

/** The only file in the repo that imports @clerk/* (enforced in eslint.config.mjs). */
export function createClerkAdapter(publishableKey: string): AuthAdapter {
  // Keys are passed explicitly rather than left to Clerk's NEXT_PUBLIC_
  // lookup, so they're read at runtime and one build serves any .env.
  const proxy = clerkMiddleware(
    async (clerkAuth, req) => {
      if (!isPublicRoute(req)) await clerkAuth.protect();
    },
    { publishableKey, signInUrl: SIGN_IN_PATH }
  ) as NextProxy;

  return {
    id: "clerk",
    proxy,
    async getSession() {
      // Verifies the session token locally - no network call.
      const { userId } = await auth();
      return userId ? { provider: "clerk", userId } : null;
    },
    Provider: ({ children }) => (
      <ClerkProvider
        publishableKey={publishableKey}
        signInUrl={SIGN_IN_PATH}
        signInFallbackRedirectUrl={HOME_PATH}
        signUpFallbackRedirectUrl={HOME_PATH}
        afterSignOutUrl={SIGN_IN_PATH}
      >
        {children}
      </ClerkProvider>
    ),
    UserMenu: () => <UserButton />,
    SignIn: () => <SignIn routing="path" path={SIGN_IN_PATH} withSignUp />,
  };
}
