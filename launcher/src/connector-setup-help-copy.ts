import type { Language } from './types';

export type ConnectorHelpTopic = 'platform' | 'tunnel' | 'key' | 'developer' | 'connector';
type Guide = { title: string; steps: readonly string[]; labels: readonly [string, string, string] };
type HelpCopy = {
  show: string; title: string; close: string; topics: string; illustration: string; proof: string;
  guides: Record<ConnectorHelpTopic, Guide>;
};
const en: HelpCopy = {
  show: 'Show where', title: 'Connector setup guide', close: 'Back to setup', topics: 'Setup topics',
  illustration: 'Schematic illustration, not a provider screenshot. Page labels and availability may vary.',
  proof: 'Reading this guide changes no settings. Return to setup to connect and check this account; only a real successful tool run confirms execution.',
  guides: {
    platform: { title: 'Choose the right Platform organization', labels: ['This account', 'OpenAI Platform', 'ChatGPT workspace'], steps: ['Open OpenAI API using the account button below. Check the signed-in identity and the Platform organization before creating anything.', 'Use the organization associated with this account’s intended ChatGPT workspace. If it is missing, ask the workspace administrator for access; do not substitute another account’s tunnel.'] },
    tunnel: { title: 'Create a dedicated tunnel', labels: ['Platform organization', 'Dedicated tunnel', 'This account + mode'], steps: ['In Platform Tunnels, create a tunnel for the intended organization and ChatGPT workspace. Keep its tunnel ID for the credentials step in NEKODEX.', 'Each account and interaction mode needs its own tunnel binding. Enter the tunnel ID and runtime key in this account’s setup, then use Connect.'] },
    key: { title: 'Give the runtime key tunnel permissions', labels: ['Restricted API key', 'Tunnels: Read + Use', 'NEKODEX runtime'], steps: ['Open API keys in the same Platform organization. Create a Restricted key that allows only Tunnels Read + Use for the intended tunnel.', 'Copy the key directly into the password field in NEKODEX. This is the tunnel runtime key, not a model API key. Never include the key in screenshots or support messages.'] },
    developer: { title: 'Find developer access in ChatGPT', labels: ['This ChatGPT account', 'Workspace controls', 'Custom connector access'], steps: ['Use the ChatGPT developer-mode button below, if available, in this account’s own browser session. Check the intended workspace.', 'If ChatGPT exposes a Developer mode control for this workspace, enable it as required by the setup instructions. Controls can vary or be unavailable; ask the workspace administrator if custom connector access is blocked.'] },
    connector: { title: 'Attach the exact connector', labels: ['This account’s tunnel', 'Exact connector name', 'Check this account'], steps: ['Open ChatGPT connectors for this account and workspace. Connect the tunnel configured for this account and mode, using the exact connector name shown in NEKODEX.', 'Return to NEKODEX and check the connector for this account. A visible connector or a ready tunnel alone does not confirm that a tool has executed.'] },
  },
};
const ru: HelpCopy = {
  show: 'Показать где', title: 'Помощь с настройкой коннектора', close: 'Вернуться к настройке', topics: 'Темы настройки',
  illustration: 'Схема, а не снимок интерфейса сервиса. Названия и доступность элементов могут отличаться.',
  proof: 'Просмотр справки не меняет настройки. Вернитесь и подключите и проверьте этот аккаунт. Выполнение подтверждает только реальный успешный запуск инструмента.',
  guides: {
    platform: { title: 'Выберите нужную организацию Platform', labels: ['Этот аккаунт', 'OpenAI Platform', 'Рабочее пространство ChatGPT'], steps: ['Откройте OpenAI API кнопкой этого аккаунта ниже. Перед созданием чего-либо проверьте, кто вошёл в систему, и организацию Platform.', 'Используйте организацию рабочего пространства ChatGPT для этого аккаунта. Если её нет, запросите доступ у администратора; не подставляйте туннель другого аккаунта.'] },
    tunnel: { title: 'Создайте отдельный туннель', labels: ['Организация Platform', 'Отдельный туннель', 'Этот аккаунт и режим'], steps: ['В разделе Tunnels на Platform создайте туннель для нужной организации и рабочего пространства ChatGPT. Сохраните его ID для шага ввода данных в NEKODEX.', 'Каждому аккаунту и режиму нужна своя привязка туннеля. Введите ID и ключ в настройке этого аккаунта и нажмите «Подключить».'] },
    key: { title: 'Выдайте ключу права на туннель', labels: ['API-ключ Restricted', 'Tunnels: Read + Use', 'Среда NEKODEX'], steps: ['Откройте API keys в той же организации Platform. Создайте ключ Restricted только с правами Tunnels Read + Use для нужного туннеля.', 'Вставьте ключ прямо в поле пароля NEKODEX. Это ключ среды туннеля, а не API-ключ модели. Не включайте его в снимки экрана или сообщения поддержке.'] },
    developer: { title: 'Найдите доступ разработчика в ChatGPT', labels: ['Этот аккаунт ChatGPT', 'Настройки пространства', 'Доступ к своему коннектору'], steps: ['Используйте кнопку режима разработчика ChatGPT ниже, если она доступна: страница откроется в сессии этого аккаунта. Проверьте рабочее пространство.', 'Если для пространства есть переключатель Developer mode, включите его согласно инструкции настройки. Элементы могут отличаться или отсутствовать; если свои коннекторы недоступны, обратитесь к администратору.'] },
    connector: { title: 'Подключите именно нужный коннектор', labels: ['Туннель этого аккаунта', 'Точное имя коннектора', 'Проверка этого аккаунта'], steps: ['Откройте коннекторы ChatGPT этого аккаунта и рабочего пространства. Подключите туннель этого аккаунта и режима с точным именем коннектора, показанным в NEKODEX.', 'Вернитесь в NEKODEX и проверьте коннектор этого аккаунта. Само наличие коннектора или готового туннеля ещё не подтверждает выполнение инструмента.'] },
  },
};
const zhCN: HelpCopy = {
  show: '查看位置', title: '连接器设置指南', close: '返回设置', topics: '设置主题',
  illustration: '示意图，并非服务商界面截图。页面名称与可用功能可能有所不同。',
  proof: '查看指南不会更改设置。请返回设置，为此账户连接并验证；只有真实成功的工具运行才能确认执行。',
  guides: {
    platform: { title: '选择正确的 Platform 组织', labels: ['此账户', 'OpenAI Platform', 'ChatGPT 工作区'], steps: ['使用下方此账户的按钮打开 OpenAI API。在创建任何内容前，检查登录身份与 Platform 组织。', '使用与此账户目标 ChatGPT 工作区关联的组织。如果没有该组织，请向管理员申请权限，不要替换为其他账户的隧道。'] },
    tunnel: { title: '创建专属隧道', labels: ['Platform 组织', '专属隧道', '此账户与模式'], steps: ['在 Platform 的 Tunnels 页面，为目标组织和 ChatGPT 工作区创建隧道。保留隧道 ID，以便在 NEKODEX 输入凭据。', '每个账户和交互模式都需要独立的隧道绑定。在此账户设置中输入隧道 ID 和运行时密钥，然后点击连接。'] },
    key: { title: '授予运行时密钥隧道权限', labels: ['Restricted API 密钥', 'Tunnels: Read + Use', 'NEKODEX 运行环境'], steps: ['在同一个 Platform 组织中打开 API keys，创建仅允许目标隧道 Tunnels Read + Use 的 Restricted 密钥。', '将密钥直接粘贴到 NEKODEX 的密码字段。这是隧道运行时密钥，不是模型 API 密钥。不要把密钥放入截图或支持消息。'] },
    developer: { title: '查找 ChatGPT 开发者访问设置', labels: ['此 ChatGPT 账户', '工作区设置', '自定义连接器权限'], steps: ['如果下方有 ChatGPT 开发者模式按钮，请使用它在此账户的浏览器会话中打开页面，并检查工作区。', '如果该工作区提供 Developer mode 控件，请按设置说明启用。控件可能不同或不可用；若自定义连接器被阻止，请联系工作区管理员。'] },
    connector: { title: '连接准确的连接器', labels: ['此账户的隧道', '准确的连接器名称', '验证此账户'], steps: ['打开此账户和工作区的 ChatGPT 连接器。连接为此账户与模式配置的隧道，并使用 NEKODEX 显示的准确连接器名称。', '返回 NEKODEX 验证此账户的连接器。仅能看到连接器或隧道就绪，并不能确认工具已执行。'] },
  },
};
const zhTW: HelpCopy = {
  show: '查看位置', title: '連接器設定指南', close: '返回設定', topics: '設定主題',
  illustration: '示意圖，並非服務商介面截圖。頁面名稱與可用功能可能有所不同。',
  proof: '查看指南不會變更設定。請返回設定，為此帳號連接並驗證；只有真實成功的工具執行才能確認執行結果。',
  guides: {
    platform: { title: '選擇正確的 Platform 組織', labels: ['此帳號', 'OpenAI Platform', 'ChatGPT 工作區'], steps: ['使用下方此帳號的按鈕開啟 OpenAI API。在建立任何內容前，檢查登入身分與 Platform 組織。', '使用與此帳號目標 ChatGPT 工作區關聯的組織。如果沒有該組織，請向管理員申請權限，不要替換為其他帳號的通道。'] },
    tunnel: { title: '建立專屬通道', labels: ['Platform 組織', '專屬通道', '此帳號與模式'], steps: ['在 Platform 的 Tunnels 頁面，為目標組織和 ChatGPT 工作區建立通道。保留通道 ID，以便在 NEKODEX 輸入憑證。', '每個帳號和互動模式都需要獨立的通道繫結。在此帳號設定中輸入通道 ID 和執行階段金鑰，然後點選連接。'] },
    key: { title: '授予執行階段金鑰通道權限', labels: ['Restricted API 金鑰', 'Tunnels: Read + Use', 'NEKODEX 執行環境'], steps: ['在同一個 Platform 組織中開啟 API keys，建立僅允許目標通道 Tunnels Read + Use 的 Restricted 金鑰。', '將金鑰直接貼到 NEKODEX 的密碼欄位。這是通道執行階段金鑰，不是模型 API 金鑰。不要把金鑰放入截圖或支援訊息。'] },
    developer: { title: '尋找 ChatGPT 開發者存取設定', labels: ['此 ChatGPT 帳號', '工作區設定', '自訂連接器權限'], steps: ['如果下方有 ChatGPT 開發者模式按鈕，請使用它在此帳號的瀏覽器工作階段中開啟頁面，並檢查工作區。', '如果該工作區提供 Developer mode 控制項，請依設定說明啟用。控制項可能不同或無法使用；若自訂連接器遭封鎖，請聯絡工作區管理員。'] },
    connector: { title: '連接正確的連接器', labels: ['此帳號的通道', '正確的連接器名稱', '驗證此帳號'], steps: ['開啟此帳號和工作區的 ChatGPT 連接器。連接為此帳號與模式設定的通道，並使用 NEKODEX 顯示的確切連接器名稱。', '返回 NEKODEX 驗證此帳號的連接器。僅能看到連接器或通道就緒，並不能確認工具已執行。'] },
  },
};
const ja: HelpCopy = {
  show: '場所を確認', title: 'コネクター設定ガイド', close: '設定に戻る', topics: '設定の項目',
  illustration: '模式図です。サービスの画面キャプチャではありません。画面の名称や利用できる機能は異なる場合があります。',
  proof: 'ガイドを見ても設定は変わりません。設定に戻ってこのアカウントを接続・検証してください。実行の確認には、実際のツールの成功が必要です。',
  guides: {
    platform: { title: '正しい Platform 組織を選ぶ', labels: ['このアカウント', 'OpenAI Platform', 'ChatGPT ワークスペース'], steps: ['下のこのアカウント用ボタンから OpenAI API を開きます。作成前にサインイン中のユーザーと Platform 組織を確認してください。', 'このアカウントの対象 ChatGPT ワークスペースに対応する組織を使います。見つからない場合は管理者にアクセスを依頼し、別のアカウントのトンネルで代用しないでください。'] },
    tunnel: { title: '専用トンネルを作る', labels: ['Platform 組織', '専用トンネル', 'このアカウントとモード'], steps: ['Platform の Tunnels で、対象の組織と ChatGPT ワークスペース用にトンネルを作成します。NEKODEX の認証情報の手順で使うトンネル ID を控えてください。', 'アカウントと操作モードごとに専用のトンネル設定が必要です。このアカウントの設定に ID と実行用キーを入力し、接続してください。'] },
    key: { title: '実行用キーにトンネル権限を付ける', labels: ['Restricted API キー', 'Tunnels: Read + Use', 'NEKODEX 実行環境'], steps: ['同じ Platform 組織で API keys を開き、対象トンネルの Tunnels Read + Use のみを許可する Restricted キーを作成します。', 'キーを NEKODEX のパスワード欄へ直接貼り付けます。これはトンネルの実行用キーで、モデルの API キーではありません。画像やサポートへのメッセージにキーを含めないでください。'] },
    developer: { title: 'ChatGPT の開発者アクセスを探す', labels: ['この ChatGPT アカウント', 'ワークスペースの設定', 'カスタム接続の権限'], steps: ['下に ChatGPT の開発者モードのボタンがあれば、このアカウントのブラウザーセッションで開き、ワークスペースを確認します。', 'そのワークスペースに Developer mode の設定がある場合は、設定手順に従って有効にします。表示や利用可否は異なります。カスタム接続が制限されている場合は管理者に相談してください。'] },
    connector: { title: '正確なコネクターを接続する', labels: ['このアカウントのトンネル', '正確なコネクター名', 'このアカウントを検証'], steps: ['このアカウントとワークスペースの ChatGPT コネクターを開きます。このアカウントとモード用のトンネルを、NEKODEX に表示された正確なコネクター名で接続します。', 'NEKODEX に戻り、このアカウントのコネクターを検証します。コネクターが見えることやトンネルの準備完了だけでは、ツールの実行を確認できません。'] },
  },
};
const ko: HelpCopy = {
  show: '위치 보기', title: '커넥터 설정 안내', close: '설정으로 돌아가기', topics: '설정 항목',
  illustration: '개념도이며 서비스 화면 캡처가 아닙니다. 페이지 이름과 사용 가능한 기능은 다를 수 있습니다.',
  proof: '안내를 읽어도 설정은 바뀌지 않습니다. 설정으로 돌아가 이 계정을 연결하고 확인하세요. 실행 확인에는 실제 도구 실행의 성공이 필요합니다.',
  guides: {
    platform: { title: '올바른 Platform 조직 선택', labels: ['이 계정', 'OpenAI Platform', 'ChatGPT 워크스페이스'], steps: ['아래의 이 계정 버튼으로 OpenAI API를 여세요. 만들기 전에 로그인한 사용자와 Platform 조직을 확인하세요.', '이 계정의 대상 ChatGPT 워크스페이스에 연결된 조직을 사용하세요. 조직이 없다면 관리자에게 접근 권한을 요청하고 다른 계정의 터널로 대체하지 마세요.'] },
    tunnel: { title: '전용 터널 만들기', labels: ['Platform 조직', '전용 터널', '이 계정과 모드'], steps: ['Platform Tunnels에서 대상 조직과 ChatGPT 워크스페이스용 터널을 만드세요. NEKODEX 인증 정보 단계에서 사용할 터널 ID를 보관하세요.', '계정과 상호작용 모드마다 별도의 터널 연결이 필요합니다. 이 계정 설정에 터널 ID와 런타임 키를 입력하고 연결을 누르세요.'] },
    key: { title: '런타임 키에 터널 권한 부여', labels: ['Restricted API 키', 'Tunnels: Read + Use', 'NEKODEX 실행 환경'], steps: ['같은 Platform 조직에서 API keys를 열고 대상 터널의 Tunnels Read + Use만 허용하는 Restricted 키를 만드세요.', '키를 NEKODEX의 비밀번호 입력란에 직접 붙여 넣으세요. 터널 런타임 키이며 모델 API 키가 아닙니다. 화면 캡처나 지원 메시지에 키를 포함하지 마세요.'] },
    developer: { title: 'ChatGPT 개발자 접근 설정 찾기', labels: ['이 ChatGPT 계정', '워크스페이스 설정', '사용자 지정 커넥터 권한'], steps: ['아래에 ChatGPT 개발자 모드 버튼이 있으면 이 계정의 브라우저 세션에서 열고 대상 워크스페이스를 확인하세요.', '워크스페이스에 Developer mode 설정이 있으면 설정 안내에 따라 켜세요. 표시와 사용 가능 여부는 다를 수 있습니다. 사용자 지정 커넥터가 차단되어 있으면 관리자에게 문의하세요.'] },
    connector: { title: '정확한 커넥터 연결', labels: ['이 계정의 터널', '정확한 커넥터 이름', '이 계정 확인'], steps: ['이 계정과 워크스페이스의 ChatGPT 커넥터를 여세요. 이 계정과 모드용 터널을 NEKODEX에 표시된 정확한 커넥터 이름으로 연결하세요.', 'NEKODEX로 돌아와 이 계정의 커넥터를 확인하세요. 커넥터가 보이거나 터널이 준비됐다는 사실만으로 도구 실행을 확인할 수는 없습니다.'] },
  },
};
export function connectorSetupHelpCopy(language: Language): HelpCopy {
  return ({ en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko })[language] ?? en;
}
