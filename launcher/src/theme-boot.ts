import { applyTheme, rememberedAppearance, resolveTheme } from "./theme";

// Runs before React renders: the last known appearance, or the dark default, decides the first paint.
applyTheme(resolveTheme(rememberedAppearance()));
