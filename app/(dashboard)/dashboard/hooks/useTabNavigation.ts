import { useEffect, useState, type KeyboardEvent } from "react";
import type { Step, Tab } from "../types";

const TAB_ORDER: Tab[] = ["sku", "orders", "price", "inventory", "stock", "fees"];

export function useTabNavigation(step: Step) {
  const [tab, setTab] = useState<Tab>("sku");

  // On a phone the tab bar scrolls sideways, so a tab selected from
  // elsewhere (e.g. the Profit tile's link) can be off-screen.
  useEffect(() => {
    if (step !== "data") return;
    document
      .getElementById(`tab-${tab}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, step]);

  // Arrow keys move between tabs, per the ARIA tabs pattern.
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = TAB_ORDER.indexOf(tab);
    const next =
      TAB_ORDER[(i + (e.key === "ArrowRight" ? 1 : TAB_ORDER.length - 1)) % TAB_ORDER.length];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return { tab, setTab, onTabKey };
}
