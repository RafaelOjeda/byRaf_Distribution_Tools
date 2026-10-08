import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function KpiTile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <Card className="flex w-[68%] shrink-0 snap-start flex-col gap-1 p-4 sm:w-auto">
      <div className="text-xs font-bold text-sc-ink-2">{label}</div>
      <div className="text-2xl leading-8">{value}</div>
      <div className="text-xs leading-4 text-sc-ink-2">{children}</div>
    </Card>
  );
}
