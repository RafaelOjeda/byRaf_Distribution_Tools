import type { Theme } from "./theme";

/**
 * Which design the app wears. This is the one file to edit to change it.
 * (A design's colours live in app/globals.css; its class names in ./themes.)
 */
export const themeConfig: {
  /** The design visitors get until they pick one. */
  defaultTheme: Theme;
  /**
   * true  - the menu bar shows the Retro/Modern button and the choice is remembered.
   * false - everyone gets `defaultTheme`; the button is hidden and any saved choice is ignored.
   */
  allowSwitching: boolean;
} = {
  defaultTheme: "retro",
  allowSwitching: true,
};
