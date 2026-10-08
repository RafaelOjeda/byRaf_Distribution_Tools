import type { Metadata, Viewport } from "next";
import { ThemeBody, ThemeProvider } from "@/components/ui";
import { getTheme } from "@/components/ui/theme.server";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Margins Dashboard",
  description: "BYRAF Distribution — multi-marketplace seller margin tracker",
  // iOS ignores most of the manifest: these make Add to Home Screen open
  // full-screen with a proper name.
  appleWebApp: {
    capable: true,
    title: "Margins",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getTheme();
  return (
    <html lang="en" data-theme={theme} className="h-full">
      <ThemeProvider initialTheme={theme}>
        <ThemeBody>
          <AuthProvider>{children}</AuthProvider>
        </ThemeBody>
      </ThemeProvider>
    </html>
  );
}
