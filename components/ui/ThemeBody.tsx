"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useStyles } from "./ThemeProvider";

/** <body> as a client component, so it restyles the moment the theme is toggled. */
export function ThemeBody({ children }: { children: ReactNode }) {
  return <body className={clsx("min-h-full flex flex-col", useStyles().body)}>{children}</body>;
}
