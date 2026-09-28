import type { Appearance, Language } from "./types";

export type AppearanceCopy = {
  title: string;
  body: string;
  options: Record<Appearance, string>;
};

const copy: Record<Language, AppearanceCopy> = {
  en: {
    title: "Appearance",
    body: "Dark keeps the NEKODEX palette. System follows your computer.",
    options: { system: "System", dark: "Dark", light: "Light" },
  },
  ru: {
    title: "Оформление",
    body: "Тёмное сохраняет палитру NEKODEX. Системное следует настройкам компьютера.",
    options: { system: "Системное", dark: "Тёмное", light: "Светлое" },
  },
  "zh-CN": {
    title: "外观",
    body: "深色保留 NEKODEX 配色。跟随系统会与电脑的外观设置保持一致。",
    options: { system: "跟随系统", dark: "深色", light: "浅色" },
  },
  "zh-TW": {
    title: "外觀",
    body: "深色保留 NEKODEX 配色。跟隨系統會與電腦的外觀設定保持一致。",
    options: { system: "跟隨系統", dark: "深色", light: "淺色" },
  },
  ja: {
    title: "外観",
    body: "ダークは NEKODEX のカラーパレットを保ちます。システムはコンピュータの設定に従います。",
    options: { system: "システム", dark: "ダーク", light: "ライト" },
  },
  ko: {
    title: "화면 모드",
    body: "다크는 NEKODEX 색상 팔레트를 유지합니다. 시스템은 컴퓨터 설정을 따릅니다.",
    options: { system: "시스템", dark: "다크", light: "라이트" },
  },
};

export const APPEARANCE_OPTIONS: readonly Appearance[] = ["system", "dark", "light"];

export const appearanceCopy = (language: Language): AppearanceCopy => copy[language] ?? copy.en;
