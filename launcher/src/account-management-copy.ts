import type { Language } from './types';

const en = {
  rename: 'Rename', remove: 'Remove from NEKODEX', reauthenticate: 'Sign in again',
  renameTitle: 'Rename account', name: 'Account name', save: 'Save', cancel: 'Cancel',
  invalidName: 'Enter 1 to 80 characters.', renameHint: 'Only the name shown in NEKODEX changes.',
  removeTitle: 'Remove this account from NEKODEX?', keep: 'Keep account',
  removeBody: 'This account leaves the account list and new-task routing. Its account-owned tool tunnel bindings are stopped and removed. Existing conversations keep their original account owner and cannot continue through another account.',
  retained: 'Private local profile files, saved sessions and credential bytes remain on this Mac. This does not delete the OpenAI account or its chats, sign it out on other devices, or revoke its credentials.',
  fallback: 'The selected account will change to {account} for future selected-account tasks.',
  defaultReason: 'The built-in primary account cannot be removed.', lastEnabled: 'Enable another account first.',
  busyReason: 'Finish this account’s work or sign-in before changing access.',
  reauthTitle: 'Sign in to this account again?', reauthConfirm: 'Clear session and sign in',
  reauthBody: 'This NEKODEX account’s local browser session data, including ChatGPT sign-in, will be cleared before sign-in opens. Other account profiles, regular browsers, Native CLI sign-in and tunnel keys stay unchanged. Complete the normal sign-in in the browser.',
  manualReason: 'In Manual mode, sign out and sign in directly in this account’s browser.',
  failed: 'The action could not be completed. Review the error message and current account state before trying again.',
};
export type AccountManagementCopy = typeof en;
const copy: Record<Language, AccountManagementCopy> = {
  en,
  ru: {
    rename: 'Переименовать', remove: 'Удалить из NEKODEX', reauthenticate: 'Войти снова',
    renameTitle: 'Переименовать аккаунт', name: 'Название аккаунта', save: 'Сохранить', cancel: 'Отмена',
    invalidName: 'Введите от 1 до 80 символов.', renameHint: 'Меняется только название в NEKODEX.',
    removeTitle: 'Удалить аккаунт из NEKODEX?', keep: 'Оставить аккаунт',
    removeBody: 'Аккаунт исчезнет из списка и маршрутизации новых задач. Его привязки туннелей инструментов будут остановлены и удалены. Существующие чаты сохраняют исходного владельца и не смогут продолжиться через другой аккаунт.',
    retained: 'Локальные файлы профиля, сохранённые сеансы и данные ключей останутся на этом Mac. Аккаунт OpenAI и его чаты не удаляются; выход на других устройствах и отзыв ключей не выполняются.',
    fallback: 'Для будущих задач с выбранным аккаунтом будет выбран «{account}».',
    defaultReason: 'Основной встроенный аккаунт нельзя удалить.', lastEnabled: 'Сначала включите другой аккаунт.',
    busyReason: 'Завершите работу или вход этого аккаунта перед изменением доступа.',
    reauthTitle: 'Войти в аккаунт снова?', reauthConfirm: 'Очистить сеанс и войти',
    reauthBody: 'Перед открытием входа будут очищены локальные данные браузерного сеанса этой карточки NEKODEX, включая вход в ChatGPT. Профили других аккаунтов, обычные браузеры, вход Native CLI и ключи туннелей сохраняются. Завершите обычный вход в браузере.',
    manualReason: 'В ручном режиме выйдите и войдите прямо в браузере этого аккаунта.',
    failed: 'Действие не удалось завершить. Проверьте сообщение об ошибке и текущее состояние аккаунта перед повтором.',
  },
  'zh-CN': {
    rename: '重命名', remove: '从 NEKODEX 移除', reauthenticate: '重新登录', renameTitle: '重命名账户', name: '账户名称', save: '保存', cancel: '取消',
    invalidName: '请输入 1 至 80 个字符。', renameHint: '仅更改 NEKODEX 中显示的名称。', removeTitle: '从 NEKODEX 移除此账户？', keep: '保留账户',
    removeBody: '此账户将从列表和新任务路由中移除，其工具隧道绑定将停止并移除。已有对话保留原账户归属，不能通过其他账户继续。',
    retained: '本机的私有配置文件、已保存会话及凭据数据会保留。此操作不会删除 OpenAI 账户或聊天，也不会退出其他设备或撤销凭据。', fallback: '今后的指定账户任务将使用“{account}”。',
    defaultReason: '内置主账户无法移除。', lastEnabled: '请先启用其他账户。', busyReason: '请先结束此账户的任务或登录。',
    reauthTitle: '重新登录此账户？', reauthConfirm: '清除会话并登录', reauthBody: '仅清除此 NEKODEX 账户的本地浏览器会话数据（包括 ChatGPT 登录），然后打开登录。其他账户配置、常规浏览器、Native CLI 登录及隧道密钥保持不变。请在浏览器中完成正常登录。', manualReason: '手动模式下，请在此账户的浏览器中退出并重新登录。', failed: '操作未能完成。重试前请检查错误信息及账户当前状态。',
  },
  'zh-TW': {
    rename: '重新命名', remove: '從 NEKODEX 移除', reauthenticate: '重新登入', renameTitle: '重新命名帳號', name: '帳號名稱', save: '儲存', cancel: '取消',
    invalidName: '請輸入 1 至 80 個字元。', renameHint: '僅變更 NEKODEX 中顯示的名稱。', removeTitle: '從 NEKODEX 移除此帳號？', keep: '保留帳號',
    removeBody: '此帳號將從清單與新任務路由中移除，其工具通道綁定將停止並移除。現有對話保留原帳號歸屬，無法透過其他帳號繼續。',
    retained: '此 Mac 的私人設定檔、已儲存工作階段與憑證資料將保留。此操作不會刪除 OpenAI 帳號或聊天，也不會登出其他裝置或撤銷憑證。', fallback: '未來的指定帳號任務將使用「{account}」。',
    defaultReason: '內建主要帳號無法移除。', lastEnabled: '請先啟用其他帳號。', busyReason: '請先結束此帳號的工作或登入。',
    reauthTitle: '重新登入此帳號？', reauthConfirm: '清除工作階段並登入', reauthBody: '僅清除此 NEKODEX 帳號的本機瀏覽器工作階段資料（包括 ChatGPT 登入），再開啟登入。其他帳號設定檔、一般瀏覽器、Native CLI 登入及通道金鑰保持不變。請在瀏覽器中完成正常登入。', manualReason: '手動模式下，請在此帳號的瀏覽器中登出再登入。', failed: '操作未能完成。重試前請檢查錯誤訊息與帳號目前狀態。',
  },
  ja: {
    rename: '名前を変更', remove: 'NEKODEX から削除', reauthenticate: '再ログイン', renameTitle: 'アカウント名を変更', name: 'アカウント名', save: '保存', cancel: 'キャンセル',
    invalidName: '1～80 文字で入力してください。', renameHint: 'NEKODEX に表示される名前のみ変更します。', removeTitle: 'このアカウントを NEKODEX から削除しますか？', keep: 'アカウントを保持',
    removeBody: '一覧と新規タスクの振り分けから外し、このアカウントのツールトンネルの紐付けを停止・削除します。既存の会話は元のアカウントに紐付いたままで、別のアカウントでは継続できません。',
    retained: 'この Mac の非公開プロファイル、保存済みセッション、認証情報は残ります。OpenAI アカウントやチャットの削除、他の端末のログアウト、認証情報の失効は行いません。', fallback: '今後の選択アカウントのタスクは「{account}」を使用します。',
    defaultReason: '組み込みのメインアカウントは削除できません。', lastEnabled: '先に別のアカウントを有効にしてください。', busyReason: 'このアカウントの作業やログインが終わるまでお待ちください。',
    reauthTitle: 'このアカウントに再ログインしますか？', reauthConfirm: 'セッションを消去してログイン', reauthBody: 'この NEKODEX アカウントのローカルブラウザーセッションデータ（ChatGPT ログインを含む）のみ消去し、ログインを開きます。他のアカウント、通常のブラウザー、Native CLI のログイン、トンネルキーは変更しません。ブラウザーで通常のログインを完了してください。', manualReason: '手動モードでは、このアカウントのブラウザーでログアウトして再ログインしてください。', failed: '操作を完了できませんでした。再試行前にエラーと現在のアカウント状態を確認してください。',
  },
  ko: {
    rename: '이름 변경', remove: 'NEKODEX에서 제거', reauthenticate: '다시 로그인', renameTitle: '계정 이름 변경', name: '계정 이름', save: '저장', cancel: '취소',
    invalidName: '1~80자로 입력하세요.', renameHint: 'NEKODEX에 표시되는 이름만 변경됩니다.', removeTitle: 'NEKODEX에서 이 계정을 제거할까요?', keep: '계정 유지',
    removeBody: '계정 목록과 새 작업 라우팅에서 제거하며, 이 계정의 도구 터널 연결을 중지하고 제거합니다. 기존 대화는 원래 계정에 연결된 상태를 유지하며 다른 계정으로 계속할 수 없습니다.',
    retained: '이 Mac의 비공개 프로필 파일, 저장된 세션 및 자격 증명은 남습니다. OpenAI 계정이나 채팅을 삭제하거나 다른 기기에서 로그아웃하거나 자격 증명을 취소하지 않습니다.', fallback: '향후 선택 계정 작업은 “{account}”을 사용합니다.',
    defaultReason: '기본 내장 계정은 제거할 수 없습니다.', lastEnabled: '먼저 다른 계정을 활성화하세요.', busyReason: '이 계정의 작업이나 로그인을 먼저 완료하세요.',
    reauthTitle: '이 계정에 다시 로그인할까요?', reauthConfirm: '세션 지우고 로그인', reauthBody: '이 NEKODEX 계정의 로컬 브라우저 세션 데이터(ChatGPT 로그인 포함)만 지운 후 로그인을 엽니다. 다른 계정 프로필, 일반 브라우저, Native CLI 로그인 및 터널 키는 유지됩니다. 브라우저에서 일반 로그인을 완료하세요.', manualReason: '수동 모드에서는 이 계정의 브라우저에서 직접 로그아웃하고 로그인하세요.', failed: '작업을 완료하지 못했습니다. 다시 시도하기 전에 오류와 현재 계정 상태를 확인하세요.',
  },
};
export const accountManagementCopy = (language: Language) => copy[language] ?? en;
