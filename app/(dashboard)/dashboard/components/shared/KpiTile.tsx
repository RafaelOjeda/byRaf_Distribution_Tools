"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useStyles } from "@/components/ui";

export function KpiTile({
  label,
  value,
  hero = false,
  children,
}: {
  label: string;
  value: string;
  /** The tile that leads the row (Profit); the design decides how much bigger it gets. */
  hero?: boolean;
  children?: ReactNode;
}) {
  const { kpi } = useStyles();
  return (
    <div className={clsx(kpi.tile, hero && kpi.hero)}>
      <div className={kpi.label}>{label}</div>
      <div className={hero ? kpi.heroValue : kpi.value}>{value}</div>
      <div className={kpi.note}>{children}</div>
    </div>
  );
}
