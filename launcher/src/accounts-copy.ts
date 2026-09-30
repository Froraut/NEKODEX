import type { Language } from "./types";

// Accounts surface strings that the main catalogs (i18n-*.json) do not have.
export type AccountsCopy = {
  /** Description under "New task routing" (the last sentence of accountsBody in each catalog). */
  routingBody: string;
  /** The one disclosure in each card: tools setup, Codex sign-in, models, pacing and proxy. */
  detailsTitle: string;
  /** Section headings inside that disclosure. */
  modelsNotChecked: string;
  /** Short tokens of the disclosure summary ("Pacing on · Proxy: System settings"). */
  pacingOn: string;
  pacingOff: string;
  proxyMode: string;
  notSaved: string;
  /** Page-level notice shown once when the shared tunnel runtime is not configured. */
  runtimeNotice: string;
  /** Reasons next to disabled card actions. */
  selectNeedsCheck: string;
  waitForSessionCheck: string;
  /** A signed-in card's browser action: shows that account's ChatGPT session (it replaces no credentials). */
  openInBrowser: string;
  /** Why "Refresh all allowances" is disabled while the list is empty. */
  refreshNeedsAccount: string;
  /** First read of the account list failed (nothing to show yet). */
  loadFailed: string;
  /** Hydration read of one account's allowance failed. */
  quotaReadFailed: string;
  /** A refresh failed and the card keeps showing the last known allowance. */
  quotaRefreshFailed: string;
  refreshAll: string;
  refreshingAll: string;
  /** Result of "Refresh all allowances", shown in the allowance notice. */
  lastRefresh: string;
  lastRefreshParts: { updated: string; retained: string; unavailable: string; skipped: string };
  lastRefreshSeparator: string;
  cancel: string;
};

const copy: Record<Language, AccountsCopy> = {
  en: {
    routingBody: "Continuing tasks stay with their original account.",
    detailsTitle: "Setup and settings",
    modelsNotChecked: "Models appear after Check account.",
    pacingOn: "Pacing on",
    pacingOff: "Pacing off",
    proxyMode: "Proxy: {mode}",
    notSaved: "Not saved",
    runtimeNotice: "Local tools need the shared tunnel runtime. Set it up once; every account in this interaction mode uses it.",
    openInBrowser: "Open in Browser",
    selectNeedsCheck: "Check this account before selecting it.",
    waitForSessionCheck: "Wait for the session check to finish.",
    refreshNeedsAccount: "Add an account first.",
    loadFailed: "Accounts could not be loaded.",
    quotaReadFailed: "Allowance could not be read. Refresh to try again.",
    quotaRefreshFailed: "Allowance could not be refreshed.",
    refreshAll: "Refresh all allowances",
    refreshingAll: "Refreshing allowances…",
    lastRefresh: "Last refresh: {parts}",
    lastRefreshParts: { updated: "{count} current", retained: "{count} earlier", unavailable: "{count} unavailable", skipped: "{count} skipped" },
    lastRefreshSeparator: ", ",
    cancel: "Cancel",
  },
  ru: {
    routingBody: "Продолжение задачи остаётся на исходном аккаунте.",
    detailsTitle: "Настройка и параметры",
    modelsNotChecked: "Модели появятся после проверки аккаунта.",
    pacingOn: "Темп работы включён",
    pacingOff: "Темп работы выключен",
    proxyMode: "Прокси: {mode}",
    notSaved: "Не сохранено",
    runtimeNotice: "Локальным инструментам нужен общий туннель. Он настраивается один раз и используется всеми аккаунтами этого режима работы.",
    openInBrowser: "Открыть в браузере",
    selectNeedsCheck: "Проверьте этот аккаунт, прежде чем выбрать его.",
    waitForSessionCheck: "Дождитесь окончания проверки сеанса.",
    refreshNeedsAccount: "Сначала добавьте аккаунт.",
    loadFailed: "Не удалось загрузить аккаунты.",
    quotaReadFailed: "Не удалось прочитать лимит. Обновите, чтобы повторить.",
    quotaRefreshFailed: "Не удалось обновить лимит.",
    refreshAll: "Обновить все лимиты",
    refreshingAll: "Обновление лимитов…",
    lastRefresh: "Последнее обновление: {parts}",
    lastRefreshParts: { updated: "актуальные — {count}", retained: "более ранние — {count}", unavailable: "недоступные — {count}", skipped: "пропущенные — {count}" },
    lastRefreshSeparator: ", ",
    cancel: "Отмена",
  },
  "zh-CN": {
    routingBody: "后续任务保持原账户。",
    detailsTitle: "设置与参数",
    modelsNotChecked: "检查账户后显示模型。",
    pacingOn: "节奏控制已开启",
    pacingOff: "节奏控制已关闭",
    proxyMode: "代理：{mode}",
    notSaved: "未保存",
    runtimeNotice: "本地工具需要共享隧道运行时。只需设置一次，此交互模式下的所有账户都会使用它。",
    openInBrowser: "在浏览器中打开",
    selectNeedsCheck: "请先检查此账户，再选择它。",
    waitForSessionCheck: "请等待会话检查完成。",
    refreshNeedsAccount: "请先添加账户。",
    loadFailed: "无法加载账户。",
    quotaReadFailed: "无法读取使用额度。请刷新重试。",
    quotaRefreshFailed: "无法刷新使用额度。",
    refreshAll: "刷新全部使用额度",
    refreshingAll: "正在刷新使用额度…",
    lastRefresh: "上次刷新：{parts}",
    lastRefreshParts: { updated: "当前数据 {count}", retained: "较早数据 {count}", unavailable: "不可用 {count}", skipped: "已跳过 {count}" },
    lastRefreshSeparator: "，",
    cancel: "取消",
  },
  "zh-TW": {
    routingBody: "後續任務保持原賬戶。",
    detailsTitle: "設定與參數",
    modelsNotChecked: "檢查帳號後顯示模型。",
    pacingOn: "節奏控制已開啟",
    pacingOff: "節奏控制已關閉",
    proxyMode: "代理：{mode}",
    notSaved: "未儲存",
    runtimeNotice: "本機工具需要共用通道執行環境。只需設定一次，此互動模式下的所有帳號都會使用它。",
    openInBrowser: "在瀏覽器中開啟",
    selectNeedsCheck: "請先檢查此帳號，再選擇它。",
    waitForSessionCheck: "請等待工作階段檢查完成。",
    refreshNeedsAccount: "請先新增帳號。",
    loadFailed: "無法載入帳號。",
    quotaReadFailed: "無法讀取使用額度。請重新整理再試一次。",
    quotaRefreshFailed: "無法重新整理使用額度。",
    refreshAll: "重新整理全部使用額度",
    refreshingAll: "正在重新整理使用額度…",
    lastRefresh: "上次重新整理：{parts}",
    lastRefreshParts: { updated: "目前資料 {count}", retained: "較早資料 {count}", unavailable: "無法使用 {count}", skipped: "已略過 {count}" },
    lastRefreshSeparator: "，",
    cancel: "取消",
  },
  ja: {
    routingBody: "継続タスクは元のアカウントを使用します。",
    detailsTitle: "セットアップと設定",
    modelsNotChecked: "アカウントを確認するとモデルが表示されます。",
    pacingOn: "実行間隔: オン",
    pacingOff: "実行間隔: オフ",
    proxyMode: "プロキシ: {mode}",
    notSaved: "保存されていません",
    runtimeNotice: "ローカルツールには共有トンネルの実行環境が必要です。一度設定すると、この操作モードのすべてのアカウントで使用されます。",
    openInBrowser: "ブラウザーで開く",
    selectNeedsCheck: "選択する前にこのアカウントを確認してください。",
    waitForSessionCheck: "セッションの確認が終わるまでお待ちください。",
    refreshNeedsAccount: "先にアカウントを追加してください。",
    loadFailed: "アカウントを読み込めませんでした。",
    quotaReadFailed: "利用枠を読み取れませんでした。更新して再試行してください。",
    quotaRefreshFailed: "利用枠を更新できませんでした。",
    refreshAll: "すべての利用枠を更新",
    refreshingAll: "利用枠を更新中…",
    lastRefresh: "前回の更新: {parts}",
    lastRefreshParts: { updated: "現在 {count} 件", retained: "以前 {count} 件", unavailable: "利用不可 {count} 件", skipped: "スキップ {count} 件" },
    lastRefreshSeparator: "、",
    cancel: "キャンセル",
  },
  ko: {
    routingBody: "진행 중인 작업은 원래 계정을 계속 사용합니다.",
    detailsTitle: "설정 및 옵션",
    modelsNotChecked: "계정을 확인하면 모델이 표시됩니다.",
    pacingOn: "실행 간격 켜짐",
    pacingOff: "실행 간격 꺼짐",
    proxyMode: "프록시: {mode}",
    notSaved: "저장되지 않음",
    runtimeNotice: "로컬 도구에는 공유 터널 런타임이 필요합니다. 한 번 설정하면 이 상호작용 모드의 모든 계정이 사용합니다.",
    openInBrowser: "브라우저에서 열기",
    selectNeedsCheck: "선택하기 전에 이 계정을 확인하세요.",
    waitForSessionCheck: "세션 확인이 끝날 때까지 기다리세요.",
    refreshNeedsAccount: "먼저 계정을 추가하세요.",
    loadFailed: "계정을 불러올 수 없습니다.",
    quotaReadFailed: "사용 한도를 읽을 수 없습니다. 새로 고쳐 다시 시도하세요.",
    quotaRefreshFailed: "사용 한도를 새로 고칠 수 없습니다.",
    refreshAll: "모든 사용 한도 새로 고침",
    refreshingAll: "사용 한도 새로 고치는 중…",
    lastRefresh: "마지막 새로 고침: {parts}",
    lastRefreshParts: { updated: "현재 {count}개", retained: "이전 {count}개", unavailable: "사용 불가 {count}개", skipped: "건너뜀 {count}개" },
    lastRefreshSeparator: ", ",
    cancel: "취소",
  },
};

export const accountsCopy = (language: Language): AccountsCopy => copy[language] ?? copy.en;
