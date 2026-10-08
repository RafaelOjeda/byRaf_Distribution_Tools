"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { styles, type ThemeStyles } from "./styles";
import { THEME_COOKIE, type Theme } from "./theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Holds the active design. `initialTheme` comes from the cookie on the server,
 * so server and client render the same classes (no flash, no mismatch).
 * Switching updates the context, the <html data-theme> attribute (which the
 * daisyUI theme and the retro-only global CSS key off) and the cookie.
 */
export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** The class names of the active design - for the rare element that is not a kit component. */
export function useStyles(): ThemeStyles {
  return styles[useTheme().theme];
}
