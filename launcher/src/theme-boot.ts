import { applyTheme, initialTheme } from "./theme";

// Runs before React renders: the remembered appearance, else the main process's resolved theme, decides the
// first paint (theme.ts initialTheme).
applyTheme(initialTheme());
