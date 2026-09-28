import type { Language } from "./types";

// Settings strings that the main catalogs (i18n-*.json) do not have: group titles, the contents rail and
// short row actions.
export type SettingsCopy = {
  /** Group titles, in page order (Diagnostics reuses the catalog's `diagnostics`). */
  agent: string;
  workspace: string;
  advanced: string;
  about: string;
  /** Accessible name and label of the contents rail. */
  onThisPage: string;
  /** One-sentence consequence of the Run doctor row. */
  doctorBody: string;
  /** Button label of the Remove Codex integration row (the main process asks for confirmation). */
  remove: string;
};

const copy: Record<Language, SettingsCopy> = {
  en: {
    agent: "Agent behaviour",
    workspace: "Workspace preferences",
    advanced: "Advanced",
    about: "About",
    onThisPage: "On this page",
    doctorBody: "Checks the Responses proxy, tunnel runtime and ChatGPT connector.",
    remove: "Remove",
  },
  ru: {
    agent: "Поведение агентов",
    workspace: "Параметры рабочего пространства",
    advanced: "Дополнительно",
    about: "О программе",
    onThisPage: "На этой странице",
    doctorBody: "Проверяет прокси Responses, среду туннеля и коннектор ChatGPT.",
    remove: "Удалить",
  },
  "zh-CN": {
    agent: "代理行为",
    workspace: "工作区偏好设置",
    advanced: "高级",
    about: "关于",
    onThisPage: "本页内容",
    doctorBody: "检查 Responses 代理、隧道运行时和 ChatGPT 连接器。",
    remove: "移除",
  },
  "zh-TW": {
    agent: "代理行為",
    workspace: "工作區偏好設定",
    advanced: "高階",
    about: "關於",
    onThisPage: "本頁內容",
    doctorBody: "檢查 Responses 代理、隧道執行環境和 ChatGPT 連接器。",
    remove: "移除",
  },
  ja: {
    agent: "エージェントの動作",
    workspace: "ワークスペースの設定",
    advanced: "高度な設定",
    about: "NEKODEX について",
    onThisPage: "このページの内容",
    doctorBody: "Responses プロキシ、トンネルランタイム、ChatGPT コネクタを確認します。",
    remove: "削除",
  },
  ko: {
    agent: "에이전트 동작",
    workspace: "작업 공간 환경설정",
    advanced: "고급",
    about: "정보",
    onThisPage: "이 페이지 내용",
    doctorBody: "Responses 프록시, 터널 런타임, ChatGPT 커넥터를 확인합니다.",
    remove: "제거",
  },
};

export const settingsCopy = (language: Language): SettingsCopy => copy[language] ?? copy.en;
