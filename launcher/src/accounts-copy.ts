import type { Language } from "./types";

// Accounts surface strings that the main catalogs (i18n-*.json) do not have.
export type AccountsCopy = {
  /** Description under "New task routing" (the last sentence of accountsBody in each catalog). */
  routingBody: string;
  /** Disclosure holding an account's pacing, new-session window and proxy settings. */
  controlsTitle: string;
};

const copy: Record<Language, AccountsCopy> = {
  en: { routingBody: "Continuing tasks stay with their original account.", controlsTitle: "Pacing and proxy" },
  ru: { routingBody: "Продолжение задачи остаётся на исходном аккаунте.", controlsTitle: "Темп работы и прокси" },
  "zh-CN": { routingBody: "后续任务保持原账户。", controlsTitle: "节奏控制和代理" },
  "zh-TW": { routingBody: "後續任務保持原賬戶。", controlsTitle: "節奏控制與代理" },
  ja: { routingBody: "継続タスクは元のアカウントを使用します。", controlsTitle: "実行間隔とプロキシ" },
  ko: { routingBody: "진행 중인 작업은 원래 계정을 계속 사용합니다.", controlsTitle: "실행 간격 및 프록시" },
};

export const accountsCopy = (language: Language): AccountsCopy => copy[language] ?? copy.en;
