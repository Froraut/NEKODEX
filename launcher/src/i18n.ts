export { copyFor, loadLanguage, localeCatalog, type Copy } from "./locale-catalog";
import type { Copy } from "./locale-catalog";
import type { Language } from "./types";
import { stripIpcErrorPrefix } from "./ipc-error";

export function localizeLauncherError(copy: Copy, message: string): string {
  const detail = stripIpcErrorPrefix(message);
  if (detail === "Browser navigation is locked during ChatGPT login") return copy.embeddedLoginBody;
  if (detail === "Browser navigation is locked during ChatGPT passkey login") return copy.passkeyContinueBody;
  if (/timed out.*passkey|passkey.*timed out/i.test(detail)) return copy.passkeyTimedOut;
  if (detail === "Passkey sign-in cancelled") return copy.passkeyCancelled;
  if (detail === "No passkey sign-in is waiting for Continue") return copy.passkeyImporting;
  if (/dedicated Chrome.*(no longer owned|could not be revealed)|Could not reveal the dedicated Chrome/i.test(detail)) return copy.passkeyRevealFailed;
  if (detail.startsWith("Browser navigation is locked during ")) return copy.browserNavigationBusy;
  return detail;
}

export function localizeRuntimeMessage(
  copy: Copy,
  message: string,
  checkId: string | undefined,
  language: Language,
): string {
  if (language === "en") return message;
  if (checkId === undefined && message === "Checking ChatGPT connector") return copy.checkingChatGptConnector;

  if (checkId === "proxy") {
    const match = /^Responses proxy is healthy on (127\.0\.0\.1:\d+)$/.exec(message);
    if (match) return copy.doctorProxyHealthy.replace("{endpoint}", () => match[1]);
  }
  if (checkId === "tunnel-binary" && message === "Pinned openai/tunnel-client binary is installed") {
    return copy.doctorTunnelBinaryInstalled;
  }
  if (checkId === "tunnel-key" && message === "Tunnel runtime key is stored privately") {
    return copy.doctorTunnelKeyStored;
  }
  if (checkId === "tunnel-service" && message === "Launcher owns the tunnel runtime") {
    return copy.doctorTunnelRuntimeOwned;
  }
  if (checkId === "tunnel-runtime" && message === "Tunnel runtime reports healthy and ready") {
    return copy.doctorTunnelRuntimeReady;
  }
  if (checkId === "connector") {
    const match = /^ChatGPT connector (".*") is available$/s.exec(message);
    if (match) {
      try {
        const connectorName = JSON.parse(match[1]);
        if (typeof connectorName === "string") {
          return copy.doctorConnectorAvailable.replace("{name}", () => connectorName);
        }
      } catch {
        return message;
      }
    }
  }
  return message;
}

// Kept separate from the historical async preference copy: this is an explicit identity upgrade.
const native6Copies = {
  ru: {
    title: "Native6 · Рекомендуется",
    upgrade: "Перейти на Native6",
    verify: "Проверить коннектор",
    compatibility: "Использовать Native4 (совместимость)",
    retained: "Используйте точное имя коннектора ниже. Сохранённые Native4/5 поддерживаются; переход на Native6 доступен в настройках.",
    body: "Для первой настройки или перехода создайте новый коннектор {connector} в ChatGPT с новым App ID и прежним туннелем этого режима. Не переименовывайте старый коннектор. Затем проверьте подключение в NEKODEX. Сохранённые Native4/5 продолжают работать до явного перехода.",
    mismatch: "Сохранённая проверка относится к другому коннектору. Проверьте текущий коннектор заново.",
  },
  en: {
    title: "Native6 · Recommended",
    upgrade: "Upgrade to Native6",
    verify: "Verify connector",
    compatibility: "Use Native4 (compatibility)",
    retained: "Use the exact connector name below. Saved Native4/5 remain supported; upgrade to Native6 in Settings.",
    body: "For first-time setup or an upgrade, create a new {connector} connector in ChatGPT with a new App ID and this mode's existing tunnel. Do not rename the old connector. Then verify the connection in NEKODEX. Saved Native4/5 connectors remain supported until an explicit upgrade.",
    mismatch: "The saved verification belongs to a different connector. Verify the current connector again.",
  },
  "zh-CN": {
    title: "Native6 · 推荐",
    upgrade: "升级到 Native6",
    verify: "验证连接器",
    compatibility: "使用 Native4（兼容模式）",
    retained: "请使用下方准确的连接器名称。已保存的 Native4/5 仍受支持；可在设置中升级到 Native6。",
    body: "首次设置或升级时，请使用新的 App ID 和此模式现有的隧道，在 ChatGPT 中创建新的 {connector} 连接器。不要重命名旧连接器。然后在 NEKODEX 中验证连接。已保存的 Native4/5 连接器在明确升级前仍受支持。",
    mismatch: "已保存的验证属于另一个连接器。请重新验证当前连接器。",
  },
  "zh-TW": {
    title: "Native6 · 建議使用",
    upgrade: "升級至 Native6",
    verify: "驗證聯結器",
    compatibility: "使用 Native4（相容模式）",
    retained: "請使用下方準確的聯結器名稱。已儲存的 Native4/5 仍受支援；可在設定中升級至 Native6。",
    body: "首次設定或升級時，請使用新的 App ID 和此模式現有的 Tunnel，在 ChatGPT 中建立新的 {connector} 聯結器。不要重新命名舊聯結器。然後在 NEKODEX 中驗證連線。已儲存的 Native4/5 聯結器在明確升級前仍受支援。",
    mismatch: "已儲存的驗證屬於另一個聯結器。請重新驗證目前的聯結器。",
  },
  ja: {
    title: "Native6 · 推奨",
    upgrade: "Native6 にアップグレード",
    verify: "コネクタを検証",
    compatibility: "Native4 を使用（互換モード）",
    retained: "下記の正確なコネクタ名を使用してください。保存済みの Native4/5 は引き続きサポートされ、設定から Native6 にアップグレードできます。",
    body: "初回設定またはアップグレードでは、新しい App ID とこのモードの既存トンネルを使って、ChatGPT に新しい {connector} コネクタを作成します。古いコネクタの名前を変更しないでください。その後、NEKODEX で接続を検証します。保存済みの Native4/5 コネクタは、明示的にアップグレードするまで引き続きサポートされます。",
    mismatch: "保存済みの検証は別のコネクタのものです。現在のコネクタを再検証してください。",
  },
  ko: {
    title: "Native6 · 권장",
    upgrade: "Native6로 업그레이드",
    verify: "커넥터 확인",
    compatibility: "Native4 사용(호환 모드)",
    retained: "아래의 정확한 커넥터 이름을 사용하세요. 저장된 Native4/5는 계속 지원되며 설정에서 Native6로 업그레이드할 수 있습니다.",
    body: "처음 설정하거나 업그레이드할 때는 새 App ID와 이 모드의 기존 터널을 사용해 ChatGPT에 새 {connector} 커넥터를 만드세요. 기존 커넥터의 이름을 바꾸지 마세요. 그런 다음 NEKODEX에서 연결을 확인하세요. 저장된 Native4/5 커넥터는 명시적으로 업그레이드할 때까지 계속 지원됩니다.",
    mismatch: "저장된 확인 결과가 다른 커넥터의 것입니다. 현재 커넥터를 다시 확인하세요.",
  },
} satisfies Record<Language, {
  title: string; upgrade: string; verify: string;
  compatibility: string; retained: string; body: string; mismatch: string;
}>;

export function native6CopyFor(language: Language) {
  return native6Copies[language];
}

const accountCodexEn = {
  quotaTitle: "Codex allowance",
  quotaRefresh: "Refresh allowance",
  quotaNotChecked: "Allowance has not been checked yet.",
  quotaChecking: "Reading Codex allowance…",
  quotaUnavailable: "Codex allowance is not available for this account.",
  quotaUnsupportedSession: "This ChatGPT sign-in could not read Codex allowance. The account's Codex sign-in may be required.",
  quotaSignedOut: "Sign in to this ChatGPT account first.",
  quotaRateLimited: "The provider asked us to wait before refreshing.",
  quotaManualUnavailable: "Allowance refresh is unavailable in Manual mode.",
  quotaReportedOnly: "Only limits reported by Codex are shown. Missing values are not zero.",
  quotaGeneral: "General Codex allowance",
  quotaAdditional: "{count} model-specific limits",
  quotaRemaining: "{value}% remaining",
  quotaUnknown: "Not reported",
  quotaWindowHours: "{count} hours",
  quotaWindowDays: "{count} days",
  quotaWindowMinutes: "{count} minutes",
  quotaPrimary: "Primary window",
  quotaSecondary: "Secondary window",
  quotaResets: "Resets {time}",
  quotaUpdated: "Updated {time}",
  quotaCoverageTruncated: "More limits were reported than can be displayed.",
  loginTitle: "Sign in to Codex",
  loginAction: "Sign in to Codex",
  loginBody: "Opens official OpenAI sign-in in this account's browser session. Confirm the account on the OpenAI page. This updates the shared Codex sign-in; the running desktop app may need a restart.",
  loginStarting: "Preparing official sign-in…",
  loginOpen: "Open OpenAI sign-in",
  loginCode: "One-time code",
  loginCodeHint: "Enter this code on the OpenAI page and confirm the account.",
  loginCancel: "Cancel sign-in",
  loginCancelling: "Cancelling sign-in…",
  loginCancelled: "Sign-in was cancelled.",
  loginCompleted: "Codex sign-in was saved. Confirm the active account in the Codex desktop profile; restart Codex if it still shows the previous account.",
  loginFailed: "Sign-in did not finish. Check Codex's current account before retrying.",
  loginStatusUnavailable: "Codex sign-in status could not be refreshed. The sign-in may still be active. Retry the status check before starting another sign-in.",
  loginUncertain: "Sign-in may have finished before cancellation. Check the active Codex account.",
  loginWrongAccount: "OpenAI completed sign-in with a different account. Check the Codex profile before continuing.",
  loginAccountChanged: "This account changed during sign-in. Start again after checking the account.",
  loginCurrent: "Sign-in is running for {account}.",
  loginSettling: "Checking account session…",
  loginSettlingCurrent: "Checking the session for {account}.",
  loginActualAccount: "Codex reports: {account}",
  loginConfirming: "Confirming Codex sign-in…",
  loginDeadline: "Complete sign-in before {time}",
  loginCLIUnavailable: "Codex is not installed or its sign-in service is unavailable.",
  Copied: "Copied",
  copyCode: "Copy code",
};
type AccountCodexCopy = { [K in keyof typeof accountCodexEn]: string };

const accountCodexCopies: Record<Language, AccountCodexCopy> = {
  en: accountCodexEn,
  ru: {
    quotaTitle: "Лимит Codex",
    quotaRefresh: "Обновить лимит",
    quotaNotChecked: "Лимит ещё не проверялся.",
    quotaChecking: "Чтение лимита Codex…",
    quotaUnavailable: "Лимит Codex недоступен для этого аккаунта.",
    quotaUnsupportedSession: "Этот вход в ChatGPT не позволил прочитать лимит Codex. Может потребоваться вход в Codex для этого аккаунта.",
    quotaSignedOut: "Сначала войдите в этот аккаунт ChatGPT.",
    quotaRateLimited: "Провайдер попросил подождать перед следующим обновлением.",
    quotaManualUnavailable: "Обновление лимита недоступно в ручном режиме.",
    quotaReportedOnly: "Показаны только лимиты, сообщённые Codex. Отсутствующие значения не равны нулю.",
    quotaGeneral: "Общий лимит Codex",
    quotaAdditional: "Лимиты отдельных моделей: {count}",
    quotaRemaining: "Осталось {value}%",
    quotaUnknown: "Не сообщено",
    quotaWindowHours: "{count} ч",
    quotaWindowDays: "{count} дн.",
    quotaWindowMinutes: "{count} мин",
    quotaPrimary: "Основное окно",
    quotaSecondary: "Дополнительное окно",
    quotaResets: "Сброс: {time}",
    quotaUpdated: "Обновлено: {time}",
    quotaCoverageTruncated: "Сообщено больше лимитов, чем можно показать.",
    loginTitle: "Вход в Codex",
    loginAction: "Войти в Codex",
    loginBody: "Открывает официальный вход OpenAI в браузерном сеансе этого аккаунта. Подтвердите аккаунт на странице OpenAI. Это обновит общий вход Codex; работающему приложению Codex может потребоваться перезапуск.",
    loginStarting: "Подготовка официального входа…",
    loginOpen: "Открыть вход OpenAI",
    loginCode: "Одноразовый код",
    loginCodeHint: "Введите этот код на странице OpenAI и подтвердите аккаунт.",
    loginCancel: "Отменить вход",
    loginCancelling: "Отмена входа…",
    loginCancelled: "Вход отменён.",
    loginCompleted: "Вход в Codex сохранён. Подтвердите активный аккаунт в профиле приложения Codex; перезапустите Codex, если там всё ещё показан прежний аккаунт.",
    loginFailed: "Вход не завершён. Перед повтором проверьте текущий аккаунт Codex.",
    loginStatusUnavailable: "Не удалось обновить состояние входа в Codex. Вход может всё ещё выполняться. Повторите проверку состояния, прежде чем начинать новый вход.",
    loginUncertain: "Вход мог завершиться до отмены. Проверьте активный аккаунт Codex.",
    loginWrongAccount: "OpenAI завершил вход с другим аккаунтом. Перед продолжением проверьте профиль Codex.",
    loginAccountChanged: "Этот аккаунт изменился во время входа. Проверьте аккаунт и начните снова.",
    loginCurrent: "Выполняется вход для аккаунта {account}.",
    loginSettling: "Проверка сеанса аккаунта…",
    loginSettlingCurrent: "Проверка сеанса для аккаунта {account}.",
    loginActualAccount: "Codex сообщает: {account}",
    loginConfirming: "Подтверждение входа в Codex…",
    loginDeadline: "Завершите вход до {time}",
    loginCLIUnavailable: "Codex не установлен или его служба входа недоступна.",
    Copied: "Скопировано",
    copyCode: "Скопировать код",
  },
  "zh-CN": {
    quotaTitle: "Codex 使用额度",
    quotaRefresh: "刷新使用额度",
    quotaNotChecked: "尚未检查使用额度。",
    quotaChecking: "正在读取 Codex 使用额度…",
    quotaUnavailable: "此账户的 Codex 使用额度不可用。",
    quotaUnsupportedSession: "此 ChatGPT 登录无法读取 Codex 使用额度。可能需要使用该账户登录 Codex。",
    quotaSignedOut: "请先登录此 ChatGPT 账户。",
    quotaRateLimited: "提供方要求等待后再刷新。",
    quotaManualUnavailable: "手动模式下无法刷新使用额度。",
    quotaReportedOnly: "仅显示 Codex 报告的限制。缺失值不等于零。",
    quotaGeneral: "Codex 通用使用额度",
    quotaAdditional: "{count} 个模型专属限制",
    quotaRemaining: "剩余 {value}%",
    quotaUnknown: "未报告",
    quotaWindowHours: "{count} 小时",
    quotaWindowDays: "{count} 天",
    quotaWindowMinutes: "{count} 分钟",
    quotaPrimary: "主要窗口",
    quotaSecondary: "次要窗口",
    quotaResets: "重置时间：{time}",
    quotaUpdated: "更新时间：{time}",
    quotaCoverageTruncated: "报告的限制数量超过了可显示的数量。",
    loginTitle: "登录 Codex",
    loginAction: "登录 Codex",
    loginBody: "在此账户的浏览器会话中打开 OpenAI 官方登录页面。请在 OpenAI 页面确认账户。这会更新共享的 Codex 登录；正在运行的桌面应用可能需要重启。",
    loginStarting: "正在准备官方登录…",
    loginOpen: "打开 OpenAI 登录",
    loginCode: "一次性代码",
    loginCodeHint: "在 OpenAI 页面输入此代码并确认账户。",
    loginCancel: "取消登录",
    loginCancelling: "正在取消登录…",
    loginCancelled: "登录已取消。",
    loginCompleted: "Codex 登录已保存。请在 Codex 桌面配置中确认当前账户；如果仍显示之前的账户，请重启 Codex。",
    loginFailed: "登录未完成。重试前请检查 Codex 当前账户。",
    loginStatusUnavailable: "无法刷新 Codex 登录状态。登录可能仍在进行中。开始新的登录前，请重试状态检查。",
    loginUncertain: "登录可能在取消前已经完成。请检查当前 Codex 账户。",
    loginWrongAccount: "OpenAI 使用其他账户完成了登录。继续前请检查 Codex 配置。",
    loginAccountChanged: "此账户在登录期间发生了变化。请检查账户后重新开始。",
    loginCurrent: "正在为 {account} 登录。",
    loginSettling: "正在检查账户会话…",
    loginSettlingCurrent: "正在检查 {account} 的会话。",
    loginActualAccount: "Codex 报告：{account}",
    loginConfirming: "正在确认 Codex 登录…",
    loginDeadline: "请在 {time} 前完成登录",
    loginCLIUnavailable: "Codex 未安装或其登录服务不可用。",
    Copied: "已复制",
    copyCode: "复制代码",
  },
  "zh-TW": {
    quotaTitle: "Codex 使用額度",
    quotaRefresh: "重新整理使用額度",
    quotaNotChecked: "尚未檢查使用額度。",
    quotaChecking: "正在讀取 Codex 使用額度…",
    quotaUnavailable: "此帳號的 Codex 使用額度無法取得。",
    quotaUnsupportedSession: "此 ChatGPT 登入無法讀取 Codex 使用額度。可能需要使用此帳號登入 Codex。",
    quotaSignedOut: "請先登入此 ChatGPT 帳號。",
    quotaRateLimited: "提供者要求稍候再重新整理。",
    quotaManualUnavailable: "手動模式無法重新整理使用額度。",
    quotaReportedOnly: "僅顯示 Codex 回報的限制。缺少的值不等於零。",
    quotaGeneral: "Codex 一般使用額度",
    quotaAdditional: "{count} 個模型專屬限制",
    quotaRemaining: "剩餘 {value}%",
    quotaUnknown: "未回報",
    quotaWindowHours: "{count} 小時",
    quotaWindowDays: "{count} 天",
    quotaWindowMinutes: "{count} 分鐘",
    quotaPrimary: "主要時段",
    quotaSecondary: "次要時段",
    quotaResets: "重設時間：{time}",
    quotaUpdated: "更新時間：{time}",
    quotaCoverageTruncated: "回報的限制數量超過可顯示的數量。",
    loginTitle: "登入 Codex",
    loginAction: "登入 Codex",
    loginBody: "在此帳號的瀏覽器工作階段中開啟 OpenAI 官方登入頁面。請在 OpenAI 頁面確認帳號。這會更新共用的 Codex 登入；正在執行的桌面應用程式可能需要重新啟動。",
    loginStarting: "正在準備官方登入…",
    loginOpen: "開啟 OpenAI 登入",
    loginCode: "一次性代碼",
    loginCodeHint: "在 OpenAI 頁面輸入此代碼並確認帳號。",
    loginCancel: "取消登入",
    loginCancelling: "正在取消登入…",
    loginCancelled: "登入已取消。",
    loginCompleted: "Codex 登入已儲存。請在 Codex 桌面設定檔中確認目前帳號；若仍顯示先前的帳號，請重新啟動 Codex。",
    loginFailed: "登入未完成。重試前請檢查 Codex 目前的帳號。",
    loginStatusUnavailable: "無法重新整理 Codex 登入狀態。登入可能仍在進行中。開始新的登入前，請重試狀態檢查。",
    loginUncertain: "登入可能在取消前已完成。請檢查目前的 Codex 帳號。",
    loginWrongAccount: "OpenAI 使用其他帳號完成了登入。繼續前請檢查 Codex 設定檔。",
    loginAccountChanged: "此帳號在登入期間發生變更。請檢查帳號後重新開始。",
    loginCurrent: "正在為 {account} 登入。",
    loginSettling: "正在檢查帳號工作階段…",
    loginSettlingCurrent: "正在檢查 {account} 的工作階段。",
    loginActualAccount: "Codex 回報：{account}",
    loginConfirming: "正在確認 Codex 登入…",
    loginDeadline: "請在 {time} 前完成登入",
    loginCLIUnavailable: "Codex 未安裝或其登入服務無法使用。",
    Copied: "已複製",
    copyCode: "複製代碼",
  },
  ja: {
    quotaTitle: "Codex 利用枠",
    quotaRefresh: "利用枠を更新",
    quotaNotChecked: "利用枠はまだ確認されていません。",
    quotaChecking: "Codex 利用枠を読み取り中…",
    quotaUnavailable: "このアカウントの Codex 利用枠は取得できません。",
    quotaUnsupportedSession: "この ChatGPT サインインでは Codex 利用枠を読み取れませんでした。このアカウントで Codex へのサインインが必要な場合があります。",
    quotaSignedOut: "先にこの ChatGPT アカウントへサインインしてください。",
    quotaRateLimited: "プロバイダーから、更新前に待つよう求められました。",
    quotaManualUnavailable: "手動モードでは利用枠を更新できません。",
    quotaReportedOnly: "Codex が報告した制限のみを表示します。欠落値はゼロではありません。",
    quotaGeneral: "Codex の一般利用枠",
    quotaAdditional: "モデル別の制限：{count} 件",
    quotaRemaining: "残り {value}%",
    quotaUnknown: "報告なし",
    quotaWindowHours: "{count} 時間",
    quotaWindowDays: "{count} 日",
    quotaWindowMinutes: "{count} 分",
    quotaPrimary: "プライマリ期間",
    quotaSecondary: "セカンダリ期間",
    quotaResets: "リセット：{time}",
    quotaUpdated: "更新：{time}",
    quotaCoverageTruncated: "報告された制限が表示可能な件数を超えています。",
    loginTitle: "Codex にサインイン",
    loginAction: "Codex にサインイン",
    loginBody: "このアカウントのブラウザーセッションで OpenAI 公式サインインを開きます。OpenAI ページでアカウントを確認してください。共有 Codex サインインが更新されるため、実行中のデスクトップアプリは再起動が必要な場合があります。",
    loginStarting: "公式サインインを準備中…",
    loginOpen: "OpenAI サインインを開く",
    loginCode: "ワンタイムコード",
    loginCodeHint: "OpenAI ページでこのコードを入力し、アカウントを確認してください。",
    loginCancel: "サインインをキャンセル",
    loginCancelling: "サインインをキャンセル中…",
    loginCancelled: "サインインをキャンセルしました。",
    loginCompleted: "Codex サインインを保存しました。Codex デスクトッププロファイルで有効なアカウントを確認してください。以前のアカウントが表示される場合は Codex を再起動してください。",
    loginFailed: "サインインが完了しませんでした。再試行する前に Codex の現在のアカウントを確認してください。",
    loginStatusUnavailable: "Codex サインインの状態を更新できませんでした。サインインはまだ進行中の可能性があります。新しいサインインを開始する前に状態確認を再試行してください。",
    loginUncertain: "キャンセル前にサインインが完了した可能性があります。有効な Codex アカウントを確認してください。",
    loginWrongAccount: "OpenAI は別のアカウントでサインインを完了しました。続行する前に Codex プロファイルを確認してください。",
    loginAccountChanged: "サインイン中にこのアカウントが変更されました。アカウントを確認してからやり直してください。",
    loginCurrent: "{account} のサインインを実行中です。",
    loginSettling: "アカウントセッションを確認中…",
    loginSettlingCurrent: "{account} のセッションを確認しています。",
    loginActualAccount: "Codex の報告：{account}",
    loginConfirming: "Codex サインインを確認中…",
    loginDeadline: "{time} までにサインインを完了してください",
    loginCLIUnavailable: "Codex がインストールされていないか、サインインサービスを利用できません。",
    Copied: "コピーしました",
    copyCode: "コードをコピー",
  },
  ko: {
    quotaTitle: "Codex 사용 한도",
    quotaRefresh: "사용 한도 새로 고침",
    quotaNotChecked: "사용 한도를 아직 확인하지 않았습니다.",
    quotaChecking: "Codex 사용 한도를 읽는 중…",
    quotaUnavailable: "이 계정의 Codex 사용 한도를 확인할 수 없습니다.",
    quotaUnsupportedSession: "이 ChatGPT 로그인으로는 Codex 사용 한도를 읽을 수 없습니다. 이 계정으로 Codex에 로그인해야 할 수 있습니다.",
    quotaSignedOut: "먼저 이 ChatGPT 계정에 로그인하세요.",
    quotaRateLimited: "제공자가 새로 고침 전에 기다리도록 요청했습니다.",
    quotaManualUnavailable: "수동 모드에서는 사용 한도를 새로 고칠 수 없습니다.",
    quotaReportedOnly: "Codex가 보고한 제한만 표시합니다. 누락된 값은 0이 아닙니다.",
    quotaGeneral: "일반 Codex 사용 한도",
    quotaAdditional: "모델별 제한 {count}개",
    quotaRemaining: "{value}% 남음",
    quotaUnknown: "보고되지 않음",
    quotaWindowHours: "{count}시간",
    quotaWindowDays: "{count}일",
    quotaWindowMinutes: "{count}분",
    quotaPrimary: "기본 기간",
    quotaSecondary: "보조 기간",
    quotaResets: "재설정: {time}",
    quotaUpdated: "업데이트: {time}",
    quotaCoverageTruncated: "보고된 제한이 표시 가능한 수보다 많습니다.",
    loginTitle: "Codex 로그인",
    loginAction: "Codex 로그인",
    loginBody: "이 계정의 브라우저 세션에서 공식 OpenAI 로그인을 엽니다. OpenAI 페이지에서 계정을 확인하세요. 공유 Codex 로그인이 업데이트되므로 실행 중인 데스크톱 앱을 다시 시작해야 할 수 있습니다.",
    loginStarting: "공식 로그인 준비 중…",
    loginOpen: "OpenAI 로그인 열기",
    loginCode: "일회용 코드",
    loginCodeHint: "OpenAI 페이지에 이 코드를 입력하고 계정을 확인하세요.",
    loginCancel: "로그인 취소",
    loginCancelling: "로그인 취소 중…",
    loginCancelled: "로그인이 취소되었습니다.",
    loginCompleted: "Codex 로그인이 저장되었습니다. Codex 데스크톱 프로필에서 활성 계정을 확인하세요. 이전 계정이 계속 표시되면 Codex를 다시 시작하세요.",
    loginFailed: "로그인이 완료되지 않았습니다. 다시 시도하기 전에 현재 Codex 계정을 확인하세요.",
    loginStatusUnavailable: "Codex 로그인 상태를 새로 고칠 수 없습니다. 로그인이 아직 진행 중일 수 있습니다. 새 로그인을 시작하기 전에 상태 확인을 다시 시도하세요.",
    loginUncertain: "취소 전에 로그인이 완료되었을 수 있습니다. 활성 Codex 계정을 확인하세요.",
    loginWrongAccount: "OpenAI가 다른 계정으로 로그인을 완료했습니다. 계속하기 전에 Codex 프로필을 확인하세요.",
    loginAccountChanged: "로그인 중 이 계정이 변경되었습니다. 계정을 확인한 후 다시 시작하세요.",
    loginCurrent: "{account} 계정으로 로그인 중입니다.",
    loginSettling: "계정 세션 확인 중…",
    loginSettlingCurrent: "{account} 계정의 세션을 확인하는 중입니다.",
    loginActualAccount: "Codex 보고: {account}",
    loginConfirming: "Codex 로그인 확인 중…",
    loginDeadline: "{time} 전에 로그인을 완료하세요",
    loginCLIUnavailable: "Codex가 설치되지 않았거나 로그인 서비스를 사용할 수 없습니다.",
    Copied: "복사됨",
    copyCode: "코드 복사",
  },
};

export function accountCodexCopyFor(language: Language): AccountCodexCopy {
  return accountCodexCopies[language];
}
