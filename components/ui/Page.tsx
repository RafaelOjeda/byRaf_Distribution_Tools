"use client";

import clsx from "clsx";
import type { HTMLAttributes } from "react";
import { useStyles } from "./ThemeProvider";

/** The wrapper around a page's content - a window on retro, bare page on modern. */
export function Page({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(useStyles().page, className)} {...props} />;
}
