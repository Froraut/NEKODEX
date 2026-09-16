const STARTUP_PHASES = Object.freeze({
  "runtime-files": "preparing the packaged runtime",
  "electron-ready": "starting the desktop application",
  "window": "creating the launcher window",
  "browser-control": "starting the private browser control service",
  "browser": "initializing the embedded browser",
  "renderer": "loading the launcher interface",
  "runtime": "starting the local runtime",
});

const RECOVERY_COPY = Object.freeze({
  en: {
    title: "NEKODEX could not start", failed: phase => `Startup failed while ${phase}.`,
    unavailable: "The application will exit. Open it again to retry.",
    timeout: "This startup step exceeded its readiness deadline. ",
    detail: "Restart to try again in a new process, or quit and reopen the application later. Your saved settings and sign-in data are retained.",
    quit: "Quit", restart: "Restart", phases: STARTUP_PHASES,
  },
  "zh-CN": {
    title: "NEKODEX 无法启动", failed: phase => `启动在${phase}时失败。`,
    unavailable: "应用将退出。请重新打开后重试。",
    timeout: "此启动步骤超过了就绪期限。",
    detail: "选择重新启动以在新进程中重试，或退出后再打开应用。已保存的设置和登录数据会保留。",
    quit: "退出", restart: "重新启动", phases: {
      "runtime-files": "准备打包运行环境", "electron-ready": "启动桌面应用", window: "创建启动器窗口",
      "browser-control": "启动私有浏览器控制服务", browser: "初始化内嵌浏览器",
      renderer: "加载启动器界面", runtime: "启动本地运行环境",
    },
  },
  "zh-TW": {
    title: "NEKODEX 無法啟動", failed: phase => `啟動在${phase}時失敗。`,
    unavailable: "應用程式將結束。請重新開啟後再試。",
    timeout: "此啟動步驟超過了就緒期限。",
    detail: "選擇重新啟動以在新程序中重試，或結束後再開啟應用程式。已儲存的設定和登入資料會保留。",
    quit: "結束", restart: "重新啟動", phases: {
      "runtime-files": "準備封裝的執行環境", "electron-ready": "啟動桌面應用程式", window: "建立啟動器視窗",
      "browser-control": "啟動私人瀏覽器控制服務", browser: "初始化內嵌瀏覽器",
      renderer: "載入啟動器介面", runtime: "啟動本機執行環境",
    },
  },
  ja: {
    title: "NEKODEX を起動できませんでした", failed: phase => `${phase}中に起動に失敗しました。`,
    unavailable: "アプリケーションを終了します。再度開いてお試しください。",
    timeout: "この起動手順は準備完了までの制限時間を超えました。",
    detail: "再起動すると新しいプロセスでやり直します。終了して後で開くこともできます。保存済みの設定とログイン情報は保持されます。",
    quit: "終了", restart: "再起動", phases: {
      "runtime-files": "同梱ランタイムを準備", "electron-ready": "デスクトップアプリを起動", window: "ランチャーのウィンドウを作成",
      "browser-control": "専用ブラウザー制御サービスを起動", browser: "内蔵ブラウザーを初期化",
      renderer: "ランチャー画面を読み込み", runtime: "ローカルランタイムを起動",
    },
  },
  ko: {
    title: "NEKODEX를 시작할 수 없습니다", failed: phase => `${phase} 중 시작에 실패했습니다.`,
    unavailable: "앱이 종료됩니다. 다시 열어 재시도하세요.",
    timeout: "이 시작 단계가 준비 제한 시간을 초과했습니다. ",
    detail: "다시 시작하면 새 프로세스에서 재시도합니다. 종료하고 나중에 다시 열 수도 있습니다. 저장된 설정과 로그인 데이터는 유지됩니다.",
    quit: "종료", restart: "다시 시작", phases: {
      "runtime-files": "패키지 런타임 준비", "electron-ready": "데스크톱 앱 시작", window: "런처 창 생성",
      "browser-control": "전용 브라우저 제어 서비스 시작", browser: "내장 브라우저 초기화",
      renderer: "런처 화면 로드", runtime: "로컬 런타임 시작",
    },
  },
});

function startupFailureDetails(error, phase) {
  const stage = Object.hasOwn(STARTUP_PHASES, phase) ? phase : "electron-ready";
  const message = typeof error?.message === "string" ? error.message : "";
  const reason = /timeout|timed out|deadline|within \d+ms/i.test(message) ? "timeout"
    : /ERR_[A-Z_]+/.test(message) ? "browser-load-failed" : "initialization-failed";
  // Startup errors can contain local paths, remote URLs and query credentials. Keep the
  // failure report useful without copying arbitrary exception text into UI or logs.
  return { phase: stage, reason };
}

async function settleWithin(action, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action).then(() => true, () => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function recoverStartupFailure({
  app, dialog, error, phase, cleanup = () => {}, recordFailure = () => {},
  args = process.argv.slice(1), interactive = true, timeoutMs = 3_000,
  launchEnvironment, language = "en",
}) {
  let exitCode = 1;
  let cleaned = false;
  const details = startupFailureDetails(error, phase);
  const copy = Object.hasOwn(RECOVERY_COPY, language) ? RECOVERY_COPY[language] : RECOVERY_COPY.en;
  const phaseText = copy.phases[details.phase];
  // Electron otherwise quits when the last window is destroyed. Hold the application
  // only while this native recovery dialog is visible, then unconditionally exit below.
  const keepRecoveryAlive = () => {};
  app.on("window-all-closed", keepRecoveryAlive);
  try {
    try { recordFailure(details); } catch {}
    // Cleanup cannot hold the single-instance lock indefinitely. A fresh process is the
    // retry boundary; we never rerun start() against partially initialized Electron state.
    cleaned = await settleWithin(cleanup, timeoutMs);
    if (!interactive) return { action: "quit", ...details, cleaned };
    const ready = app.isReady() || await settleWithin(() => app.whenReady(), timeoutMs);
    if (!ready) {
      try {
        dialog.showErrorBox(copy.title, `${copy.failed(phaseText)} ${copy.unavailable}`);
      } catch {}
      return { action: "quit", ...details, cleaned };
    }
    const result = await dialog.showMessageBox({
      type: "error",
      title: copy.title,
      message: copy.failed(phaseText),
      detail: `${details.reason === "timeout" ? copy.timeout : ""}${copy.detail}`,
      buttons: [copy.quit, copy.restart],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) {
      // An explicit recovery launch must be visible even after a hidden autostart.
      if (launchEnvironment) {
        for (const [key, value] of Object.entries(launchEnvironment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      app.relaunch({ args: args.filter(arg => arg !== "--hidden") });
      exitCode = 0;
      return { action: "restart", ...details, cleaned };
    }
    return { action: "quit", ...details, cleaned };
  } catch {
    // Native UI failures must not leave an invisible, locked launcher process behind.
    return { action: "quit", ...details, cleaned };
  } finally {
    app.removeListener("window-all-closed", keepRecoveryAlive);
    app.exit(exitCode);
  }
}

module.exports = { recoverStartupFailure, startupFailureDetails };
