export type ButtonVariant = "default" | "primary";
export type ButtonSize = "md" | "sm";

/**
 * Every design-dependent class name in the app. A design is one file in this
 * folder that exports an object of this shape; the kit components read it, so
 * pages never name a design. TypeScript rejects a design that misses a slot.
 */
export interface ThemeStyles {
  /** <body>: page background, text colour, font. */
  body: string;
  /** Shape of the top bar (its colours come from the shared sc-* tokens). */
  menuBar: string;
  card: string;
  /** A link in the top bar's page navigation; `active` is added for the current page. */
  nav: { link: string; active: string };
  /** The wrapper around a page's content: the retro window, or nothing on modern. */
  page: string;
  /** The summary tiles at the top of the dashboard. */
  kpi: {
    grid: string;
    tile: string;
    /** Extra classes for the one tile that leads the row. */
    hero: string;
    label: string;
    value: string;
    heroValue: string;
    note: string;
  };
  button: {
    base: string;
    variant: Record<ButtonVariant, string>;
    size: Record<ButtonSize, string>;
  };
  /** A button that reads as a link. */
  textButton: string;
  input: string;
  table: string;
  tabList: string;
  tab: string;
}
