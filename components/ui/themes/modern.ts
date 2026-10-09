import type { ThemeStyles } from "./types";

/**
 * The rounded, pill-button look: daisyUI component classes on a pale
 * blue-grey page with large white cards, black primary pills and an orange
 * accent. Its colours come from the "modern" theme block in app/globals.css.
 */
export const modern: ThemeStyles = {
  body: "bg-base-200 text-base-content antialiased",
  menuBar: "border-b border-base-300",
  card: "card bg-base-100",
  nav: {
    link: "inline-flex min-h-9 items-center rounded-full px-4 text-sm font-semibold text-sc-ink-2 hover:text-sc-ink max-md:min-h-11",
    active: "bg-neutral text-neutral-content hover:text-neutral-content",
  },
  // No outer window: the page's own cards sit straight on the page colour.
  page: "py-1 sm:py-2",
  kpi: {
    // Phone: a swipeable row. From lg up the lead tile spans two columns and
    // two rows, with the other four filling a 2x2 beside it.
    grid: "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4",
    tile: "card bg-base-100 flex w-[72%] shrink-0 snap-start flex-col gap-1 p-5 sm:w-auto sm:p-6",
    hero: "order-first sm:col-span-3 lg:col-span-2 lg:row-span-2 lg:justify-between lg:p-8",
    label: "text-sm font-semibold text-sc-ink-2",
    value: "text-3xl leading-9 font-medium tracking-tight",
    heroValue: "text-5xl leading-none font-medium tracking-tight sm:text-6xl",
    note: "text-sm leading-5 text-sc-ink-2",
  },
  button: {
    // max-md:min-h-11 keeps the 44px phone tap target the retro rules give.
    base: "btn max-md:min-h-11 rounded-full font-semibold",
    variant: { default: "btn-outline btn-secondary", primary: "btn-primary" },
    size: { md: "", sm: "btn-sm" },
  },
  textButton: "link link-accent font-semibold max-md:inline-flex max-md:min-h-11 max-md:items-center",
  input: "input rounded-full",
  table: "table table-sm",
  tabList: "flex flex-nowrap gap-1.5 overflow-x-auto px-4 pt-4 pb-1 sm:px-6 sm:pt-6",
  tab: "rounded-full bg-base-200 px-5 text-sm font-semibold whitespace-nowrap text-sc-ink-2 min-h-11 hover:text-sc-ink aria-selected:bg-accent aria-selected:text-accent-content",
};
