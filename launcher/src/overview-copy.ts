import type { Language } from "./types";

// Overview strings that the main catalogs (i18n-*.json) do not have.
export type OverviewCopy = {
  /** Title of the panel that lists live browser runs. */
  runningNow: string;
  /** Link from the Running now panel to the Browser surface. */
  openBrowser: string;
  /** Accessible name of the stat group (active runs, configured limit, interaction mode). */
  statsLabel: string;
};

const copy: Record<Language, OverviewCopy> = {
  en: { runningNow: "Running now", openBrowser: "Open browser", statsLabel: "Workspace activity" },
  ru: { runningNow: "Сейчас выполняется", openBrowser: "Открыть браузер", statsLabel: "Активность рабочего пространства" },
  "zh-CN": { runningNow: "当前运行", openBrowser: "打开浏览器", statsLabel: "工作空间活动" },
  "zh-TW": { runningNow: "目前執行中", openBrowser: "開啟瀏覽器", statsLabel: "工作空間活動" },
  ja: { runningNow: "現在実行中", openBrowser: "ブラウザーを開く", statsLabel: "ワークスペースのアクティビティ" },
  ko: { runningNow: "지금 실행 중", openBrowser: "브라우저 열기", statsLabel: "작업 공간 활동" },
};

export const overviewCopy = (language: Language): OverviewCopy => copy[language] ?? copy.en;
