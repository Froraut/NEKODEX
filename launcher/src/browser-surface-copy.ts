import type { Language } from "./types";

// Browser surface strings that the main catalogs (i18n-*.json) and browser-window-copy.ts do not have.
export type BrowserSurfaceCopy = {
  /** Accessible name of the sign-in PhaseSteps in the passkey and existing Chrome guides. */
  signInProgress: string;
  /** Passkey sign-in in the separate browser window: sign in, import the session, verify it. */
  passkeySteps: [signIn: string, importSession: string, verify: string];
  /** Existing Chrome sign-in: connect to Chrome, read the session, verify it. */
  existingChromeSteps: [connect: string, read: string, verify: string];
  /** Guide headings once a flow failed or timed out; the error Notice under them says what failed. */
  passkeyGuideTitle: string;
  existingChromeGuideTitle: string;
  /** Confirmation before the tab × closes a failed or stopped task's page (the only record of how it ended). */
  closeFailedTitle: string;
  closeFailedBody: string;
  closeFailedConfirm: string;
  /** A kept tab whose task was stopped. */
  stoppedTab: string;
};

const copy: Record<Language, BrowserSurfaceCopy> = {
  en: {
    signInProgress: "Sign-in progress",
    passkeySteps: ["Sign in", "Import", "Verify"],
    existingChromeSteps: ["Connect Chrome", "Read sign-in", "Verify"],
    passkeyGuideTitle: "Passkey sign-in",
    existingChromeGuideTitle: "Existing Chrome sign-in",
    closeFailedTitle: "Close this task’s page?",
    closeFailedBody: "It shows how the task ended. Check it before retrying; do not resend an uncertain submission.",
    closeFailedConfirm: "Close page",
    stoppedTab: "Stopped",
  },
  ru: {
    signInProgress: "Ход входа",
    passkeySteps: ["Вход", "Импорт", "Проверка"],
    existingChromeSteps: ["Подключение Chrome", "Чтение входа", "Проверка"],
    passkeyGuideTitle: "Вход с ключом доступа",
    existingChromeGuideTitle: "Вход из Chrome",
    closeFailedTitle: "Закрыть страницу этой задачи?",
    closeFailedBody: "На ней видно, чем закончилась задача. Проверьте её перед повтором и не отправляйте повторно запрос с неизвестным результатом.",
    closeFailedConfirm: "Закрыть страницу",
    stoppedTab: "Остановлена",
  },
  "zh-CN": {
    signInProgress: "登录进度",
    passkeySteps: ["登录", "导入", "验证"],
    existingChromeSteps: ["连接 Chrome", "读取登录", "验证"],
    passkeyGuideTitle: "通行密钥登录",
    existingChromeGuideTitle: "现有 Chrome 登录",
    closeFailedTitle: "关闭此任务的页面？",
    closeFailedBody: "页面显示了任务的结束情况。重试前请先检查；不要重新发送状态不确定的请求。",
    closeFailedConfirm: "关闭页面",
    stoppedTab: "已停止",
  },
  "zh-TW": {
    signInProgress: "登入進度",
    passkeySteps: ["登入", "匯入", "驗證"],
    existingChromeSteps: ["連線 Chrome", "讀取登入", "驗證"],
    passkeyGuideTitle: "通行金鑰登入",
    existingChromeGuideTitle: "現有 Chrome 登入",
    closeFailedTitle: "關閉此任務的頁面？",
    closeFailedBody: "頁面顯示了任務的結束情況。重試前請先檢查；不要重新傳送狀態不確定的請求。",
    closeFailedConfirm: "關閉頁面",
    stoppedTab: "已停止",
  },
  ja: {
    signInProgress: "サインインの進行状況",
    passkeySteps: ["サインイン", "取り込み", "確認"],
    existingChromeSteps: ["Chrome に接続", "ログインを読み取り", "確認"],
    passkeyGuideTitle: "パスキーでのサインイン",
    existingChromeGuideTitle: "既存の Chrome ログイン",
    closeFailedTitle: "このタスクのページを閉じますか？",
    closeFailedBody: "タスクがどう終わったかがこのページに表示されています。再試行の前に確認し、結果が不確かな送信は再送しないでください。",
    closeFailedConfirm: "ページを閉じる",
    stoppedTab: "停止済み",
  },
  ko: {
    signInProgress: "로그인 진행 상황",
    passkeySteps: ["로그인", "가져오기", "확인"],
    existingChromeSteps: ["Chrome 연결", "로그인 읽기", "확인"],
    passkeyGuideTitle: "패스키 로그인",
    existingChromeGuideTitle: "기존 Chrome 로그인",
    closeFailedTitle: "이 작업의 페이지를 닫을까요?",
    closeFailedBody: "작업이 어떻게 끝났는지 이 페이지에서 확인할 수 있습니다. 다시 시도하기 전에 확인하고, 결과가 불확실한 요청은 다시 보내지 마세요.",
    closeFailedConfirm: "페이지 닫기",
    stoppedTab: "중지됨",
  },
};

export const browserSurfaceCopy = (language: Language): BrowserSurfaceCopy => copy[language] ?? copy.en;
