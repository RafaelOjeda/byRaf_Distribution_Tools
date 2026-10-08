import type { Theme } from "./theme";

export type ButtonVariant = "default" | "primary";
export type ButtonSize = "md" | "sm";

/**
 * Every design-dependent class name in the app, in one place. The kit
 * components (Button, Card, ...) read from here, so pages never name a
 * design. `satisfies Record<Theme, ThemeStyles>` below makes a new theme
 * fail to compile until it styles every slot.
 *
 * retro  - the existing sc-* classes in app/globals.css.
 * modern - daisyUI's Bootstrap-style components (see the "modern" theme there).
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

export const styles = {
  retro: {
    body: "",
    menuBar: "border-b-[1.5px]",
    card: "sc-card",
    button: {
      base: "",
      variant: { default: "sc-btn", primary: "sc-btn-primary" },
      size: { md: "", sm: "px-3 py-0.5 text-xs" },
    },
    textButton: "sc-link",
    input: "sc-input",
    table: "sc-table",
    tabList: "flex gap-6 overflow-x-auto border-b border-sc-line px-4 sm:px-6",
    tab: "sc-tab",
  },
  modern: {
    body: "bg-base-200 text-base-content antialiased",
    menuBar: "border-b shadow-sm",
    card: "card card-border bg-base-100 shadow-sm",
    button: {
      // max-md:min-h-11 keeps the 44px phone tap target the retro rules give.
      base: "btn max-md:min-h-11",
      variant: { default: "btn-outline btn-secondary", primary: "btn-primary" },
      size: { md: "", sm: "btn-sm" },
    },
    textButton: "link link-primary max-md:inline-flex max-md:min-h-11 max-md:items-center",
    input: "input",
    table: "table table-sm",
    tabList: "tabs tabs-border flex-nowrap overflow-x-auto px-4 sm:px-6",
    tab: "tab whitespace-nowrap",
  },
} satisfies Record<Theme, ThemeStyles>;
