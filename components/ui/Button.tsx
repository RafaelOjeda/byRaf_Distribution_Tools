"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";
import type { ButtonSize, ButtonVariant } from "./styles";
import { useStyles } from "./ThemeProvider";

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Button classes for elements that are not a <button> (e.g. a <summary>). */
export function useButtonClass() {
  const { button } = useStyles();
  return ({ variant = "default", size = "md" }: ButtonStyleOptions = {}) =>
    clsx(button.base, button.variant[variant], button.size[size]);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonStyleOptions & ButtonHTMLAttributes<HTMLButtonElement>) {
  const buttonClass = useButtonClass();
  return <button type={type} className={clsx(buttonClass({ variant, size }), className)} {...props} />;
}

/** A button that looks like a link. */
export function TextButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={clsx(useStyles().textButton, className)} {...props} />;
}
