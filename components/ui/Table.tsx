"use client";

import clsx from "clsx";
import type { TableHTMLAttributes } from "react";
import { useStyles } from "./ThemeProvider";

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={clsx(useStyles().table, className)} {...props} />;
}
