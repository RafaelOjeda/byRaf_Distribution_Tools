import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Margins Dashboard",
  description: "BYRAF Distribution — multi-marketplace seller margin tracker",
  // iOS ignores most of the manifest: these make Add to Home Screen open
  // full-screen with a proper name.
  appleWebApp: {
    capable: true,
    title: "Margins",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: "#232f3e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
