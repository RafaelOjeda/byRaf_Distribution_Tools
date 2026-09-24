"use client";

import { useEffect, useState } from "react";

/*
 * "Add to Home Screen" banner shown right after credentials are accepted.
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
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
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
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  // Only ever rendered after a click (the reports step), never during server
  // rendering, so it's safe to read the browser here directly.
  const [platform, setPlatform] = useState<Platform>(detect);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const refresh = () => setPlatform(detect());
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, []);

  if (!platform || dismissed) return null;

  function dismiss() {
    setDismissed(true);
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
    else listeners.forEach((fn) => fn());
  }

  const native = deferred !== null;

  return (
    <section
      aria-label="Install as an app"
      className="sc-card mx-auto mt-6 flex w-full max-w-md flex-col gap-3 border-l-4 border-l-sc-accent p-4"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-xl border border-sc-line"
        />
        <div className="flex-1">
          <h2 className="text-base font-bold">Add this to your home screen</h2>
          <p className="mt-0.5 text-sm text-sc-ink-2">
            Open it like an app, full screen, with one tap. You&rsquo;ll still
            paste your credentials each time, since nothing is saved.
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
