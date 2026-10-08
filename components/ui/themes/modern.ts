import type { ThemeStyles } from "./types";

/**
 * The Bootstrap-style look: daisyUI component classes. Its colours come from
 * the "modern" theme block in app/globals.css.
 */
export const modern: ThemeStyles = {
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
};
