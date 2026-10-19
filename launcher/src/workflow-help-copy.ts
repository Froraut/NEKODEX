import type { Language } from './types';

export type WorkflowHelpTopic = 'native' | 'vm' | 'browser';
type Guide = { title: string; body: string; action: string };
type WorkflowHelpCopy = {
  development: string; packaged: string; versionBoundary: string;
  guides: Record<WorkflowHelpTopic, Guide>;
};
const en: WorkflowHelpCopy = {
  development: 'Running development app', packaged: 'Running packaged app',
  versionBoundary: 'This version identifies the running app. Source changes do not confirm an installed update; connection readiness does not confirm a task result.',
  guides: {
    native: { title: 'Native account and model connection', body: 'Inspect the selected account, authentication and model inventory in Native. A saved profile or sign-in window is not a connected account. Review retained receipts before retrying an uncertain turn.', action: 'Open Native connection' },
    vm: { title: 'VM environment, shell and export', body: 'Inspect the prepared environment and exact task attachment in Agent tools. Preparation is separate from a running VM. For an unknown export outcome, inspect its saved receipt before any retry.', action: 'Open VM tools' },
    browser: { title: 'Browser companion connection and recovery', body: 'Inspect the provider connection and selected task tab in Browser companion. A connected companion does not attach a tab or prove an action result. Refresh observation after a stale binding; reconcile unknown input before retrying.', action: 'Open Browser companion' },
  },
};
const ru: WorkflowHelpCopy = {
  development: 'Запущено приложение разработки', packaged: 'Запущено упакованное приложение',
  versionBoundary: 'Это версия запущенного приложения. Изменения исходников не подтверждают установленное обновление; готовность подключения не подтверждает результат задачи.',
  guides: {
    native: { title: 'Native: аккаунт и подключение моделей', body: 'Проверьте выбранный аккаунт, авторизацию и каталог моделей в Native. Сохранённый профиль или окно входа ещё не означают подключённый аккаунт. Перед повтором неопределённого хода просмотрите сохранённые квитанции.', action: 'Открыть подключение Native' },
    vm: { title: 'VM: среда, shell и экспорт', body: 'Проверьте подготовленную среду и точную привязку задачи в инструментах агентов. Подготовка отличается от работающей VM. При неизвестном исходе экспорта сначала сверьте сохранённую квитанцию.', action: 'Открыть инструменты VM' },
    browser: { title: 'Browser companion: подключение и восстановление', body: 'Проверьте подключение провайдера и выбранную вкладку задачи в Browser companion. Подключение companion само не привязывает вкладку и не доказывает результат действия. При устаревшей привязке обновите наблюдение; неизвестный исход ввода сначала сверьте.', action: 'Открыть Browser companion' },
  },
};
const zhCN: WorkflowHelpCopy = {
  development: '正在运行开发应用', packaged: '正在运行打包应用',
  versionBoundary: '此版本标识当前运行的应用。源码更改不代表已安装更新；连接就绪不代表任务结果已验证。',
  guides: {
    native: { title: 'Native 账户和模型连接', body: '在 Native 中检查选定账户、身份验证和模型目录。已保存的配置或登录窗口不代表账户已连接。重试结果不确定的轮次前，请先检查保留的回执。', action: '打开 Native 连接' },
    vm: { title: 'VM 环境、shell 和导出', body: '在代理工具中检查准备的环境和准确的任务绑定。环境已准备不代表 VM 正在运行。导出结果未知时，请先核对保存的回执。', action: '打开 VM 工具' },
    browser: { title: '浏览器伴侣连接和恢复', body: '在浏览器伴侣中检查提供商连接和选定的任务标签页。伴侣已连接不代表标签页已绑定或操作结果已验证。绑定过期后刷新观察；重试输入前先核对未知结果。', action: '打开浏览器伴侣' },
  },
};
const zhTW: WorkflowHelpCopy = {
  development: '正在執行開發應用程式', packaged: '正在執行封裝應用程式',
  versionBoundary: '此版本識別目前執行的應用程式。原始碼變更不代表已安裝更新；連線就緒不代表工作結果已驗證。',
  guides: {
    native: { title: 'Native 帳號與模型連線', body: '在 Native 中檢查選定帳號、驗證和模型目錄。已儲存設定或登入視窗不代表帳號已連線。重試結果不確定的回合前，請先檢查保留的回執。', action: '開啟 Native 連線' },
    vm: { title: 'VM 環境、shell 與匯出', body: '在代理工具中檢查準備的環境和精確的工作繫結。環境已準備不代表 VM 正在執行。匯出結果未知時，請先核對儲存的回執。', action: '開啟 VM 工具' },
    browser: { title: '瀏覽器伴侶連線與復原', body: '在瀏覽器伴侶中檢查供應者連線與選定的工作分頁。伴侶已連線不代表分頁已繫結或動作結果已驗證。繫結過期後重新觀察；重試輸入前先核對未知結果。', action: '開啟瀏覽器伴侶' },
  },
};
const ja: WorkflowHelpCopy = {
  development: '開発アプリを実行中', packaged: 'パッケージ版アプリを実行中',
  versionBoundary: '現在実行中のアプリのバージョンです。ソースの変更は更新のインストールを、接続の準備完了はタスクの結果を証明しません。',
  guides: {
    native: { title: 'Native アカウントとモデルの接続', body: 'Native で選択したアカウント、認証、モデル一覧を確認してください。保存済みプロファイルやログイン画面だけでは接続を確認できません。不明なターンを再試行する前に保存済みの記録を確認してください。', action: 'Native 接続を開く' },
    vm: { title: 'VM 環境、shell、エクスポート', body: 'エージェントツールで準備済み環境と正確なタスクの関連付けを確認します。準備完了は VM の実行中とは別です。エクスポート結果が不明な場合は先に保存済みの記録を照合してください。', action: 'VM ツールを開く' },
    browser: { title: 'ブラウザー連携の接続と復旧', body: 'ブラウザー連携でプロバイダーの接続と選択したタスクタブを確認します。接続だけではタブの関連付けや操作結果を確認できません。古い関連付けでは観察を更新し、不明な入力結果は再試行前に照合してください。', action: 'ブラウザー連携を開く' },
  },
};
const ko: WorkflowHelpCopy = {
  development: '개발 앱 실행 중', packaged: '패키지 앱 실행 중',
  versionBoundary: '현재 실행 중인 앱 버전입니다. 소스 변경은 업데이트 설치를, 연결 준비는 작업 결과를 확인하지 않습니다.',
  guides: {
    native: { title: 'Native 계정 및 모델 연결', body: 'Native에서 선택한 계정, 인증 및 모델 목록을 확인하세요. 저장된 프로필이나 로그인 창만으로 연결을 확인할 수 없습니다. 결과가 불확실한 턴을 재시도하기 전에 저장된 수신 기록을 확인하세요.', action: 'Native 연결 열기' },
    vm: { title: 'VM 환경, shell 및 내보내기', body: '에이전트 도구에서 준비된 환경과 정확한 작업 연결을 확인하세요. 환경 준비와 VM 실행은 별개입니다. 내보내기 결과를 모르면 먼저 저장된 기록을 대조하세요.', action: 'VM 도구 열기' },
    browser: { title: '브라우저 연결 및 복구', body: '브라우저 연결 화면에서 제공자 연결과 선택한 작업 탭을 확인하세요. 연결만으로 탭 연결이나 작업 결과를 확인할 수 없습니다. 오래된 연결은 관찰을 갱신하고 불확실한 입력은 재시도 전에 대조하세요.', action: '브라우저 연결 열기' },
  },
};
export const workflowHelpCopy = (language: Language): WorkflowHelpCopy => ({ en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko })[language] ?? en;
