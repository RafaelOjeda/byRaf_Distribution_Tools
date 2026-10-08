/** The designs the app can wear. Add a name here and TypeScript asks for its styles in styles.ts. */
export const THEMES = ["retro", "modern"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "retro";

/** The only thing remembered between visits: a UI preference, never any seller data. */
export const THEME_COOKIE = "theme";

export function parseTheme(value: string | null | undefined): Theme {
  return THEMES.find((t) => t === value) ?? DEFAULT_THEME;
}
