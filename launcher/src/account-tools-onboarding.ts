import type { AccountPoolSnapshot, BrowserState, Language } from './types';

type Account = AccountPoolSnapshot['accounts'][number];
export function accountToolsStep(account: Account, runtimeConfigured: boolean) {
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
  if (!account || accountToolsStep(account, true) !== 'connector') return null;
  return account;
}

const en = {
  target: 'Account being configured',
  title: 'Account tools setup',
  signIn: 'Sign in to ChatGPT to continue this account’s setup.',
  runtime: 'Next: configure the shared tunnel runtime.',
  connector: 'Next: connect and verify tools for this account.',
  verified: 'This account’s connector is verified. This does not confirm a tool execution.',
  continue: 'Continue account setup',
  sharedTunnel: 'A new account does not always need a new tunnel. Reuse an existing tunnel accessible to its ChatGPT workspace or personal organization. If access is missing, associate the organization/workspace in OpenAI Platform where permitted, or create a tunnel. The saved runtime is shared for this interaction mode; replacing its credentials affects other accounts using it.',
  identity: 'These links open your system browser, which may be signed in to a different account. Check the ChatGPT identity and workspace against the account shown here before changing settings.',
  instructions: 'In that ChatGPT account/workspace, enable developer mode and connect the accessible tunnel using the connector name below. The runtime key needs Tunnels Read + Use. Return here to verify this exact account.',
  setup: 'Open shared tunnel setup',
  back: 'Return to account setup',
  manual: 'Automatic account verification is unavailable in Manual mode. Use the tools setup guide to configure the connection.',
  keyInstructions: 'Create a Restricted API key with only Tunnels Read + Use for the accessible tunnel. Enter its ID and runtime key in the next step.',
  tunnelTitle: 'Choose an accessible tunnel and API key',
};
type AccountToolsCopy = { [K in keyof typeof en]: string };
const ru: AccountToolsCopy = {
  target: 'Настраиваемый аккаунт',
  title: 'Настройка инструментов аккаунта',
  signIn: 'Войдите в ChatGPT, чтобы продолжить настройку этого аккаунта.',
  runtime: 'Следующий шаг: настройте общий туннель.',
  connector: 'Следующий шаг: подключите и проверьте инструменты этого аккаунта.',
  verified: 'Коннектор этого аккаунта проверен. Это ещё не подтверждает выполнение инструмента.',
  continue: 'Продолжить настройку аккаунта',
  sharedTunnel: 'Новому аккаунту не всегда нужен новый туннель. Используйте существующий туннель, доступный его рабочему пространству ChatGPT или личной организации. Если доступа нет, добавьте организацию или пространство в OpenAI Platform, когда это разрешено, либо создайте туннель. Сохранённый туннель общий для этого режима работы; замена его данных затронет другие использующие его аккаунты.',
  identity: 'Ссылки откроются в системном браузере, где может быть выполнен вход в другой аккаунт. Перед изменением настроек сверьте аккаунт и рабочее пространство ChatGPT с указанными здесь.',
  instructions: 'В этом аккаунте и рабочем пространстве ChatGPT включите режим разработчика и подключите доступный туннель с именем коннектора ниже. Ключу туннеля нужны права Tunnels Read + Use. Затем вернитесь и проверьте именно этот аккаунт.',
  setup: 'Открыть настройку общего туннеля',
  back: 'Вернуться к настройке аккаунта',
  manual: 'Автоматическая проверка аккаунта недоступна в ручном режиме. Настройте подключение по инструкции для инструментов.',
  keyInstructions: 'Создайте API-ключ Restricted только с правами Tunnels Read + Use для доступного туннеля. На следующем шаге введите его ID и ключ.',
  tunnelTitle: 'Выберите доступный туннель и API-ключ',
};
const zhCN: AccountToolsCopy = {
  target: '正在设置的账户',
  title: '账户工具设置', signIn: '登录 ChatGPT 以继续设置此账户。', runtime: '下一步：配置共享隧道运行时。',
  connector: '下一步：为此账户连接并验证工具。', verified: '已验证此账户的连接器，但这并不代表已执行工具。', continue: '继续账户设置',
  sharedTunnel: '新账户不一定需要新隧道。可复用其 ChatGPT 工作区或个人组织有权访问的隧道。如果没有权限，请在允许的情况下于 OpenAI Platform 关联组织或工作区，或创建隧道。此交互模式共用已保存的运行时，替换凭据会影响使用它的其他账户。',
  identity: '链接将在系统浏览器中打开，该浏览器可能登录了其他账户。更改设置前，请核对 ChatGPT 身份和工作区是否与此处账户一致。',
  instructions: '在该 ChatGPT 账户和工作区启用开发者模式，使用下方连接器名称连接可访问的隧道。运行时密钥需要 Tunnels Read + Use 权限。然后返回验证此账户。',
  setup: '打开共享隧道设置', back: '返回账户设置', manual: '手动模式无法自动验证账户。请使用工具设置指南配置连接。', keyInstructions: '为可访问的隧道创建仅有 Tunnels Read + Use 权限的 Restricted API 密钥。在下一步输入隧道 ID 和密钥。', tunnelTitle: '选择可访问的隧道和 API 密钥',
};
const zhTW: AccountToolsCopy = {
  target: '正在設定的帳號',
  title: '帳號工具設定', signIn: '登入 ChatGPT 以繼續設定此帳號。', runtime: '下一步：設定共用通道執行環境。',
  connector: '下一步：為此帳號連接並驗證工具。', verified: '已驗證此帳號的連接器，但這不代表已執行工具。', continue: '繼續帳號設定',
  sharedTunnel: '新帳號不一定需要新通道。可重用其 ChatGPT 工作區或個人組織有權存取的通道。若沒有權限，請在允許時於 OpenAI Platform 關聯組織或工作區，或建立通道。此互動模式共用已儲存的執行環境，替換憑證會影響使用它的其他帳號。',
  identity: '連結會在系統瀏覽器開啟，該瀏覽器可能登入了其他帳號。變更設定前，請核對 ChatGPT 身分與工作區是否與此處帳號一致。',
  instructions: '在該 ChatGPT 帳號和工作區啟用開發者模式，使用下方連接器名稱連接可存取的通道。執行環境金鑰需要 Tunnels Read + Use 權限。然後返回驗證此帳號。',
  setup: '開啟共用通道設定', back: '返回帳號設定', manual: '手動模式無法自動驗證帳號。請使用工具設定指南設定連線。', keyInstructions: '為可存取的通道建立僅有 Tunnels Read + Use 權限的 Restricted API 金鑰。在下一步輸入通道 ID 和金鑰。', tunnelTitle: '選擇可存取的通道和 API 金鑰',
};
const ja: AccountToolsCopy = {
  target: '設定対象のアカウント',
  title: 'アカウントのツール設定', signIn: 'ChatGPT にサインインして、このアカウントの設定を続けてください。', runtime: '次の手順：共有トンネルの実行環境を設定します。',
  connector: '次の手順：このアカウントのツールを接続して検証します。', verified: 'このアカウントのコネクターを検証しました。ツールの実行を確認したものではありません。', continue: 'アカウント設定を続ける',
  sharedTunnel: '新しいアカウントでも新規トンネルが必要とは限りません。ChatGPT ワークスペースまたは個人組織から利用できる既存トンネルを再利用できます。アクセスできない場合は、許可されていれば OpenAI Platform で組織やワークスペースを関連付けるか、トンネルを作成します。この操作モードでは保存済みの実行環境を共有するため、認証情報の置換は他の利用アカウントにも影響します。',
  identity: 'リンクはシステムブラウザーで開きます。別のアカウントでサインインしている場合があるため、設定変更前に ChatGPT のアカウントとワークスペースを確認してください。',
  instructions: '該当する ChatGPT アカウントとワークスペースで開発者モードを有効にし、下記のコネクター名で利用可能なトンネルに接続します。実行用キーには Tunnels Read + Use 権限が必要です。その後ここでこのアカウントを検証します。',
  setup: '共有トンネル設定を開く', back: 'アカウント設定に戻る', manual: '手動モードではアカウントを自動検証できません。ツール設定ガイドで接続を設定してください。', keyInstructions: '利用可能なトンネル用に Tunnels Read + Use のみを許可した Restricted API キーを作成します。次の手順でトンネル ID とキーを入力します。', tunnelTitle: '利用可能なトンネルと API キーを選択',
};
const ko: AccountToolsCopy = {
  target: '설정 중인 계정',
  title: '계정 도구 설정', signIn: 'ChatGPT에 로그인하여 이 계정의 설정을 계속하세요.', runtime: '다음 단계: 공유 터널 런타임을 설정하세요.',
  connector: '다음 단계: 이 계정의 도구를 연결하고 확인하세요.', verified: '이 계정의 커넥터를 확인했습니다. 도구 실행을 확인한 것은 아닙니다.', continue: '계정 설정 계속',
  sharedTunnel: '새 계정에 항상 새 터널이 필요한 것은 아닙니다. 해당 ChatGPT 워크스페이스나 개인 조직에서 접근 가능한 기존 터널을 재사용하세요. 접근 권한이 없으면 허용되는 경우 OpenAI Platform에서 조직이나 워크스페이스를 연결하거나 터널을 만드세요. 이 상호작용 모드에서는 저장된 런타임을 공유하므로 자격 증명을 교체하면 이를 사용하는 다른 계정에도 영향을 줍니다.',
  identity: '링크는 시스템 브라우저에서 열리며 다른 계정으로 로그인되어 있을 수 있습니다. 설정을 변경하기 전에 ChatGPT 계정과 워크스페이스가 여기에 표시된 계정과 일치하는지 확인하세요.',
  instructions: '해당 ChatGPT 계정과 워크스페이스에서 개발자 모드를 켜고 아래 커넥터 이름으로 접근 가능한 터널을 연결하세요. 런타임 키에는 Tunnels Read + Use 권한이 필요합니다. 그런 다음 돌아와 이 계정을 확인하세요.',
  setup: '공유 터널 설정 열기', back: '계정 설정으로 돌아가기', manual: '수동 모드에서는 계정을 자동으로 확인할 수 없습니다. 도구 설정 가이드로 연결을 설정하세요.', keyInstructions: '접근 가능한 터널용으로 Tunnels Read + Use 권한만 있는 Restricted API 키를 만드세요. 다음 단계에서 터널 ID와 키를 입력하세요.', tunnelTitle: '접근 가능한 터널 및 API 키 선택',
};
export function accountToolsCopy(language: Language): AccountToolsCopy {
  return ({ en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko })[language] ?? en;
}
