export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-sc-nav text-white">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <span className="text-[17px] font-bold tracking-tight">BYRAF</span>
          <span aria-hidden="true" className="h-5 w-px bg-white/30" />
          <span className="text-sm text-white/90">Walmart Margin Tracker</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
