"use client";

import { Button } from "./Button";
import { THEMES, type Theme } from "./theme";
import { useTheme } from "./ThemeProvider";

const LABEL: Record<Theme, string> = { retro: "Retro", modern: "Modern" };

/** Menu-bar button that flips between the designs; shows the one it will switch to. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  return (
    <Button
      size="sm"
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${LABEL[next].toLowerCase()} design`}
      title={`Switch to the ${LABEL[next].toLowerCase()} design`}
    >
      {LABEL[next]} UI
    </Button>
  );
}
