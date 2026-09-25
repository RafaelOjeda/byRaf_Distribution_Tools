export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Classic Mac menu bar: white strip, black text, single black rule
          underneath - never inverted, unlike a pulled-down menu. */}
      <header className="bg-sc-nav border-b-[1.5px] border-sc-line text-sc-ink">
        <div className="mx-auto flex h-11 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <span
            aria-hidden="true"
            className="grid h-4 w-4 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden border border-sc-line"
          >
            <span className="bg-sc-ink" />
            <span className="bg-white" />
            <span className="bg-white" />
            <span className="bg-sc-ink" />
          </span>
          <span className="text-[15px] font-bold tracking-tight">BYRAF</span>
          <span aria-hidden="true" className="h-4 w-px bg-sc-ink/30" />
          <span className="text-sm text-sc-ink-2">Margins Dashboard</span>
        </div>
      </header>
      {/* The desktop's dither shows in the gutter around this window - the
          content itself always sits on solid white, never on the pattern. */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 p-3 sm:p-6">
        <div className="sc-card px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
