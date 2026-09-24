"use client";

import { useState, useSyncExternalStore } from "react";

/*
 * "Add to Home Screen" banner shown on the sign-in screen, so it is visible
 * before anyone has entered anything.
 *
 * Android/Chrome lets a page trigger the install prompt itself (the
 * beforeinstallprompt event), so there the button really installs. iOS has no
 * such API - Apple only allows Share > Add to Home Screen - so there the button
 * shows the steps instead.
 *
 * beforeinstallprompt fires once, early in page load, long before the reports
 * step renders, so it is captured at module load rather than in the component.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "byraf-install-dismissed";

let deferred: InstallEvent | null = null;
let dismissedThisSession = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

type Platform = "ios" | "android" | "chromium" | null;

function detect(): Platform {
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed =
    window.matchMedia("(display-mode: standalone)").matches || nav.standalone;
  if (installed) return null; // already running as the app
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so tell it apart by touch support.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1))
    return "ios";
  if (/Android/.test(ua)) return "android";
  return deferred ? "chromium" : null;
}

function readDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// One primitive snapshot so React can compare it cheaply. The server snapshot
// is "hidden", so the first client render matches the server's HTML and the
// real state appears right after hydration.
const snapshot = () =>
  `${readDismissed() ? "hidden" : (detect() ?? "hidden")}|${deferred ? "native" : "manual"}`;
const serverSnapshot = () => "hidden|manual";
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export default function InstallPrompt() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [showSteps, setShowSteps] = useState(false);
  const [platform, mode] = state.split("|") as [
    Platform | "hidden",
    "native" | "manual",
  ];

  if (platform === "hidden") return null;

  function dismiss() {
    dismissedThisSession = true;
    notify();
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // private mode: it just shows again next time
    }
  }

  async function install() {
    if (!deferred) {
      setShowSteps((v) => !v); // iOS, or Android without the native prompt
      return;
    }
    const prompt = deferred;
    deferred = null; // a prompt can only be used once
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") dismiss();
    else notify();
  }

  const native = mode === "native";

  return (
    <section
      aria-label="Install as an app"
      className="sc-card mx-auto mt-3 flex w-full max-w-md flex-col gap-2 border-l-4 border-l-sc-accent p-3 sm:mt-6 sm:gap-3 sm:p-4"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-xl border border-sc-line"
        />
        <div className="flex-1">
          <h2 className="text-base font-bold">Add this to your home screen</h2>
          <p className="mt-0.5 text-sm text-sc-ink-2">
            Opens full screen, like an app.
          </p>
        </div>
      </div>

      {showSteps && !native && (
        <ol className="list-decimal space-y-1 pl-9 text-sm">
          {platform === "ios" ? (
            <>
              <li>
                Tap the <strong>Share</strong> button{" "}
                <ShareIcon /> in Safari&rsquo;s toolbar.
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong>.
              </li>
            </>
          ) : (
            <>
              <li>
                Tap the <strong>⋮</strong> menu in your browser.
              </li>
              <li>
                Tap <strong>Install app</strong> (or{" "}
                <strong>Add to Home screen</strong>).
              </li>
            </>
          )}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={install} className="sc-btn-primary">
          {native ? "Install app" : showSteps ? "Hide steps" : "Show me how"}
        </button>
        <button type="button" onClick={dismiss} className="sc-link text-sm">
          Not now
        </button>
      </div>
    </section>
  );
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      className="inline-block align-text-bottom text-sc-link"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 11v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}
