import type { Language } from "./types";

// Shell strings that the main catalogs (i18n-*.json) do not have.
export type ShellCopy = {
  /** Accessible name of the titlebar location trail (NEKODEX / Surface). */
  location: string;
  /** Accessible name of the sidebar (the navigation rail). */
  navigation: string;
  /** The Updates nav item while a release is ready. */
  updateAvailable: string;
  /** Launch screen, before the first snapshot. */
  loading: string;
  loadingTitle: string;
  loadingWorkspace: string;
  loadingLanguage: string;
  loadingSlow: string;
  startupRecovery: string;
  startupRestart: string;
  showDetails: string;
  /** Heading of the startup failure screen. */
  startupFailed: string;
  /** Its retry button (reconnects to the launcher process). */
  tryAgain: string;
  /** Text alternatives of the nav attention dots (the status words). */
  needsSetup: string;
  notConnected: string;
  needsAttention: string;
  optionalSetup: string;
  /** Text alternative of the Browser nav count badge. */
  running: (count: number) => string;
};

const copy: Record<Language, ShellCopy> = {
  en: {
    loadingTitle: "Opening your workspace",
    loadingWorkspace: "Getting your accounts and settings ready.",
    loadingLanguage: "Finishing the interface setup.",
    loadingSlow: "Still getting ready. You can keep waiting or try again.",
    startupRecovery: "Try again to reconnect to your workspace.", startupRestart: "Close and reopen NEKODEX to try again.", showDetails: "Show details",
    location: "Location", navigation: "Navigation", updateAvailable: "Update available", loading: "Loading…",
    startupFailed: "NEKODEX couldn't start", tryAgain: "Try again", needsSetup: "Needs setup", notConnected: "Not connected",
    needsAttention: "Needs attention", optionalSetup: "Optional setup", running: count => `${count} running`,
  },
  ru: {
    loadingTitle: "Открываем рабочее пространство",
    loadingWorkspace: "Подготавливаем аккаунты и настройки.",
    loadingLanguage: "Завершаем подготовку интерфейса.",
    loadingSlow: "Подготовка ещё идёт. Можно подождать или повторить попытку.",
    startupRecovery: "Повторите попытку подключения к рабочему пространству.", startupRestart: "Закройте и снова откройте NEKODEX, чтобы повторить запуск.", showDetails: "Подробности",
    location: "Расположение", navigation: "Навигация", updateAvailable: "Есть обновление", loading: "Загрузка…",
    startupFailed: "Не удалось запустить NEKODEX", tryAgain: "Повторить попытку", needsSetup: "Требуется настройка", notConnected: "Не подключено",
    needsAttention: "Требует внимания", optionalSetup: "Необязательная настройка", running: count => `Выполняется: ${count}`,
  },
  "zh-CN": {
    loadingTitle: "正在打开工作区",
    loadingWorkspace: "正在准备账户和设置。",
    loadingLanguage: "正在完成界面准备。",
    loadingSlow: "仍在准备中。你可以继续等待或重试。",
    startupRecovery: "请重试以重新连接工作区。", startupRestart: "请关闭并重新打开 NEKODEX 以重试。", showDetails: "查看详情",
    location: "当前位置", navigation: "导航", updateAvailable: "有可用更新", loading: "正在加载…",
    startupFailed: "NEKODEX 无法启动", tryAgain: "重试", needsSetup: "需要设置", notConnected: "未连接",
    needsAttention: "需要处理", optionalSetup: "可选设置", running: count => `${count} 个运行中`,
  },
  "zh-TW": {
    loadingTitle: "正在開啟工作區",
    loadingWorkspace: "正在準備帳戶與設定。",
    loadingLanguage: "正在完成介面準備。",
    loadingSlow: "仍在準備中。您可以繼續等待或重試。",
    startupRecovery: "請重試以重新連接工作區。", startupRestart: "請關閉並重新開啟 NEKODEX 以重試。", showDetails: "查看詳細資料",
    location: "目前位置", navigation: "導覽", updateAvailable: "有可用更新", loading: "正在載入…",
    startupFailed: "NEKODEX 無法啟動", tryAgain: "重試", needsSetup: "需要設定", notConnected: "未連線",
    needsAttention: "需要處理", optionalSetup: "選用設定", running: count => `${count} 個執行中`,
  },
  ja: {
    loadingTitle: "ワークスペースを開いています",
    loadingWorkspace: "アカウントと設定を準備しています。",
    loadingLanguage: "インターフェースの準備を仕上げています。",
    loadingSlow: "準備を続けています。そのまま待つか、もう一度お試しください。",
    startupRecovery: "もう一度試してワークスペースに再接続してください。", startupRestart: "NEKODEX を閉じて開き直し、もう一度お試しください。", showDetails: "詳細を表示",
    location: "現在地", navigation: "ナビゲーション", updateAvailable: "アップデートあり", loading: "読み込み中…",
    startupFailed: "NEKODEX を起動できませんでした", tryAgain: "もう一度試す", needsSetup: "設定が必要", notConnected: "未接続",
    needsAttention: "対応が必要", optionalSetup: "任意の設定", running: count => `${count} 件実行中`,
  },
  ko: {
    loadingTitle: "작업 공간을 여는 중",
    loadingWorkspace: "계정과 설정을 준비하고 있습니다.",
    loadingLanguage: "화면 준비를 마무리하고 있습니다.",
    loadingSlow: "아직 준비 중입니다. 기다리거나 다시 시도할 수 있습니다.",
    startupRecovery: "다시 시도하여 작업 공간에 연결하세요.", startupRestart: "NEKODEX를 닫았다가 다시 열어 보세요.", showDetails: "세부 정보 보기",
    location: "현재 위치", navigation: "탐색", updateAvailable: "업데이트 있음", loading: "불러오는 중…",
    startupFailed: "NEKODEX를 시작할 수 없습니다", tryAgain: "다시 시도", needsSetup: "설정 필요", notConnected: "연결되지 않음",
    needsAttention: "확인 필요", optionalSetup: "선택 설정", running: count => `${count}개 실행 중`,
  },
};

export const shellCopy = (language: Language): ShellCopy => copy[language] ?? copy.en;

const LANGUAGE_KEY = "nekodex.language";
const LANGUAGES: readonly Language[] = ["en", "ru", "zh-CN", "zh-TW", "ja", "ko"];

/** Remembers the presented launcher language, so the next launch and startup-failure screens use it. */
export function rememberLanguage(language: Language) {
  try { window.localStorage.setItem(LANGUAGE_KEY, language); } catch {}
}

/** The language of the screens shown before the first snapshot: the last presented one, else the system's. */
export function startupLanguage(): Language {
  try {
    const value = window.localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES.includes(value as Language)) return value as Language;
  } catch {}
  return systemLanguage();
}

/** The system language, for the launch and startup-failure screens shown before the saved language is known. */
export function systemLanguage(): Language {
  const tags = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  for (const tag of tags.filter(Boolean).map(value => value.toLowerCase())) {
    if (tag.startsWith("zh")) return /-(tw|hk|mo|hant)/.test(tag) ? "zh-TW" : "zh-CN";
    for (const language of ["ru", "ja", "ko", "en"] as const) if (tag === language || tag.startsWith(`${language}-`)) return language;
  }
  return "en";
}
