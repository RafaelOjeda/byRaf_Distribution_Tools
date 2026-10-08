import { themeConfig } from "./config";

/** The designs the app can wear. Add a name here and TypeScript asks for its file in ./themes. */
export const THEMES = ["retro", "modern"] as const;
export type Theme = (typeof THEMES)[number];

/** The only thing remembered between visits: a UI preference, never any seller data. */
export const THEME_COOKIE = "theme";

/** A known theme name, or the configured default for anything else. */
export function parseTheme(value: string | null | undefined, config = themeConfig): Theme {
  return THEMES.find((t) => t === value) ?? config.defaultTheme;
}

/** The design to render, given the saved cookie value: the saved choice, unless switching is turned off. */
export function resolveTheme(cookieValue: string | null | undefined, config = themeConfig): Theme {
  return config.allowSwitching ? parseTheme(cookieValue, config) : config.defaultTheme;
}
