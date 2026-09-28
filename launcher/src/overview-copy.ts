import type { Language } from "./types";

// Overview strings that the main catalogs (i18n-*.json) do not have.
export type OverviewCopy = {
  /** Title of the panel that lists live browser runs. */
  runningNow: string;
  /** Link from the Running now panel to the Browser surface. */
  openBrowser: string;
};

const copy: Record<Language, OverviewCopy> = {
  en: { runningNow: "Running now", openBrowser: "Open browser" },
  ru: { runningNow: "Сейчас выполняется", openBrowser: "Открыть браузер" },
  "zh-CN": { runningNow: "当前运行", openBrowser: "打开浏览器" },
  "zh-TW": { runningNow: "目前執行中", openBrowser: "開啟瀏覽器" },
  ja: { runningNow: "現在実行中", openBrowser: "ブラウザーを開く" },
  ko: { runningNow: "지금 실행 중", openBrowser: "브라우저 열기" },
};

export const overviewCopy = (language: Language): OverviewCopy => copy[language] ?? copy.en;
