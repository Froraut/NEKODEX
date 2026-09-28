import type { Language } from "./types";

// Shell strings that the main catalogs (i18n-*.json) do not have.
export type ShellCopy = {
  /** Accessible name of the titlebar location trail (NEKODEX / Surface). */
  location: string;
};

const copy: Record<Language, ShellCopy> = {
  en: { location: "Location" },
  ru: { location: "Расположение" },
  "zh-CN": { location: "当前位置" },
  "zh-TW": { location: "目前位置" },
  ja: { location: "現在地" },
  ko: { location: "현재 위치" },
};

export const shellCopy = (language: Language): ShellCopy => copy[language] ?? copy.en;
