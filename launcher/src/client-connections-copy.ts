import type { Language } from "./types";

/** Strings of the "Other clients" disclosure (Local API, Claude Code, Codex provider) on the Connections page. */
export type ClientConnectionsCopy = {
  title: string;
  body: string;
  loading: string;
  /** Re-reads the client status. */
  refresh: string;
  /** Fallback when reading the client status fails without a message. */
  loadFailed: string;
  /** Fallback when a change fails without a message. */
  changeFailed: string;
  api: string;
  enabled: string;
  disabled: string;
  apiBody: string;
  enable: string;
  disable: string;
  copy: string;
  copied: string;
  rotate: string;
  rotateBody: string;
  claude: string;
  claudeBody: string;
  connect: string;
  reconnect: string;
  disconnect: string;
  configured: string;
  missing: string;
  /** Claude Code settings exist, but the connection needs to be refreshed (the row shows why). */
  needsAttention: string;
  claudeRestart: string;
  provider: string;
  mixed: string;
  web: string;
  apply: string;
  providerBody: string;
  codexRestart: string;
  picker: string;
  pickerBody: string;
  pickerRestart: string;
  setup: string;
  dev: string;
};

const copy: Record<Language, ClientConnectionsCopy> = {
  en: {
    title: "Other clients", body: "Use this workspace's ChatGPT models in Claude Code or a local API client.",
    loading: "Checking connections…", refresh: "Refresh status",
    loadFailed: "Client connections could not be read. Try again.", changeFailed: "The change could not be saved. Try again.",
    api: "Local API", enabled: "Enabled", disabled: "Disabled",
    apiBody: "Chat Completions and Messages on this computer. Requests use your ChatGPT session and its limits.",
    enable: "Enable API", disable: "Disable API", copy: "Copy API key", copied: "API key copied.", rotate: "Replace API key",
    rotateBody: "Replacing the key disconnects clients using the old one. Reconnect Claude Code and update other clients.",
    claude: "Claude Code", claudeBody: "Claude Code runs the tools and keeps its permissions. ChatGPT supplies the model responses.",
    connect: "Connect Claude Code", reconnect: "Refresh Claude settings", disconnect: "Disconnect Claude Code",
    configured: "Configured", missing: "Not configured", needsAttention: "Needs attention",
    claudeRestart: "Settings saved. Restart Claude Code to load this connection.",
    provider: "Codex provider", mixed: "Native and Web models", web: "Web models only", apply: "Apply provider mode",
    providerBody: "Web-only uses a separate provider when native Codex account limits prevent Web tasks from starting. ChatGPT limits still apply; native models are unavailable in this mode.",
    codexRestart: "Provider saved. Fully quit and reopen Codex, then start a new task.",
    picker: "Show Web models in the Codex app model picker",
    pickerBody: "The Codex app lists only models OpenAI allows for your account. NEKODEX gives Codex its own model list with your native and Web models and keeps it up to date. Codex reads the list when it starts; restart it after model changes.",
    pickerRestart: "Model list saved. Fully quit and reopen Codex to see it.",
    setup: "Connect your models first to configure other clients.", dev: "Use the main NEKODEX app to configure your installed clients.",
  },
  ru: {
    title: "Другие клиенты", body: "Используйте модели ChatGPT этого приложения в Claude Code и клиентах локального API.",
    loading: "Проверяем подключения…", refresh: "Обновить статус",
    loadFailed: "Не удалось прочитать подключения клиентов. Попробуйте ещё раз.", changeFailed: "Не удалось сохранить изменение. Попробуйте ещё раз.",
    api: "Локальный API", enabled: "Включён", disabled: "Выключен",
    apiBody: "Chat Completions и Messages на этом компьютере. Запросы используют вашу сессию ChatGPT и её лимиты.",
    enable: "Включить API", disable: "Выключить API", copy: "Скопировать API-ключ", copied: "API-ключ скопирован.", rotate: "Заменить API-ключ",
    rotateBody: "После замены ключа старый перестанет работать. Обновите подключение Claude Code и ключ в других клиентах.",
    claude: "Claude Code", claudeBody: "Claude Code выполняет инструменты со своими разрешениями. Ответы модели поступают из ChatGPT.",
    connect: "Подключить Claude Code", reconnect: "Обновить настройки Claude", disconnect: "Отключить Claude Code",
    configured: "Настроен", missing: "Не настроен", needsAttention: "Требует внимания",
    claudeRestart: "Настройки сохранены. Перезапустите Claude Code, чтобы применить подключение.",
    provider: "Провайдер Codex", mixed: "Native и Web модели", web: "Только Web модели", apply: "Применить режим провайдера",
    providerBody: "Режим Web-only использует отдельного провайдера, если лимит Native-аккаунта Codex мешает запуску Web-задач. Лимиты ChatGPT сохраняются; Native-модели в этом режиме недоступны.",
    codexRestart: "Провайдер сохранён. Полностью закройте и откройте Codex, затем начните новую задачу.",
    picker: "Показывать Web-модели в выборе моделей Codex",
    pickerBody: "Приложение Codex показывает только модели, разрешённые OpenAI для вашего аккаунта. NEKODEX передаёт Codex собственный список с Native- и Web-моделями и поддерживает его актуальным. Codex читает список при запуске — после изменения моделей перезапустите его.",
    pickerRestart: "Список моделей сохранён. Полностью закройте и откройте Codex, чтобы его увидеть.",
    setup: "Сначала подключите модели, затем настройте другие клиенты.", dev: "Настраивайте установленные клиенты в основном приложении NEKODEX.",
  },
  "zh-CN": {
    title: "其他客户端", body: "在 Claude Code 或本地 API 客户端中使用此工作区的 ChatGPT 模型。",
    loading: "正在检查连接…", refresh: "刷新状态",
    loadFailed: "无法读取客户端连接。请重试。", changeFailed: "无法保存更改。请重试。",
    api: "本地 API", enabled: "已启用", disabled: "已停用",
    apiBody: "在这台电脑上提供 Chat Completions 和 Messages。请求使用你的 ChatGPT 会话及其额度。",
    enable: "启用 API", disable: "停用 API", copy: "复制 API key", copied: "已复制 API key。", rotate: "更换 API key",
    rotateBody: "更换密钥后，使用旧密钥的客户端会断开。请重新连接 Claude Code，并更新其他客户端。",
    claude: "Claude Code", claudeBody: "Claude Code 执行工具并保留自己的权限，模型回复由 ChatGPT 提供。",
    connect: "连接 Claude Code", reconnect: "刷新 Claude 设置", disconnect: "断开 Claude Code",
    configured: "已配置", missing: "未配置", needsAttention: "需要处理",
    claudeRestart: "设置已保存。重启 Claude Code 以加载此连接。",
    provider: "Codex 提供方", mixed: "原生和 Web 模型", web: "仅 Web 模型", apply: "应用提供方模式",
    providerBody: "当原生 Codex 账户额度导致 Web 任务无法启动时，仅 Web 模式会使用单独的提供方。ChatGPT 额度仍然适用；此模式下原生模型不可用。",
    codexRestart: "提供方已保存。请完全退出并重新打开 Codex，然后开始新任务。",
    picker: "在 Codex 应用的模型选择器中显示 Web 模型",
    pickerBody: "Codex 应用只列出 OpenAI 允许你的账户使用的模型。NEKODEX 会为 Codex 提供包含原生和 Web 模型的专属模型列表，并保持更新。Codex 在启动时读取该列表；模型变更后请重启 Codex。",
    pickerRestart: "模型列表已保存。请完全退出并重新打开 Codex 以查看。",
    setup: "请先连接模型，再配置其他客户端。", dev: "请在 NEKODEX 主应用中配置已安装的客户端。",
  },
  "zh-TW": {
    title: "其他用戶端", body: "在 Claude Code 或本機 API 用戶端中使用此工作區的 ChatGPT 模型。",
    loading: "正在檢查連線…", refresh: "重新整理狀態",
    loadFailed: "無法讀取用戶端連線。請再試一次。", changeFailed: "無法儲存變更。請再試一次。",
    api: "本機 API", enabled: "已啟用", disabled: "已停用",
    apiBody: "在這台電腦上提供 Chat Completions 和 Messages。請求使用你的 ChatGPT 工作階段及其額度。",
    enable: "啟用 API", disable: "停用 API", copy: "複製 API key", copied: "已複製 API key。", rotate: "更換 API key",
    rotateBody: "更換金鑰後，使用舊金鑰的用戶端會中斷連線。請重新連線 Claude Code，並更新其他用戶端。",
    claude: "Claude Code", claudeBody: "Claude Code 執行工具並保留自己的權限，模型回覆由 ChatGPT 提供。",
    connect: "連線 Claude Code", reconnect: "重新整理 Claude 設定", disconnect: "中斷 Claude Code 連線",
    configured: "已設定", missing: "未設定", needsAttention: "需要處理",
    claudeRestart: "設定已儲存。重新啟動 Claude Code 以載入此連線。",
    provider: "Codex 提供方", mixed: "原生和 Web 模型", web: "僅 Web 模型", apply: "套用提供方模式",
    providerBody: "當原生 Codex 帳號額度導致 Web 任務無法啟動時，僅 Web 模式會使用獨立的提供方。ChatGPT 額度仍然適用；此模式下無法使用原生模型。",
    codexRestart: "提供方已儲存。請完全結束並重新開啟 Codex，然後開始新任務。",
    picker: "在 Codex 應用程式的模型選擇器中顯示 Web 模型",
    pickerBody: "Codex 應用程式只會列出 OpenAI 允許你的帳號使用的模型。NEKODEX 會為 Codex 提供包含原生和 Web 模型的專屬模型清單，並保持更新。Codex 在啟動時讀取此清單；模型變更後請重新啟動 Codex。",
    pickerRestart: "模型清單已儲存。請完全結束並重新開啟 Codex 以查看。",
    setup: "請先連線模型，再設定其他用戶端。", dev: "請在 NEKODEX 主應用程式中設定已安裝的用戶端。",
  },
  ja: {
    title: "その他のクライアント", body: "このワークスペースの ChatGPT モデルを Claude Code やローカル API クライアントで使用します。",
    loading: "接続を確認中…", refresh: "状態を更新",
    loadFailed: "クライアントの接続を読み取れませんでした。もう一度お試しください。", changeFailed: "変更を保存できませんでした。もう一度お試しください。",
    api: "ローカル API", enabled: "有効", disabled: "無効",
    apiBody: "このコンピューターで Chat Completions と Messages を提供します。リクエストには ChatGPT セッションとその利用上限が使われます。",
    enable: "API を有効にする", disable: "API を無効にする", copy: "API キーをコピー", copied: "API キーをコピーしました。", rotate: "API キーを置き換える",
    rotateBody: "キーを置き換えると、古いキーを使っているクライアントは切断されます。Claude Code を再接続し、ほかのクライアントも更新してください。",
    claude: "Claude Code", claudeBody: "ツールは Claude Code が自身の権限で実行し、モデルの応答は ChatGPT が返します。",
    connect: "Claude Code を接続", reconnect: "Claude の設定を更新", disconnect: "Claude Code を切断",
    configured: "設定済み", missing: "未設定", needsAttention: "確認が必要",
    claudeRestart: "設定を保存しました。この接続を読み込むには Claude Code を再起動してください。",
    provider: "Codex プロバイダー", mixed: "ネイティブと Web モデル", web: "Web モデルのみ", apply: "プロバイダーモードを適用",
    providerBody: "ネイティブの Codex アカウントの利用上限で Web タスクを開始できない場合、Web のみモードは別のプロバイダーを使用します。ChatGPT の利用上限は引き続き適用され、このモードではネイティブモデルを利用できません。",
    codexRestart: "プロバイダーを保存しました。Codex を完全に終了して開き直し、新しいタスクを開始してください。",
    picker: "Codex アプリのモデル選択に Web モデルを表示",
    pickerBody: "Codex アプリには、OpenAI がアカウントに許可したモデルだけが表示されます。NEKODEX はネイティブと Web のモデルを含む専用のモデル一覧を Codex に渡し、最新の状態に保ちます。Codex は起動時に一覧を読み込むため、モデルを変更したら再起動してください。",
    pickerRestart: "モデル一覧を保存しました。表示するには Codex を完全に終了して開き直してください。",
    setup: "ほかのクライアントを設定する前に、モデルを接続してください。", dev: "インストール済みのクライアントは NEKODEX のメインアプリで設定してください。",
  },
  ko: {
    title: "기타 클라이언트", body: "이 작업 공간의 ChatGPT 모델을 Claude Code나 로컬 API 클라이언트에서 사용하세요.",
    loading: "연결 확인 중…", refresh: "상태 새로 고침",
    loadFailed: "클라이언트 연결을 읽을 수 없습니다. 다시 시도하세요.", changeFailed: "변경 사항을 저장할 수 없습니다. 다시 시도하세요.",
    api: "로컬 API", enabled: "사용 중", disabled: "사용 안 함",
    apiBody: "이 컴퓨터에서 Chat Completions와 Messages를 제공합니다. 요청에는 ChatGPT 세션과 그 사용 한도가 적용됩니다.",
    enable: "API 사용", disable: "API 사용 중지", copy: "API 키 복사", copied: "API 키를 복사했습니다.", rotate: "API 키 교체",
    rotateBody: "키를 교체하면 이전 키를 사용하는 클라이언트의 연결이 끊어집니다. Claude Code를 다시 연결하고 다른 클라이언트도 업데이트하세요.",
    claude: "Claude Code", claudeBody: "도구는 Claude Code가 자체 권한으로 실행하고, 모델 응답은 ChatGPT가 제공합니다.",
    connect: "Claude Code 연결", reconnect: "Claude 설정 새로 고침", disconnect: "Claude Code 연결 해제",
    configured: "구성됨", missing: "구성 안 됨", needsAttention: "확인 필요",
    claudeRestart: "설정을 저장했습니다. 이 연결을 불러오려면 Claude Code를 다시 시작하세요.",
    provider: "Codex 공급자", mixed: "네이티브 및 Web 모델", web: "Web 모델만", apply: "공급자 모드 적용",
    providerBody: "네이티브 Codex 계정 한도 때문에 Web 작업을 시작할 수 없을 때 Web 전용 모드는 별도의 공급자를 사용합니다. ChatGPT 한도는 그대로 적용되며, 이 모드에서는 네이티브 모델을 사용할 수 없습니다.",
    codexRestart: "공급자를 저장했습니다. Codex를 완전히 종료했다가 다시 열고 새 작업을 시작하세요.",
    picker: "Codex 앱의 모델 선택기에 Web 모델 표시",
    pickerBody: "Codex 앱에는 OpenAI가 계정에 허용한 모델만 표시됩니다. NEKODEX는 네이티브 및 Web 모델이 포함된 자체 모델 목록을 Codex에 제공하고 최신 상태로 유지합니다. Codex는 시작할 때 목록을 읽으므로 모델이 바뀌면 다시 시작하세요.",
    pickerRestart: "모델 목록을 저장했습니다. 목록을 보려면 Codex를 완전히 종료했다가 다시 여세요.",
    setup: "다른 클라이언트를 구성하려면 먼저 모델을 연결하세요.", dev: "설치된 클라이언트는 NEKODEX 기본 앱에서 구성하세요.",
  },
};

export const clientConnectionsCopy = (language: Language): ClientConnectionsCopy => copy[language] ?? copy.en;
