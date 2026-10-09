import { MenuBar, NavLinks, Page, ThemeToggle } from "@/components/ui";
import { UserMenu } from "@/lib/auth";
import { DashboardDataProvider } from "./dashboard/DashboardDataProvider";
import { ReceiptsButton } from "./receipts/ReceiptsButton";
import { ReceiptsProvider } from "./receipts/ReceiptsProvider";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <ReceiptsProvider>
      <DashboardDataProvider>
        <div className="flex min-h-dvh flex-col">
          <MenuBar>
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
            <span aria-hidden="true" className="hidden h-4 w-px bg-sc-ink/30 sm:block" />
            <NavLinks
              links={[
                { href: "/dashboard", label: "Dashboard" },
                { href: "/margins", label: "Margins" },
              ]}
            />
            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />
              <ReceiptsButton />
              <UserMenu />
            </div>
          </MenuBar>
          {/* The content always sits on a solid card, never on the page
              background (the retro design's dither shows in the gutters). */}
          <main className="mx-auto w-full max-w-[1600px] flex-1 p-3 sm:p-6">
            <Page>{children}</Page>
          </main>
        </div>
      </DashboardDataProvider>
    </ReceiptsProvider>
  );
}
