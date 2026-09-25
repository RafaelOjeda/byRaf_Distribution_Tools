import type { ReactNode } from "react";

/** A small label-over-value pair for the phone cards. */
export function Fig({
  label,
  children,
  className = "",
  title,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={className} title={title}>
      <dt className="text-xs text-sc-ink-2">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}
