"use client";

import clsx from "clsx";
import type { ElementType, HTMLAttributes } from "react";
import { useStyles } from "./ThemeProvider";

/** The bordered surface everything sits on. `as="fieldset"` keeps a form group's semantics. */
export function Card({
  as: Tag = "div",
  className,
  ...props
}: { as?: "div" | "fieldset" } & HTMLAttributes<HTMLElement>) {
  const Component: ElementType = Tag;
  return <Component className={clsx(useStyles().card, className)} {...props} />;
}
