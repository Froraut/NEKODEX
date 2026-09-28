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
};

const copy: Record<Language, BrowserSurfaceCopy> = {
  en: {
    signInProgress: "Sign-in progress",
    passkeySteps: ["Sign in", "Import", "Verify"],
    existingChromeSteps: ["Connect Chrome", "Read sign-in", "Verify"],
    passkeyGuideTitle: "Passkey sign-in",
    existingChromeGuideTitle: "Existing Chrome sign-in",
  },
  ru: {
    signInProgress: "Ход входа",
    passkeySteps: ["Вход", "Импорт", "Проверка"],
    existingChromeSteps: ["Подключение Chrome", "Чтение входа", "Проверка"],
    passkeyGuideTitle: "Вход с ключом доступа",
    existingChromeGuideTitle: "Вход из Chrome",
  },
  "zh-CN": {
    signInProgress: "登录进度",
    passkeySteps: ["登录", "导入", "验证"],
    existingChromeSteps: ["连接 Chrome", "读取登录", "验证"],
    passkeyGuideTitle: "通行密钥登录",
    existingChromeGuideTitle: "现有 Chrome 登录",
  },
  "zh-TW": {
    signInProgress: "登入進度",
    passkeySteps: ["登入", "匯入", "驗證"],
    existingChromeSteps: ["連線 Chrome", "讀取登入", "驗證"],
    passkeyGuideTitle: "通行金鑰登入",
    existingChromeGuideTitle: "現有 Chrome 登入",
  },
  ja: {
    signInProgress: "サインインの進行状況",
    passkeySteps: ["サインイン", "取り込み", "確認"],
    existingChromeSteps: ["Chrome に接続", "ログインを読み取り", "確認"],
    passkeyGuideTitle: "パスキーでのサインイン",
    existingChromeGuideTitle: "既存の Chrome ログイン",
  },
  ko: {
    signInProgress: "로그인 진행 상황",
    passkeySteps: ["로그인", "가져오기", "확인"],
    existingChromeSteps: ["Chrome 연결", "로그인 읽기", "확인"],
    passkeyGuideTitle: "패스키 로그인",
    existingChromeGuideTitle: "기존 Chrome 로그인",
  },
};

export const browserSurfaceCopy = (language: Language): BrowserSurfaceCopy => copy[language] ?? copy.en;
