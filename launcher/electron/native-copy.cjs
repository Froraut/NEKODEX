// Static localized copy for main-process native surfaces: tray, application
// menu and dialogs. Callers own language selection and launcher state reads.
const NATIVE_COPY = Object.freeze({
  ru: Object.freeze({
    openLauncher: "Открыть NEKODEX", quit: "Закрыть интерфейс — native продолжит работу", stopAndQuit: "Остановить соединения и выйти", exportDiagnostics: "Экспортировать диагностику без личных данных",
    cancel: "Отмена", remove: "Удалить", removeTitle: "Удалить NEKODEX",
    removeMessage: "Удалить модели ChatGPT Web из Codex и восстановить прежний маршрут моделей?",
    removeDetail: "Профиль входа ChatGPT в NEKODEX сохранится. Codex потребуется один раз перезапустить.",
    catalogFailure: "Codex подключился к NEKODEX, но загрузка списка моделей завершилась ошибкой (HTTP {status}; {reason}). Проверьте маршрутизацию и события. Если ошибка повторяется, экспортируйте диагностику без личных данных.",
  }),
  en: Object.freeze({
    openLauncher: "Open NEKODEX",
    quit: "Quit interface — keep native running",
    stopAndQuit: "Stop connections and quit",
    exportDiagnostics: "Export privacy-safe diagnostics",
    cancel: "Cancel",
    remove: "Remove",
    removeTitle: "Remove NEKODEX",
    removeMessage: "Remove the ChatGPT Web models from Codex and restore the previous model route?",
    removeDetail: "The launcher's ChatGPT login profile will be preserved. Codex must be restarted once.",
    catalogFailure: "Codex reached NEKODEX, but loading the model catalog failed (HTTP {status}; {reason}). Check the routing details and Activity; export privacy-safe diagnostics if it persists.",
  }),
  "zh-CN": Object.freeze({
    openLauncher: "打开 NEKODEX",
    quit: "退出界面并保持原生模型运行",
    stopAndQuit: "停止连接并退出",
    exportDiagnostics: "导出隐私安全诊断",
    cancel: "取消",
    remove: "移除",
    removeTitle: "移除 NEKODEX",
    removeMessage: "从 Codex 中移除 ChatGPT Web 模型并恢复此前的模型路由？",
    removeDetail: "启动器中的 ChatGPT 登录 profile 会保留。Codex 需要重启一次。",
    catalogFailure: "Codex 已连接到 NEKODEX，但模型列表加载失败（HTTP {status}；{reason}）。请检查路由信息和“活动”；若问题持续，请导出隐私安全诊断。",
  }),
  "zh-TW": Object.freeze({
    openLauncher: "開啟 NEKODEX",
    quit: "關閉介面並保持原生模型執行",
    stopAndQuit: "停止連線並結束",
    exportDiagnostics: "匯出隱私安全診斷",
    cancel: "取消",
    remove: "移除",
    removeTitle: "移除 NEKODEX",
    removeMessage: "從 Codex 中移除 ChatGPT Web 模型並還原先前的模型路由？",
    removeDetail: "啟動器中的 ChatGPT 登入設定檔會保留。Codex 需要重新啟動一次。",
    catalogFailure: "Codex 已連線到 NEKODEX，但模型清單載入失敗（HTTP {status}；{reason}）。請檢查路由資訊與「活動」；若問題持續，請匯出隱私安全診斷。",
  }),
  ja: Object.freeze({
    openLauncher: "NEKODEX を開く",
    quit: "画面を終了してネイティブを維持",
    stopAndQuit: "接続を停止して終了",
    exportDiagnostics: "プライバシー保護済みの診断情報をエクスポート",
    cancel: "キャンセル",
    remove: "削除",
    removeTitle: "NEKODEX を削除",
    removeMessage: "Codex から ChatGPT Web モデルを削除し、以前のモデルルートを復元しますか？",
    removeDetail: "ランチャーの ChatGPT ログインプロファイルは保持されます。Codex を一度再起動する必要があります。",
    catalogFailure: "Codex は NEKODEX に接続しましたが、モデル一覧を読み込めませんでした（HTTP {status}、{reason}）。ルーティング情報とアクティビティを確認し、問題が続く場合はプライバシー保護済みの診断情報をエクスポートしてください。",
  }),
  ko: Object.freeze({
    openLauncher: "NEKODEX 열기",
    quit: "화면 종료 및 네이티브 유지",
    stopAndQuit: "연결 중지 후 종료",
    exportDiagnostics: "개인정보가 보호된 진단 정보 내보내기",
    cancel: "취소",
    remove: "제거",
    removeTitle: "NEKODEX 제거",
    removeMessage: "Codex에서 ChatGPT Web 모델을 제거하고 이전 모델 경로를 복원할까요?",
    removeDetail: "런처의 ChatGPT 로그인 프로필은 유지됩니다. Codex를 한 번 다시 시작해야 합니다.",
    catalogFailure: "Codex가 NEKODEX에 연결했지만 모델 목록을 불러오지 못했습니다(HTTP {status}; {reason}). 경로 정보와 활동을 확인하고 문제가 계속되면 개인정보가 보호된 진단 정보를 내보내세요.",
  }),
});

const UPDATE_CHECK_LABELS = Object.freeze({ ru: "Проверить обновления…", en: "Check for updates…", "zh-CN": "检查更新…", "zh-TW": "檢查更新…", ja: "アップデートを確認…", ko: "업데이트 확인…" });

const RENDERER_RECOVERY_COPY = Object.freeze({
  en: Object.freeze({
    title: "NEKODEX interface needs recovery",
    message: "The launcher interface stopped unexpectedly.",
    active: "An operation is still running. Keep NEKODEX open, let it finish, then open NEKODEX again to choose Restart. The local runtime stays available.",
    idle: "The local runtime will be restarted only if you explicitly choose Restart NEKODEX.",
    keep: "Keep running",
    restart: "Restart NEKODEX",
    retryFailed: "NEKODEX could not restart",
  }),
  ru: Object.freeze({
    title: "Интерфейс NEKODEX нужно восстановить",
    message: "Интерфейс приложения неожиданно остановился.",
    active: "Операция ещё выполняется. Оставьте NEKODEX запущенным, дождитесь её завершения и снова откройте NEKODEX, чтобы выбрать перезапуск. Локальная среда остаётся доступной.",
    idle: "Локальная среда будет перезапущена, только если вы явно выберете «Перезапустить NEKODEX».",
    keep: "Оставить запущенным",
    restart: "Перезапустить NEKODEX",
    retryFailed: "Не удалось перезапустить NEKODEX",
  }),
});

function nativeCopyFor(language) {
  return NATIVE_COPY[language] || NATIVE_COPY.en;
}

function updateCheckLabelFor(language) {
  return UPDATE_CHECK_LABELS[language] || UPDATE_CHECK_LABELS.en;
}

function rendererRecoveryCopyFor(language) {
  return RENDERER_RECOVERY_COPY[language] || RENDERER_RECOVERY_COPY.en;
}

module.exports = { nativeCopyFor, rendererRecoveryCopyFor, updateCheckLabelFor };
