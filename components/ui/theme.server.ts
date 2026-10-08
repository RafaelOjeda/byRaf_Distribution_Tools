import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, resolveTheme, type Theme } from "./theme";

/** The design for this request, so the very first paint is already in it. */
export async function getTheme(): Promise<Theme> {
  return resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
}
