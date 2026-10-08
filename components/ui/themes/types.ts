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
