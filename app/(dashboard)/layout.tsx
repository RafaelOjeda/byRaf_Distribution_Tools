import { Brand, MenuBar, NavLinks, Page, ThemeToggle } from "@/components/ui";
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
            <Brand />
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
