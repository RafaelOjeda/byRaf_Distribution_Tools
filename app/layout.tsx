import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
