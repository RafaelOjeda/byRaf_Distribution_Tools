"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { useStyles } from "./ThemeProvider";

/** The row of tabs. Callers supply the ARIA wiring (role="tablist", keyboard handling). */
export function TabList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(useStyles().tabList, className)} {...props} />;
}

/** One tab. Active state is `aria-selected`, which both designs style. */
export function TabButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={clsx(useStyles().tab, className)} {...props} />;
}
