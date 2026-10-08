import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type Theme } from "./theme";

/** The visitor's chosen design, so the very first paint is already in it. */
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
