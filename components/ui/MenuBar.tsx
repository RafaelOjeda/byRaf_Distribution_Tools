"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useStyles } from "./ThemeProvider";

/** The top bar. Pass the contents; the width, spacing and colours are the kit's. */
export function MenuBar({ children }: { children: ReactNode }) {
  return (
    <header className={clsx("bg-sc-nav border-sc-line text-sc-ink", useStyles().menuBar)}>
      <div className="mx-auto flex h-11 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        {children}
      </div>
    </header>
  );
}
