"use client";

import clsx from "clsx";
import type { InputHTMLAttributes } from "react";
import { useStyles } from "./ThemeProvider";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(useStyles().input, className)} {...props} />;
}
