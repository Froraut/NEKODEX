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
  /** Description of the Language row. */
  languageBody: string;
  /** Parallel agents: what to do after saving a limit that the running app has not applied yet. */
  capacityRestart: string;
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
    languageBody: "Interface language for NEKODEX.",
    capacityRestart: "To apply the saved limit, finish active tasks, then quit and reopen NEKODEX. Closing the window alone may keep it running.",
  },
  ru: {
    agent: "Поведение агентов",
    workspace: "Параметры рабочего пространства",
    advanced: "Дополнительно",
    about: "О программе",
    onThisPage: "На этой странице",
    doctorBody: "Проверяет прокси Responses, среду туннеля и коннектор ChatGPT.",
    remove: "Удалить",
    languageBody: "Язык интерфейса NEKODEX.",
    capacityRestart: "Чтобы применить сохранённый лимит, завершите активные задачи, затем выйдите из NEKODEX и откройте его снова. Закрытие окна не всегда завершает приложение.",
  },
  "zh-CN": {
    agent: "代理行为",
    workspace: "工作区偏好设置",
    advanced: "高级",
    about: "关于",
    onThisPage: "本页内容",
    doctorBody: "检查 Responses 代理、隧道运行时和 ChatGPT 连接器。",
    remove: "移除",
    languageBody: "NEKODEX 的界面语言。",
    capacityRestart: "要应用已保存的上限，请等待当前任务结束，然后退出并重新打开 NEKODEX。仅关闭窗口可能不会退出应用。",
  },
  "zh-TW": {
    agent: "代理行為",
    workspace: "工作區偏好設定",
    advanced: "高階",
    about: "關於",
    onThisPage: "本頁內容",
    doctorBody: "檢查 Responses 代理、隧道執行環境和 ChatGPT 連接器。",
    remove: "移除",
    languageBody: "NEKODEX 的介面語言。",
    capacityRestart: "要套用已儲存的上限，請等待目前的任務結束，然後退出並重新開啟 NEKODEX。僅關閉視窗可能不會退出應用程式。",
  },
  ja: {
    agent: "エージェントの動作",
    workspace: "ワークスペースの設定",
    advanced: "高度な設定",
    about: "NEKODEX について",
    onThisPage: "このページの内容",
    doctorBody: "Responses プロキシ、トンネルランタイム、ChatGPT コネクタを確認します。",
    remove: "削除",
    languageBody: "NEKODEX の表示言語です。",
    capacityRestart: "保存した上限を適用するには、実行中のタスクが終わってから NEKODEX を終了し、再度開いてください。ウィンドウを閉じるだけでは終了しない場合があります。",
  },
  ko: {
    agent: "에이전트 동작",
    workspace: "작업 공간 환경설정",
    advanced: "고급",
    about: "정보",
    onThisPage: "이 페이지 내용",
    doctorBody: "Responses 프록시, 터널 런타임, ChatGPT 커넥터를 확인합니다.",
    remove: "제거",
    languageBody: "NEKODEX의 인터페이스 언어입니다.",
    capacityRestart: "저장한 한도를 적용하려면 진행 중인 작업이 끝난 뒤 NEKODEX를 완전히 종료하고 다시 여세요. 창만 닫으면 앱이 계속 실행될 수 있습니다.",
  },
};

export const settingsCopy = (language: Language): SettingsCopy => copy[language] ?? copy.en;
