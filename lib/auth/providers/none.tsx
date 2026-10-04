import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type { AuthAdapter } from "../types";
import { HOME_PATH } from "../types";

/** Auth off: everyone is the same anonymous user, which is the app's original behavior. */
export const noneAdapter: AuthAdapter = {
  id: "none",
  proxy: () => NextResponse.next(),
  getSession: async () => ({ provider: "none", userId: "anonymous" }),
  Provider: ({ children }) => children,
  UserMenu: () => null,
  SignIn: () => redirect(HOME_PATH),
};
