import { useLayoutEffect } from "react";
import type { Appearance, ResolvedTheme } from "./types";

// The design-system tokens define dark on :root and light on :root[data-theme="light"].
// ChatGPT pages are separate web contents and keep following the operating system.
const LIGHT_QUERY = "(prefers-color-scheme: light)";
const APPEARANCE_KEY = "nekodex.appearance";

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "dark" || value === "light";
}

function systemTheme(): ResolvedTheme {
  return typeof window.matchMedia === "function" && window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

export function resolveTheme(appearance: Appearance | null | undefined): ResolvedTheme {
  if (appearance === "light" || appearance === "dark") return appearance;
  return appearance === "system" ? systemTheme() : "dark";
}

export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "color-scheme";
    document.head.append(meta);
  }
  if (meta.content !== theme) meta.content = theme;
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === "dark" || value === "light";
}

/**
 * The theme of the first frame, before the snapshot arrives: the appearance this renderer last applied; before
 * one is remembered (the first launch of this build), the theme the main process resolved from the saved
 * appearance, which also painted the window background (?theme=); without either, the system appearance.
 */
export function initialTheme(): ResolvedTheme {
  const remembered = rememberedAppearance();
  if (remembered) return resolveTheme(remembered);
  try {
    const fromMain = new URLSearchParams(window.location.search).get("theme");
    if (isResolvedTheme(fromMain)) return fromMain;
  } catch {}
  return systemTheme();
}

/** Last applied preference, so the next launch paints its first frame in the same theme. */
export function rememberedAppearance(): Appearance | null {
  try {
    const value = window.localStorage.getItem(APPEARANCE_KEY);
    return isAppearance(value) ? value : null;
  } catch { return null; }
}

function rememberAppearance(appearance: Appearance) {
  try { window.localStorage.setItem(APPEARANCE_KEY, appearance); } catch {}
}

/** Applies the launcher appearance to <html data-theme> and follows the OS while it is "system". */
export function useAppliedAppearance(appearance: Appearance | null | undefined) {
  useLayoutEffect(() => {
    // No snapshot yet: keep the theme chosen before React rendered.
    if (!isAppearance(appearance)) return;
    rememberAppearance(appearance);
    if (appearance !== "system" || typeof window.matchMedia !== "function") {
      applyTheme(resolveTheme(appearance));
      return;
    }
    const query = window.matchMedia(LIGHT_QUERY);
    const sync = () => applyTheme(query.matches ? "light" : "dark");
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [appearance]);
}
