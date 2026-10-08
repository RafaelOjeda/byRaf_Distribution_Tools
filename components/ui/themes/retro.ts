import type { ThemeStyles } from "./types";

/** The classic-Mac look: the existing sc-* classes in app/globals.css. */
export const retro: ThemeStyles = {
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
};
