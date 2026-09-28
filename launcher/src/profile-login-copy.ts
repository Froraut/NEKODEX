import type { Language } from './types';
const messages = {
  en: ['The ChatGPT account does not match the confirmed binding. Sign in with the intended account or explicitly change the binding.', 'The selected Chrome profile did not provide a verified ChatGPT sign-in. Open ChatGPT in that profile, confirm the intended account is signed in, then retry the import.', 'ChatGPT did not provide an identifiable account. Complete sign-in before connecting it.', 'Chrome did not expose the chosen profile to the approved connection. Select the intended profile in Chrome and retry, or choose a new isolated sign-in.'],
  ru: ['Аккаунт ChatGPT не совпадает с подтверждённой привязкой. Войдите в нужный аккаунт или явно измените привязку.', 'В выбранном профиле Chrome не удалось подтвердить вход в ChatGPT. Откройте ChatGPT в этом профиле, убедитесь, что выполнен вход в нужный аккаунт, затем повторите импорт.', 'ChatGPT не передал данные для определения аккаунта. Завершите вход перед подключением.', 'Chrome не открыл доступ к выбранному профилю через разрешённое подключение. Выберите нужный профиль в Chrome и повторите или используйте новый изолированный вход.'],
  'zh-CN': ['ChatGPT 账户与已确认的绑定不一致。请使用预期账户登录或明确更改绑定。', '无法确认所选 Chrome 资料中的 ChatGPT 登录。请在该资料中打开 ChatGPT，确认已登录所需账户，然后重新导入。', 'ChatGPT 未提供可识别的账户。请先完成登录。', 'Chrome 未通过已批准的连接开放所选资料。请在 Chrome 中选择预期资料后重试，或使用新的隔离登录。'],
  'zh-TW': ['ChatGPT 帳戶與已確認的綁定不一致。請使用預期帳戶登入或明確變更綁定。', '無法確認所選 Chrome 設定檔中的 ChatGPT 登入。請在該設定檔中開啟 ChatGPT，確認已登入所需帳戶，再重新匯入。', 'ChatGPT 未提供可識別的帳戶。請先完成登入。', 'Chrome 未透過已核准的連線開放所選設定檔。請在 Chrome 中選擇預期設定檔後重試，或使用新的隔離登入。'],
  ja: ['ChatGPT アカウントが確認済みの関連付けと一致しません。目的のアカウントでログインするか、関連付けを明示的に変更してください。', '選択した Chrome プロファイルの ChatGPT ログインを確認できません。このプロファイルで ChatGPT を開き、目的のアカウントでログインしていることを確認してから、インポートを再試行してください。', 'ChatGPT が識別可能なアカウントを返しませんでした。先にログインを完了してください。', '承認された接続から選択した Chrome プロファイルを利用できません。Chrome で目的のプロファイルを選んで再試行するか、新しい分離ログインを使用してください。'],
  ko: ['ChatGPT 계정이 확인된 연결과 일치하지 않습니다. 의도한 계정으로 로그인하거나 연결을 명시적으로 변경하세요.', '선택한 Chrome 프로필의 ChatGPT 로그인을 확인할 수 없습니다. 해당 프로필에서 ChatGPT를 열고 원하는 계정에 로그인했는지 확인한 다음 가져오기를 다시 시도하세요.', 'ChatGPT가 식별 가능한 계정을 제공하지 않았습니다. 먼저 로그인을 완료하세요.', '승인된 연결에서 선택한 Chrome 프로필을 사용할 수 없습니다. Chrome에서 원하는 프로필을 선택하고 다시 시도하거나 새 격리 로그인을 사용하세요.'],
};
const codes = ['chrome-account-mismatch', 'chrome-account-unverified', 'chrome-account-unidentified', 'chrome-profile-claim-missing'];
export function profileLoginFailureText(code: string | null, language: Language = 'en'): string | undefined {
  const index = codes.indexOf(code ?? '');
  return index < 0 ? undefined : (messages[language] ?? messages.en)[index];
}
