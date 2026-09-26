/** A "—" for a value that isn't there. `variant="warn"` for values that should be entered but aren't; the default for values that just don't apply. */
export function Unset({
  variant = "muted",
  title,
}: {
  variant?: "muted" | "warn";
  title?: string;
}) {
  return (
    <span className={variant === "warn" ? "text-amber-600" : "text-sc-ink-2/70"} title={title}>
      —
    </span>
  );
}
