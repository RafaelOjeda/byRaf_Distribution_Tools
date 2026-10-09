"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useStyles } from "./ThemeProvider";

/** The top bar. Pass the contents; the width, spacing and colours are the kit's. */
export function MenuBar({ children }: { children: ReactNode }) {
  const { menuBar, menuBarInner } = useStyles();
  return (
    <header className={clsx("border-sc-line text-sc-ink", menuBar)}>
      <div className={clsx("mx-auto flex max-w-[1600px] items-center gap-3 px-4 sm:px-6", menuBarInner)}>
        {children}
      </div>
    </header>
  );
}
