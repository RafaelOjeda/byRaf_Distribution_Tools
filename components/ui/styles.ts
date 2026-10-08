import { modern } from "./themes/modern";
import { retro } from "./themes/retro";
import type { ThemeStyles } from "./themes/types";
import type { Theme } from "./theme";

export type { ButtonSize, ButtonVariant, ThemeStyles } from "./themes/types";

/**
 * Every design, by name. `satisfies Record<Theme, ThemeStyles>` makes a name
 * in THEMES (theme.ts) fail to compile until it has a file in ./themes.
 */
export const styles = { retro, modern } satisfies Record<Theme, ThemeStyles>;
