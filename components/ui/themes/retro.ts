import type { ThemeStyles } from "./types";

/** The classic-Mac look: the existing sc-* classes in app/globals.css. */
export const retro: ThemeStyles = {
  body: "",
  menuBar: "border-b-[1.5px] bg-sc-nav",
  menuBarInner: "h-11",
  brand: {
    checker: "grid h-4 w-4 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden border border-sc-line",
    tile: "hidden",
    name: "text-[15px] font-bold tracking-tight uppercase",
    divider: "hidden h-4 w-px bg-sc-ink/30 sm:block",
  },
  card: "sc-card",
  nav: {
    list: "flex items-center gap-1",
    link: "px-2 py-1 text-sm underline-offset-2 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center",
    active: "font-bold underline",
  },
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
