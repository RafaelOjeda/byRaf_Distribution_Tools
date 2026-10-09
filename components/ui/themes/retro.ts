import type { ThemeStyles } from "./types";

/** The classic-Mac look: the existing sc-* classes in app/globals.css. */
export const retro: ThemeStyles = {
  body: "",
  menuBar: "border-b-[1.5px]",
  card: "sc-card",
  page: "sc-card px-4 py-6 sm:px-6",
  kpi: {
    // Phone: one swipeable row, so the data isn't pushed a screen and a
    // half down by five stacked tiles. Grid from sm up.
    grid: "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5",
    tile: "sc-card flex w-[68%] shrink-0 snap-start flex-col gap-1 p-4 sm:w-auto",
    hero: "",
    label: "text-xs font-bold text-sc-ink-2",
    value: "text-2xl leading-8",
    heroValue: "text-2xl leading-8",
    note: "text-xs leading-4 text-sc-ink-2",
  },
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
