import type { AccountPoolSnapshot, AccountTunnelView, BrowserInteractionMode, BrowserState, Language } from './types';

type Account = AccountPoolSnapshot['accounts'][number];
export function accountTunnelFor(account: Account | null | undefined, mode: BrowserInteractionMode): AccountTunnelView | null {
  const view = account?.tunnels?.[mode];
  return view && view.accountId === account?.id && view.interactionMode === mode ? view : null;
}

export function accountToolsStep(account: Account, runtimeConfigured: boolean) {
  if (account.authenticationStatus === 'unavailable') return 'verification';
  if (account.authenticationStatus === 'unknown') return 'checking';
  if (!account.authenticated || (account.authenticationStatus && account.authenticationStatus !== 'verified')) return 'sign-in';
  if (!runtimeConfigured) return 'runtime';
  return account.checked && account.connectorReady ? 'verified' : 'connector';
}

// The browser view and pool read must refer to the same currently authenticated account.
// A global tunnel/doctor result cannot finish another account's connector onboarding.
export function accountToolsHandoffAccount(browser: BrowserState, pool: AccountPoolSnapshot): Account | null {
  if (!browser.accountId || !browser.authenticated
    || (browser.authenticationStatus && browser.authenticationStatus !== 'verified')
    || browser.loginInProgress || pool.selectedId !== browser.accountId) return null;
  const account = pool.accounts.find(candidate => candidate.id === browser.accountId);
  if (!account || accountToolsStep(account, accountTunnelFor(account, 'automatic')?.ready === true) !== 'connector') return null;
  return account;
}

const en = {
  automaticMode: 'Automatic', manualMode: 'Manual', savedTunnel: 'This account has saved tunnel credentials for this mode.', reuseSavedTunnel: 'Reconnect this account’s tunnel',
  target: 'Account being configured',
  title: 'Account tools setup',
  verification: 'Verify this account’s session before continuing tools setup. An unavailable check does not mean you are signed out.',
  signIn: 'Sign in to ChatGPT to continue this account’s setup.',
  runtime: 'Next: configure this account’s own tunnel.',
  connector: 'Next: connect and verify tools for this account.',
  verified: 'This account’s connector is verified. This does not confirm a tool execution.',
  verifiedExecuted: 'This account’s connector is verified. Last real tool run: {tool}, {time}.',
  continue: 'Continue account setup',
  sharedTunnel: 'Each account needs its own tunnel for this interaction mode. Create it in this account’s OpenAI Platform organization, then save its Tunnel ID and runtime key here.',
  identity: "Tunnels and API keys open in this account’s own NEKODEX window. Check the OpenAI organization and workspace there before changing access. ChatGPT connector pages use the same account’s browser session.",
  instructions: 'In that ChatGPT account/workspace, enable developer mode and connect the accessible tunnel using the connector name below. The runtime key needs Tunnels Read + Use. Return here to verify this exact account.',
  setup: 'Set up this account’s tunnel',
  back: 'Return to account setup',
  manual: 'Automatic account verification is unavailable in Manual mode. Use the tools setup guide to configure the connection.',
  keyInstructions: 'Create a Restricted API key with only Tunnels Read + Use for the accessible tunnel. Enter its ID and runtime key in the next step.', googleFallback: "If Google says this browser or app may not be secure, continue in your regular browser: NEKODEX hands the page over automatically when Google refuses this window. Sign in there with the OpenAI organization meant for {account}. This setup stays on {account} while you are away.", openTunnelsExternal: "Tunnels in my browser", openKeysExternal: "API keys in my browser", returned: "Back from OpenAI? Enter the Tunnel ID and runtime key you created for {account}.",
  tunnelTitle: 'Set up this account’s tunnel and API key',
  tunnelStatus: 'Tunnel status', configuredTunnel: 'Tunnel ID', removeTunnel: 'Remove this account’s tunnel',
  tunnelUnconfigured: 'No tunnel configured for this account', tunnelStarting: 'Starting', tunnelReady: 'Ready',
  tunnelStopped: 'Stopped', tunnelError: 'Error', tunnelUnknown: 'Status unknown',
};
type AccountToolsCopy = { [K in keyof typeof en]: string };
const ru: AccountToolsCopy = {
  automaticMode: 'Автоматический', manualMode: 'Ручной', savedTunnel: 'Для этого аккаунта и режима сохранены данные туннеля.', reuseSavedTunnel: 'Переподключить туннель аккаунта',
  tunnelStatus: 'Состояние туннеля', configuredTunnel: 'ID туннеля', removeTunnel: 'Удалить туннель этого аккаунта', tunnelUnconfigured: 'Туннель аккаунта не настроен', tunnelStarting: 'Запуск', tunnelReady: 'Готов', tunnelStopped: 'Остановлен', tunnelError: 'Ошибка', tunnelUnknown: 'Состояние неизвестно',
  target: 'Настраиваемый аккаунт',
  title: 'Настройка инструментов аккаунта',
  verification: 'Повторите проверку сессии перед настройкой инструментов. Недоступная проверка не означает выход из аккаунта.',
  signIn: 'Войдите в ChatGPT, чтобы продолжить настройку этого аккаунта.',
  runtime: 'Следующий шаг: настройте отдельный туннель этого аккаунта.',
  connector: 'Следующий шаг: подключите и проверьте инструменты этого аккаунта.',
  verified: 'Коннектор этого аккаунта проверен. Это ещё не подтверждает выполнение инструмента.',
  verifiedExecuted: 'Коннектор этого аккаунта проверен. Последний реальный запуск инструмента: {tool}, {time}.',
  continue: 'Продолжить настройку аккаунта',
  sharedTunnel: 'Для каждого аккаунта нужен отдельный туннель в этом режиме. Создайте его в организации OpenAI Platform этого аккаунта и сохраните здесь ID туннеля и ключ.',
  identity: "Туннели и API-ключи открываются в отдельном окне NEKODEX этого аккаунта. Перед изменением доступа проверьте организацию и workspace OpenAI. Страницы коннектора ChatGPT используют ту же браузерную сессию аккаунта.",
  instructions: 'В этом аккаунте и рабочем пространстве ChatGPT включите режим разработчика и подключите доступный туннель с именем коннектора ниже. Ключу туннеля нужны права Tunnels Read + Use. Затем вернитесь и проверьте именно этот аккаунт.',
  setup: 'Настроить туннель этого аккаунта',
  back: 'Вернуться к настройке аккаунта',
  manual: 'Автоматическая проверка аккаунта недоступна в ручном режиме. Настройте подключение по инструкции для инструментов.',
  keyInstructions: 'Создайте API-ключ Restricted только с правами Tunnels Read + Use для доступного туннеля. На следующем шаге введите его ID и ключ.', googleFallback: "Если Google сообщает, что браузер или приложение могут быть небезопасны, продолжите в обычном браузере: NEKODEX сам передаст туда страницу, когда Google откажет этому окну. Войдите там в организацию OpenAI, предназначенную для {account}. Пока вы там, настройка остаётся привязанной к {account}.", openTunnelsExternal: "Туннели в моём браузере", openKeysExternal: "API-ключи в моём браузере", returned: "Вернулись из OpenAI? Введите ID туннеля и ключ, созданные для {account}.",
  tunnelTitle: 'Настройте туннель и API-ключ этого аккаунта',
};
const zhCN: AccountToolsCopy = {
  automaticMode: '自动', manualMode: '手动', savedTunnel: '此账户已保存该模式的隧道凭据。', reuseSavedTunnel: '重新连接此账户的隧道',
  tunnelStatus: '隧道状态', configuredTunnel: '隧道 ID', removeTunnel: '移除此账户的隧道', tunnelUnconfigured: '此账户未配置隧道', tunnelStarting: '正在启动', tunnelReady: '已就绪', tunnelStopped: '已停止', tunnelError: '错误', tunnelUnknown: '状态未知',
  target: '正在设置的账户',
  verification: '请先验证此账户的会话，再继续设置工具。无法检查不代表已退出登录。',
  title: '账户工具设置', signIn: '登录 ChatGPT 以继续设置此账户。', runtime: '下一步：配置此账户的专属隧道。',
  connector: '下一步：为此账户连接并验证工具。', verified: '已验证此账户的连接器，但这并不代表已执行工具。', verifiedExecuted: '已验证此账户的连接器。最近一次真实工具运行：{tool}，{time}。', continue: '继续账户设置',
  sharedTunnel: '每个账户在此模式下都需要自己的隧道。请在该账户的 OpenAI Platform 组织中创建隧道，并在此保存隧道 ID 和运行时密钥。',
  identity: "隧道和 API 密钥在此账户自己的 NEKODEX 窗口中打开。更改访问权限前，请核对 OpenAI 组织和工作区。ChatGPT 连接器页面使用同一账户的浏览器会话。",
  instructions: '在该 ChatGPT 账户和工作区启用开发者模式，使用下方连接器名称连接可访问的隧道。运行时密钥需要 Tunnels Read + Use 权限。然后返回验证此账户。',
  setup: '设置此账户的隧道', back: '返回账户设置', manual: '手动模式无法自动验证账户。请使用工具设置指南配置连接。', keyInstructions: '为可访问的隧道创建仅有 Tunnels Read + Use 权限的 Restricted API 密钥。在下一步输入隧道 ID 和密钥。', googleFallback: "如果 Google 提示此浏览器或应用可能不安全，请改用常用浏览器继续：Google 拒绝此窗口时，NEKODEX 会自动将页面转到常用浏览器。请在那里登录为 {account} 准备的 OpenAI 组织。离开期间，此设置仍绑定在 {account}。", openTunnelsExternal: "在我的浏览器中打开隧道", openKeysExternal: "在我的浏览器中打开 API 密钥", returned: "从 OpenAI 返回了？请输入为 {account} 创建的隧道 ID 和运行时密钥。", tunnelTitle: '设置此账户的隧道和 API 密钥',
};
const zhTW: AccountToolsCopy = {
  automaticMode: '自動', manualMode: '手動', savedTunnel: '此帳號已儲存此模式的通道憑證。', reuseSavedTunnel: '重新連接此帳號的通道',
  tunnelStatus: '通道狀態', configuredTunnel: '通道 ID', removeTunnel: '移除此帳號的通道', tunnelUnconfigured: '此帳號尚未設定通道', tunnelStarting: '正在啟動', tunnelReady: '已就緒', tunnelStopped: '已停止', tunnelError: '錯誤', tunnelUnknown: '狀態未知',
  target: '正在設定的帳號',
  verification: '請先驗證此帳號的工作階段，再繼續設定工具。無法檢查不代表已登出。',
  title: '帳號工具設定', signIn: '登入 ChatGPT 以繼續設定此帳號。', runtime: '下一步：設定此帳號的專屬通道。',
  connector: '下一步：為此帳號連接並驗證工具。', verified: '已驗證此帳號的連接器，但這不代表已執行工具。', verifiedExecuted: '已驗證此帳號的連接器。最近一次真實工具執行：{tool}，{time}。', continue: '繼續帳號設定',
  sharedTunnel: '每個帳號在此模式下都需要自己的通道。請在該帳號的 OpenAI Platform 組織建立通道，並在此儲存通道 ID 和執行金鑰。',
  identity: "通道與 API 金鑰會在此帳戶自己的 NEKODEX 視窗中開啟。變更存取權限前，請確認 OpenAI 組織與工作區。ChatGPT 連接器頁面使用同一帳戶的瀏覽器工作階段。",
  instructions: '在該 ChatGPT 帳號和工作區啟用開發者模式，使用下方連接器名稱連接可存取的通道。執行環境金鑰需要 Tunnels Read + Use 權限。然後返回驗證此帳號。',
  setup: '設定此帳號的通道', back: '返回帳號設定', manual: '手動模式無法自動驗證帳號。請使用工具設定指南設定連線。', keyInstructions: '為可存取的通道建立僅有 Tunnels Read + Use 權限的 Restricted API 金鑰。在下一步輸入通道 ID 和金鑰。', googleFallback: "如果 Google 提示此瀏覽器或應用程式可能不安全，請改用常用瀏覽器繼續：Google 拒絕此視窗時，NEKODEX 會自動將頁面轉到常用瀏覽器。請在那裡登入為 {account} 準備的 OpenAI 組織。離開期間，此設定仍綁定在 {account}。", openTunnelsExternal: "在我的瀏覽器中開啟通道", openKeysExternal: "在我的瀏覽器中開啟 API 金鑰", returned: "從 OpenAI 回來了？請輸入為 {account} 建立的通道 ID 和執行階段金鑰。", tunnelTitle: '設定此帳號的通道和 API 金鑰',
};
const ja: AccountToolsCopy = {
  automaticMode: '自動', manualMode: '手動', savedTunnel: 'このアカウントのこのモード用のトンネル認証情報が保存されています。', reuseSavedTunnel: 'このアカウントのトンネルを再接続',
  tunnelStatus: 'トンネルの状態', configuredTunnel: 'トンネル ID', removeTunnel: 'このアカウントのトンネルを削除', tunnelUnconfigured: 'このアカウントのトンネルは未設定', tunnelStarting: '起動中', tunnelReady: '準備完了', tunnelStopped: '停止', tunnelError: 'エラー', tunnelUnknown: '状態不明',
  target: '設定対象のアカウント',
  verification: 'ツール設定を続ける前にセッションを再確認してください。確認できない状態はログアウトを意味しません。',
  title: 'アカウントのツール設定', signIn: 'ChatGPT にサインインして、このアカウントの設定を続けてください。', runtime: '次の手順：このアカウント専用のトンネルを設定します。',
  connector: '次の手順：このアカウントのツールを接続して検証します。', verified: 'このアカウントのコネクターを検証しました。ツールの実行を確認したものではありません。', verifiedExecuted: 'このアカウントのコネクターを検証しました。最後の実際のツール実行：{tool}、{time}。', continue: 'アカウント設定を続ける',
  sharedTunnel: '各アカウントには、このモード専用のトンネルが必要です。このアカウントの OpenAI Platform 組織で作成し、トンネル ID と実行用キーをここに保存してください。',
  identity: "トンネルと API キーはこのアカウント専用の NEKODEX ウィンドウで開きます。アクセスを変更する前に OpenAI の組織とワークスペースを確認してください。ChatGPT コネクタも同じブラウザーセッションを使用します。",
  instructions: '該当する ChatGPT アカウントとワークスペースで開発者モードを有効にし、下記のコネクター名で利用可能なトンネルに接続します。実行用キーには Tunnels Read + Use 権限が必要です。その後ここでこのアカウントを検証します。',
  setup: 'このアカウントのトンネルを設定', back: 'アカウント設定に戻る', manual: '手動モードではアカウントを自動検証できません。ツール設定ガイドで接続を設定してください。', keyInstructions: '利用可能なトンネル用に Tunnels Read + Use のみを許可した Restricted API キーを作成します。次の手順でトンネル ID とキーを入力します。', googleFallback: "Google が「このブラウザーまたはアプリは安全でない可能性があります」と表示した場合は、普段のブラウザーで続けてください。Google がこのウィンドウを拒否すると、NEKODEX がページを自動的に引き渡します。そこで {account} 用の OpenAI 組織にサインインしてください。離れている間も、この設定は {account} に紐づいたままです。", openTunnelsExternal: "普段のブラウザーでトンネルを開く", openKeysExternal: "普段のブラウザーで API キーを開く", returned: "OpenAI から戻りましたか？ {account} 用に作成したトンネル ID とランタイムキーを入力してください。", tunnelTitle: 'このアカウントのトンネルと API キーを設定',
};
const ko: AccountToolsCopy = {
  automaticMode: '자동', manualMode: '수동', savedTunnel: '이 계정의 이 모드에 터널 인증 정보가 저장되어 있습니다.', reuseSavedTunnel: '이 계정의 터널 다시 연결',
  tunnelStatus: '터널 상태', configuredTunnel: '터널 ID', removeTunnel: '이 계정의 터널 제거', tunnelUnconfigured: '이 계정에 설정된 터널 없음', tunnelStarting: '시작 중', tunnelReady: '준비됨', tunnelStopped: '중지됨', tunnelError: '오류', tunnelUnknown: '상태 알 수 없음',
  target: '설정 중인 계정',
  verification: '도구 설정을 계속하기 전에 계정 세션을 다시 확인하세요. 확인할 수 없다고 해서 로그아웃된 것은 아닙니다.',
  title: '계정 도구 설정', signIn: 'ChatGPT에 로그인하여 이 계정의 설정을 계속하세요.', runtime: '다음 단계: 이 계정 전용 터널을 설정하세요.',
  connector: '다음 단계: 이 계정의 도구를 연결하고 확인하세요.', verified: '이 계정의 커넥터를 확인했습니다. 도구 실행을 확인한 것은 아닙니다.', verifiedExecuted: '이 계정의 커넥터를 확인했습니다. 마지막 실제 도구 실행: {tool}, {time}.', continue: '계정 설정 계속',
  sharedTunnel: '각 계정에는 이 모드 전용 터널이 필요합니다. 이 계정의 OpenAI Platform 조직에서 터널을 만들고 터널 ID와 런타임 키를 여기에 저장하세요.',
  identity: "터널과 API 키는 이 계정 전용 NEKODEX 창에서 열립니다. 접근 권한을 바꾸기 전에 OpenAI 조직과 워크스페이스를 확인하세요. ChatGPT 커넥터 페이지도 같은 계정의 브라우저 세션을 사용합니다.",
  instructions: '해당 ChatGPT 계정과 워크스페이스에서 개발자 모드를 켜고 아래 커넥터 이름으로 접근 가능한 터널을 연결하세요. 런타임 키에는 Tunnels Read + Use 권한이 필요합니다. 그런 다음 돌아와 이 계정을 확인하세요.',
  setup: '이 계정의 터널 설정', back: '계정 설정으로 돌아가기', manual: '수동 모드에서는 계정을 자동으로 확인할 수 없습니다. 도구 설정 가이드로 연결을 설정하세요.', keyInstructions: '접근 가능한 터널용으로 Tunnels Read + Use 권한만 있는 Restricted API 키를 만드세요. 다음 단계에서 터널 ID와 키를 입력하세요.', googleFallback: "Google에서 이 브라우저나 앱이 안전하지 않을 수 있다고 표시하면 평소 쓰는 브라우저에서 계속하세요. Google이 이 창을 거부하면 NEKODEX가 페이지를 자동으로 넘겨 줍니다. 그곳에서 {account}용 OpenAI 조직으로 로그인하세요. 다른 브라우저에 있는 동안에도 이 설정은 {account}에 연결된 상태로 유지됩니다.", openTunnelsExternal: "내 브라우저에서 터널 열기", openKeysExternal: "내 브라우저에서 API 키 열기", returned: "OpenAI에서 돌아오셨나요? {account}용으로 만든 터널 ID와 런타임 키를 입력하세요.", tunnelTitle: '이 계정의 터널 및 API 키 설정',
};
export function accountToolsCopy(language: Language): AccountToolsCopy {
  return ({ en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko })[language] ?? en;
}
