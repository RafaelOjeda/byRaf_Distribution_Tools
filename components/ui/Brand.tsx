"use client";

import clsx from "clsx";
import { useStyles } from "./ThemeProvider";

/** The app's mark and name at the left of the top bar. */
export function Brand() {
  const { brand } = useStyles();
  return (
    <>
      <span aria-hidden="true" className={brand.checker}>
        <span className="bg-sc-ink" />
        <span className="bg-white" />
        <span className="bg-white" />
        <span className="bg-sc-ink" />
      </span>
      <span aria-hidden="true" className={brand.tile}>
        bR
      </span>
      <span className={clsx(brand.name)}>byRaf</span>
      <span aria-hidden="true" className={brand.divider} />
    </>
  );
}
