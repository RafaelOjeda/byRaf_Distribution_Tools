import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BYRAF Walmart Margin Tracker",
    short_name: "Margins",
    description: "BYRAF Distribution — Walmart seller margin tracker",
    start_url: "/margins",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eaeded",
    theme_color: "#232f3e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
