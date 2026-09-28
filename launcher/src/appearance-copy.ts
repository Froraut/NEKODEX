import type { Appearance, Language } from "./types";

export type AppearanceCopy = {
  title: string;
  body: string;
  options: Record<Appearance, string>;
};

const copy: Record<Language, AppearanceCopy> = {
  en: {
    title: "Appearance",
    body: "Dark and Light set the look of NEKODEX. System follows your computer and switches with it.",
    options: { system: "System", dark: "Dark", light: "Light" },
  },
  ru: {
    title: "Оформление",
    body: "Тёмное и светлое задают вид NEKODEX. Системное следует настройке компьютера и меняется вместе с ней.",
    options: { system: "Системное", dark: "Тёмное", light: "Светлое" },
  },
  "zh-CN": {
    title: "外观",
    body: "深色和浅色固定 NEKODEX 的外观。跟随系统会与电脑的外观设置保持一致，并随之切换。",
    options: { system: "跟随系统", dark: "深色", light: "浅色" },
  },
  "zh-TW": {
    title: "外觀",
    body: "深色和淺色固定 NEKODEX 的外觀。跟隨系統會與電腦的外觀設定保持一致，並隨之切換。",
    options: { system: "跟隨系統", dark: "深色", light: "淺色" },
  },
  ja: {
    title: "外観",
    body: "ダークとライトは NEKODEX の外観を固定します。システムはコンピュータの設定に従って切り替わります。",
    options: { system: "システム", dark: "ダーク", light: "ライト" },
  },
  ko: {
    title: "화면 모드",
    body: "다크와 라이트는 NEKODEX의 화면을 고정합니다. 시스템은 컴퓨터 설정을 따라 함께 바뀝니다.",
    options: { system: "시스템", dark: "다크", light: "라이트" },
  },
};

export const APPEARANCE_OPTIONS: readonly Appearance[] = ["system", "dark", "light"];

export const appearanceCopy = (language: Language): AppearanceCopy => copy[language] ?? copy.en;
