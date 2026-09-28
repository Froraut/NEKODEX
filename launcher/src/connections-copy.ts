import type { Copy } from "./i18n";
import { sessionIssueCopy } from "./session-issue-copy";
import { workflowCopy } from "./workflow-copy";
import type { BrowserState, Language } from "./types";
import type { ConnectionAction, ConnectionStatus, WorkspaceReadiness } from "./workspace-readiness";

// Connection status words and the workspace headline (Overview hero, Connections status notice) that the main
// catalogs (i18n-*.json) do not have. Everything here is derived from WorkspaceReadiness, so the Overview rows and
// hero, the Connections tabs and its notices use the same words for the same state.
export type ConnectionsCopy = {
  /** Status: Manual mode, the model connection exists (NEKODEX does not check the catalog in Manual mode). */
  installed: string;
  /** Status: an optional connection is not set up. */
  notConnected: string;
  /** Status: set up, but degraded. */
  needsAttention: string;
  /** Status: set up, but not available right now. */
  unavailable: string;
  /** Connection row action for a session that needs sign-in. */
  signIn: string;
  /** Connections page subtitle (both tabs, so the tab strip never moves). */
  pageSubtitle: string;
  /** Hero eyebrow while NEKODEX checks something and nothing is needed from the user. */
  inProgress: string;
  sessionCheckingBody: string;
  runtimeCheckingTitle: string;
  runtimeCheckingBody: string;
  runtimeUnavailableTitle: string;
  runtimeUnavailableBody: string;
  runtimeAttentionTitle: string;
  runtimeAttentionBody: string;
  webCheckingTitle: string;
  webCheckingBody: string;
  webUnavailableTitle: string;
  webUnavailableBody: string;
  webDegradedBody: string;
  /** Appended to a Web problem when the native runtime is ready. */
  nativeAvailable: string;
  /** Navigates to the Local tools connector tab, where the repair runs. */
  openRepair: string;
  /** Setup row and hero title for the tools connection (the DS name). */
  toolsTitle: string;
  toolsNotVerifiedBody: string;
  toolsCheckingTitle: string;
  toolsCheckingBody: string;
  toolsAttentionTitle: string;
  /** Manual mode: the model row waits for the tools setup, which installs the harness. */
  toolsFirst: string;
  tunnelIdRequired: string;
  runtimeKeyRequired: string;
};

const copy: Record<Language, ConnectionsCopy> = {
  en: {
    installed: "Installed",
    notConnected: "Not connected",
    needsAttention: "Needs attention",
    unavailable: "Unavailable",
    signIn: "Sign in",
    pageSubtitle: "Set up the ChatGPT session, the Codex model route and local tools. Each connection is verified separately.",
    inProgress: "In progress",
    sessionCheckingBody: "NEKODEX is confirming the saved ChatGPT session. This usually takes a few seconds.",
    runtimeCheckingTitle: "Checking the local runtime",
    runtimeCheckingBody: "NEKODEX is waiting for the local runtime to report that it is ready.",
    runtimeUnavailableTitle: "Local runtime unavailable",
    runtimeUnavailableBody: "Models cannot run until the local runtime is available. Activity shows the latest runtime events.",
    runtimeAttentionTitle: "Local runtime needs attention",
    runtimeAttentionBody: "The local runtime reported a problem, so model requests may fail until it recovers. Activity shows the latest runtime events.",
    webCheckingTitle: "Checking Web transport",
    webCheckingBody: "NEKODEX is waiting for the Web route to report that it is ready.",
    webUnavailableTitle: "Web transport unavailable",
    webUnavailableBody: "Web tasks cannot start until the Web route is available.",
    webDegradedBody: "The Web route reported a problem, so Web tasks may fail until it recovers.",
    nativeAvailable: "Native models remain available.",
    openRepair: "Open Web transport repair",
    toolsTitle: "Connect local tools",
    toolsNotVerifiedBody: "The local harness is connected. Attach the exact connector in ChatGPT, then verify it.",
    toolsCheckingTitle: "Models connected · checking tools",
    toolsCheckingBody: "NEKODEX is waiting for the local tools tunnel to report that it is ready.",
    toolsAttentionTitle: "Models connected · tools need attention",
    toolsFirst: "Available after local tools are connected.",
    tunnelIdRequired: "Enter the Tunnel ID",
    runtimeKeyRequired: "Enter the API key",
  },
  ru: {
    installed: "Установлено",
    notConnected: "Не подключено",
    needsAttention: "Требует внимания",
    unavailable: "Недоступно",
    signIn: "Войти",
    pageSubtitle: "Настройте сеанс ChatGPT, маршрут моделей Codex и локальные инструменты. Каждое подключение проверяется отдельно.",
    inProgress: "Выполняется",
    sessionCheckingBody: "NEKODEX проверяет сохранённый сеанс ChatGPT. Обычно это занимает несколько секунд.",
    runtimeCheckingTitle: "Проверка локальной среды",
    runtimeCheckingBody: "NEKODEX ждёт, пока локальная среда сообщит о готовности.",
    runtimeUnavailableTitle: "Локальная среда недоступна",
    runtimeUnavailableBody: "Модели не смогут работать, пока локальная среда недоступна. Последние события среды показаны в разделе «События».",
    runtimeAttentionTitle: "Локальная среда требует внимания",
    runtimeAttentionBody: "Локальная среда сообщила о проблеме, поэтому запросы к моделям могут завершаться ошибкой, пока она не восстановится. Последние события среды показаны в разделе «События».",
    webCheckingTitle: "Проверка Web-транспорта",
    webCheckingBody: "NEKODEX ждёт, пока Web-маршрут сообщит о готовности.",
    webUnavailableTitle: "Web-транспорт недоступен",
    webUnavailableBody: "Web-задачи не запустятся, пока Web-маршрут недоступен.",
    webDegradedBody: "Web-маршрут сообщил о проблеме, поэтому Web-задачи могут завершаться ошибкой, пока он не восстановится.",
    nativeAvailable: "Нативные модели остаются доступны.",
    openRepair: "Открыть восстановление Web-транспорта",
    toolsTitle: "Подключить локальные инструменты",
    toolsNotVerifiedBody: "Локальная среда подключена. Добавьте точный коннектор в ChatGPT и проверьте его.",
    toolsCheckingTitle: "Модели подключены · проверка инструментов",
    toolsCheckingBody: "NEKODEX ждёт, пока туннель локальных инструментов сообщит о готовности.",
    toolsAttentionTitle: "Модели подключены · инструменты требуют внимания",
    toolsFirst: "Станет доступно после подключения локальных инструментов.",
    tunnelIdRequired: "Введите Tunnel ID",
    runtimeKeyRequired: "Введите API-ключ",
  },
  "zh-CN": {
    installed: "已安装",
    notConnected: "未连接",
    needsAttention: "需要处理",
    unavailable: "不可用",
    signIn: "登录",
    pageSubtitle: "设置 ChatGPT 会话、Codex 模型路由和本地工具。各项连接分别验证。",
    inProgress: "进行中",
    sessionCheckingBody: "NEKODEX 正在确认已保存的 ChatGPT 会话，通常只需几秒钟。",
    runtimeCheckingTitle: "正在检查本地运行时",
    runtimeCheckingBody: "NEKODEX 正在等待本地运行时报告已就绪。",
    runtimeUnavailableTitle: "本地运行时不可用",
    runtimeUnavailableBody: "本地运行时可用之前，模型无法运行。活动中会显示最近的运行时事件。",
    runtimeAttentionTitle: "本地运行时需要处理",
    runtimeAttentionBody: "本地运行时报告了问题，恢复之前模型请求可能会失败。活动中会显示最近的运行时事件。",
    webCheckingTitle: "正在检查 Web 传输",
    webCheckingBody: "NEKODEX 正在等待 Web 路由报告已就绪。",
    webUnavailableTitle: "Web 传输不可用",
    webUnavailableBody: "Web 路由可用之前，Web 任务无法启动。",
    webDegradedBody: "Web 路由报告了问题，恢复之前 Web 任务可能会失败。",
    nativeAvailable: "原生模型仍然可用。",
    openRepair: "打开 Web 传输修复",
    toolsTitle: "连接本地工具",
    toolsNotVerifiedBody: "本地 Harness 已连接。请在 ChatGPT 中添加准确的连接器，然后进行验证。",
    toolsCheckingTitle: "模型已连接 · 正在检查工具",
    toolsCheckingBody: "NEKODEX 正在等待本地工具隧道报告已就绪。",
    toolsAttentionTitle: "模型已连接 · 工具需要处理",
    toolsFirst: "连接本地工具后即可使用。",
    tunnelIdRequired: "请输入 Tunnel ID",
    runtimeKeyRequired: "请输入 API key",
  },
  "zh-TW": {
    installed: "已安裝",
    notConnected: "未連線",
    needsAttention: "需要處理",
    unavailable: "無法使用",
    signIn: "登入",
    pageSubtitle: "設定 ChatGPT 工作階段、Codex 模型路由和本機工具。各項連線分別驗證。",
    inProgress: "進行中",
    sessionCheckingBody: "NEKODEX 正在確認已儲存的 ChatGPT 工作階段，通常只需幾秒鐘。",
    runtimeCheckingTitle: "正在檢查本機執行環境",
    runtimeCheckingBody: "NEKODEX 正在等待本機執行環境回報已就緒。",
    runtimeUnavailableTitle: "本機執行環境無法使用",
    runtimeUnavailableBody: "本機執行環境可用之前，模型無法執行。活動中會顯示最近的執行環境事件。",
    runtimeAttentionTitle: "本機執行環境需要處理",
    runtimeAttentionBody: "本機執行環境回報了問題，恢復之前模型請求可能會失敗。活動中會顯示最近的執行環境事件。",
    webCheckingTitle: "正在檢查 Web 傳輸",
    webCheckingBody: "NEKODEX 正在等待 Web 路由回報已就緒。",
    webUnavailableTitle: "Web 傳輸無法使用",
    webUnavailableBody: "Web 路由可用之前，Web 任務無法啟動。",
    webDegradedBody: "Web 路由回報了問題，恢復之前 Web 任務可能會失敗。",
    nativeAvailable: "原生模型仍可使用。",
    openRepair: "開啟 Web 傳輸修復",
    toolsTitle: "連線本機工具",
    toolsNotVerifiedBody: "本機 Harness 已連線。請在 ChatGPT 中新增準確的聯結器，然後進行驗證。",
    toolsCheckingTitle: "模型已連線 · 正在檢查工具",
    toolsCheckingBody: "NEKODEX 正在等待本機工具通道回報已就緒。",
    toolsAttentionTitle: "模型已連線 · 工具需要處理",
    toolsFirst: "連線本機工具後即可使用。",
    tunnelIdRequired: "請輸入 Tunnel ID",
    runtimeKeyRequired: "請輸入 API key",
  },
  ja: {
    installed: "インストール済み",
    notConnected: "未接続",
    needsAttention: "確認が必要",
    unavailable: "利用不可",
    signIn: "サインイン",
    pageSubtitle: "ChatGPT セッション、Codex モデルルート、ローカルツールを設定します。接続はそれぞれ個別に確認されます。",
    inProgress: "処理中",
    sessionCheckingBody: "NEKODEX が保存済みの ChatGPT セッションを確認しています。通常は数秒で終わります。",
    runtimeCheckingTitle: "ローカルランタイムを確認中",
    runtimeCheckingBody: "NEKODEX はローカルランタイムの準備完了の報告を待っています。",
    runtimeUnavailableTitle: "ローカルランタイムを利用できません",
    runtimeUnavailableBody: "ローカルランタイムが利用可能になるまでモデルは実行できません。最新のランタイムイベントはアクティビティで確認できます。",
    runtimeAttentionTitle: "ローカルランタイムの確認が必要",
    runtimeAttentionBody: "ローカルランタイムで問題が報告されました。回復するまでモデルへのリクエストが失敗する場合があります。最新のランタイムイベントはアクティビティで確認できます。",
    webCheckingTitle: "Web 通信を確認中",
    webCheckingBody: "NEKODEX は Web ルートの準備完了の報告を待っています。",
    webUnavailableTitle: "Web 通信を利用できません",
    webUnavailableBody: "Web ルートが利用可能になるまで Web タスクは開始できません。",
    webDegradedBody: "Web ルートで問題が報告されました。回復するまで Web タスクが失敗する場合があります。",
    nativeAvailable: "ネイティブモデルは引き続き利用できます。",
    openRepair: "Web 通信の修復を開く",
    toolsTitle: "ローカルツールを接続",
    toolsNotVerifiedBody: "ローカルハーネスは接続済みです。ChatGPT で正確なコネクタを追加してから確認してください。",
    toolsCheckingTitle: "モデル接続済み · ツールを確認中",
    toolsCheckingBody: "NEKODEX はローカルツールのトンネルの準備完了の報告を待っています。",
    toolsAttentionTitle: "モデル接続済み · ツールの確認が必要",
    toolsFirst: "ローカルツールの接続後に利用できます。",
    tunnelIdRequired: "Tunnel ID を入力してください",
    runtimeKeyRequired: "API キーを入力してください",
  },
  ko: {
    installed: "설치됨",
    notConnected: "연결 안 됨",
    needsAttention: "확인 필요",
    unavailable: "사용할 수 없음",
    signIn: "로그인",
    pageSubtitle: "ChatGPT 세션, Codex 모델 경로, 로컬 도구를 설정하세요. 각 연결은 별도로 확인됩니다.",
    inProgress: "진행 중",
    sessionCheckingBody: "NEKODEX가 저장된 ChatGPT 세션을 확인하고 있습니다. 보통 몇 초면 끝납니다.",
    runtimeCheckingTitle: "로컬 런타임 확인 중",
    runtimeCheckingBody: "NEKODEX가 로컬 런타임의 준비 완료 보고를 기다리고 있습니다.",
    runtimeUnavailableTitle: "로컬 런타임을 사용할 수 없음",
    runtimeUnavailableBody: "로컬 런타임을 사용할 수 있을 때까지 모델을 실행할 수 없습니다. 최근 런타임 이벤트는 활동에서 확인할 수 있습니다.",
    runtimeAttentionTitle: "로컬 런타임 확인 필요",
    runtimeAttentionBody: "로컬 런타임에서 문제가 보고되었습니다. 복구될 때까지 모델 요청이 실패할 수 있습니다. 최근 런타임 이벤트는 활동에서 확인할 수 있습니다.",
    webCheckingTitle: "Web 전송 확인 중",
    webCheckingBody: "NEKODEX가 Web 경로의 준비 완료 보고를 기다리고 있습니다.",
    webUnavailableTitle: "Web 전송을 사용할 수 없음",
    webUnavailableBody: "Web 경로를 사용할 수 있을 때까지 Web 작업을 시작할 수 없습니다.",
    webDegradedBody: "Web 경로에서 문제가 보고되었습니다. 복구될 때까지 Web 작업이 실패할 수 있습니다.",
    nativeAvailable: "네이티브 모델은 계속 사용할 수 있습니다.",
    openRepair: "Web 전송 복구 열기",
    toolsTitle: "로컬 도구 연결",
    toolsNotVerifiedBody: "로컬 하네스가 연결되었습니다. ChatGPT에서 정확한 커넥터를 추가한 다음 확인하세요.",
    toolsCheckingTitle: "모델 연결됨 · 도구 확인 중",
    toolsCheckingBody: "NEKODEX가 로컬 도구 터널의 준비 완료 보고를 기다리고 있습니다.",
    toolsAttentionTitle: "모델 연결됨 · 도구 확인 필요",
    toolsFirst: "로컬 도구를 연결한 후 사용할 수 있습니다.",
    tunnelIdRequired: "Tunnel ID를 입력하세요",
    runtimeKeyRequired: "API 키를 입력하세요",
  },
};

export const connectionsCopy = (language: Language): ConnectionsCopy => copy[language] ?? copy.en;

/** The status word of a connection (Overview rows, Connections tabs). */
export function connectionStatusWord(status: ConnectionStatus, app: Copy, language: Language): string {
  const words = connectionsCopy(language);
  const session = workflowCopy(language).session;
  switch (status.key) {
    case "verified": return app.connectionVerified;
    case "installed": return words.installed;
    case "manual": return app.manualShort;
    case "checking": return session.checkingVerification;
    case "waiting-for-codex": return app.modelsWaitingShort;
    case "confirm-in-codex": return app.modelsConfirmShort;
    case "needs-sign-in": return app.signInNeededShort;
    case "verification-unavailable": return session.verificationUnavailable;
    case "catalog-unavailable": return app.catalogUnavailable;
    case "needs-setup": return app.connectionPending;
    case "not-connected": return words.notConnected;
    case "needs-attention": return words.needsAttention;
    case "unavailable": return words.unavailable;
  }
}

/** A Connections tab's status line: the same word and dot as the Overview row. */
export function connectionTabStatus(status: ConnectionStatus, app: Copy, language: Language): { state: ConnectionStatus["dot"]; label: string } {
  return { state: status.dot, label: connectionStatusWord(status, app, language) };
}

/** The Connections page subtitle; the same on both tabs, so the tab strip never moves. */
export function connectionsSubtitle(app: Copy, language: Language, { development, manual }: { development: boolean; manual: boolean }): string {
  return development ? app.devSetupSubtitle : manual ? app.manualInteractionBody : connectionsCopy(language).pageSubtitle;
}

/** The short action cue of a connection row. */
export function connectionActionWord(action: ConnectionAction, app: Copy, language: Language): string {
  switch (action) {
    case "manage": return app.manageShort;
    case "connect": return app.connectShort;
    case "sign-in": return connectionsCopy(language).signIn;
    // Runs the check in place (Overview) rather than naming a page.
    case "retry": return workflowCopy(language).session.retryVerification;
    case "open": return app.overviewOpenRun;
    case "open-routing-checks": return app.openRoutingChecks;
  }
}

/**
 * What the next step does. Overview navigates to the surface that performs it (or retries the session itself);
 * the Connections page performs it in place. "wait" has no step: NEKODEX is checking something.
 */
export type HeadlineStep =
  | "wait" | "retry-session" | "sign-in" | "setup" | "routing-checks" | "tools" | "repair" | "activity" | "open-workspace";

export interface WorkspaceHeadline {
  title: string;
  body: string;
  tone: "info" | "success" | "warning" | "error";
  step: HeadlineStep;
  /** Verb-first label of the step's button; while waiting, the busy label ("Checking…"). */
  action: string;
  /**
   * An optional low-emphasis follow-up next to the step: Activity, or the tools connection ("connect-tools" while it
   * is not set up, "tools" to manage it).
   */
  secondary?: "activity" | "tools" | "connect-tools";
}

/** Title, body and next step for every WorkspaceReason: the Overview hero and the Connections status notice. */
export function workspaceHeadline(readiness: WorkspaceReadiness, { app, language, development, manual, authenticationIssue }: {
  app: Copy;
  language: Language;
  development: boolean;
  manual: boolean;
  authenticationIssue?: BrowserState["authenticationIssue"];
}): WorkspaceHeadline {
  const words = connectionsCopy(language);
  const workflow = workflowCopy(language);
  const checking = workflow.session.checkingVerification;
  // Chinese and Japanese sentences follow each other without a space.
  const sentenceGap = language === "ja" || language === "zh-CN" || language === "zh-TW" ? "" : " ";
  const withNative = (body: string) => readiness.native === "ready" ? `${body}${sentenceGap}${words.nativeAvailable}` : body;
  const webRepairBody = readiness.native === "ready" ? workflow.recovery.webTransportBody : app.localToolsUnavailableBody;
  // A Web problem without an eligible repair: the tools connection when it is installed, otherwise routing checks.
  const webStep: Pick<WorkspaceHeadline, "step" | "action"> = readiness.action === "open-tools"
    ? { step: "tools", action: app.manageToolsConnection }
    : { step: "routing-checks", action: app.openRoutingChecks };
  switch (readiness.reason) {
    case "session-checking":
      return { title: app.checkingSignIn, body: words.sessionCheckingBody, tone: "info", step: "wait", action: checking };
    case "session-unavailable":
      return { title: workflow.session.verificationUnavailable, body: sessionIssueCopy(language, authenticationIssue),
        tone: "warning", step: "retry-session", action: workflow.session.retryVerification, secondary: "activity" };
    case "session-signed-out":
      return { title: app.sessionDisconnected, body: app.stepAccountBody, tone: "warning", step: "sign-in", action: app.stepAccount };
    case "browser-check-required":
      return { title: app.stepSmoke, body: app.stepSmokeBody, tone: "info", step: "setup", action: app.finishSetup };
    case "core-not-installed":
      return { title: development ? app.devStepInstall : app.stepInstall,
        body: development ? app.devStepInstallBody : app.stepInstallBody, tone: "info", step: "setup", action: app.finishSetup };
    case "catalog-unavailable":
      return { title: app.catalogUnavailable, body: app.catalogFailureKeptInstall, tone: "error", step: "routing-checks",
        action: app.openRoutingChecks, secondary: "activity" };
    case "catalog-waiting":
      return { title: app.setupCatalogTitle, body: app.setupCatalogBody, tone: "info", step: "routing-checks", action: app.openRoutingChecks };
    case "picker-confirmation-required":
      return { title: app.setupConfirmTitle, body: app.setupConfirmBody, tone: "info", step: "setup", action: app.finishSetup };
    case "tools-not-installed":
      return { title: development ? app.devMcpTitle : words.toolsTitle, body: development ? app.devMcpBody : app.mcpSubtitle,
        tone: "info", step: "tools", action: app.configureMcp };
    case "tools-not-verified":
      return { title: app.connectorNotVerified, body: words.toolsNotVerifiedBody, tone: "info", step: "tools", action: app.configureMcp };
    case "web-repair-active":
      return { title: workflow.recovery.webTransportTitle, body: webRepairBody, tone: "info", step: "wait", action: workflow.recovery.repairing };
    case "web-repair-available":
      return { title: workflow.recovery.webTransportTitle, body: webRepairBody, tone: "warning", step: "repair",
        action: words.openRepair, secondary: "activity" };
    case "web-checking":
      return { title: words.webCheckingTitle, body: withNative(words.webCheckingBody), tone: "info", step: "wait", action: checking };
    case "web-degraded":
      return { title: workflow.recovery.webTransportTitle, body: withNative(words.webDegradedBody), tone: "warning", ...webStep,
        secondary: "activity" };
    case "web-unavailable":
      return { title: words.webUnavailableTitle, body: withNative(words.webUnavailableBody), tone: "warning", ...webStep,
        secondary: "activity" };
    case "runtime-checking":
      return { title: words.runtimeCheckingTitle, body: words.runtimeCheckingBody, tone: "info", step: "wait", action: checking };
    case "runtime-unavailable":
      return { title: words.runtimeUnavailableTitle, body: words.runtimeUnavailableBody, tone: "error", step: "activity",
        action: app.viewActivity };
    case "workspace-ready":
      break;
  }
  const ready = { step: "open-workspace", action: app.openWorkspace, secondary: "activity" } as const;
  // The runtime answers but reports a problem: the models row says Needs attention, so the headline explains it.
  if (readiness.native === "degraded") {
    return { title: words.runtimeAttentionTitle, body: words.runtimeAttentionBody, tone: "warning", step: "activity",
      action: app.viewActivity };
  }
  if (manual) return { title: app.manualSetupReady, body: app.manualSetupReadyBody, tone: "success", ...ready };
  if (readiness.tools === "ready") {
    return { title: app.setupChecksPassed, body: app.connectorAvailableNotExecuted, tone: "success", ...ready };
  }
  if (readiness.tools === "checking") return { title: words.toolsCheckingTitle, body: words.toolsCheckingBody, tone: "info", ...ready };
  if (readiness.tools === "degraded" || readiness.connections.tools.key === "unavailable") {
    return { title: words.toolsAttentionTitle, body: app.localToolsUnavailableBody, tone: "warning", ...ready, secondary: "tools" };
  }
  // Tools are optional in Automatic mode: the workspace is ready, and connecting them is the follow-up.
  return { title: app.setupReadyModels, body: app.setupUseCodex, tone: "success", ...ready, secondary: "connect-tools" };
}
