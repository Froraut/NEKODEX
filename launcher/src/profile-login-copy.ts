import type { Language } from './types';
const messages = {
  en: ['The ChatGPT account does not match the confirmed binding. Sign in with the intended account or explicitly change the binding.', 'Could not verify the captured ChatGPT session. Check the connection and retry verification.', 'ChatGPT did not provide an identifiable account. Complete sign-in before connecting it.', 'Chrome did not expose the chosen profile to the approved connection. Select the intended profile in Chrome and retry, or choose a new isolated sign-in.'],
  ru: ['Аккаунт ChatGPT не совпадает с подтверждённой привязкой. Войдите в нужный аккаунт или явно измените привязку.', 'Не удалось проверить полученную сессию ChatGPT. Проверьте соединение и повторите проверку.', 'ChatGPT не передал данные для определения аккаунта. Завершите вход перед подключением.', 'Chrome не открыл доступ к выбранному профилю через разрешённое подключение. Выберите нужный профиль в Chrome и повторите или используйте новый изолированный вход.'],
  'zh-CN': ['ChatGPT 账户与已确认的绑定不一致。请使用预期账户登录或明确更改绑定。', '无法验证获取的 ChatGPT 会话。请检查连接并重试验证。', 'ChatGPT 未提供可识别的账户。请先完成登录。', 'Chrome 未通过已批准的连接开放所选资料。请在 Chrome 中选择预期资料后重试，或使用新的隔离登录。'],
  'zh-TW': ['ChatGPT 帳戶與已確認的綁定不一致。請使用預期帳戶登入或明確變更綁定。', '無法驗證取得的 ChatGPT 工作階段。請檢查連線並重試驗證。', 'ChatGPT 未提供可識別的帳戶。請先完成登入。', 'Chrome 未透過已核准的連線開放所選設定檔。請在 Chrome 中選擇預期設定檔後重試，或使用新的隔離登入。'],
  ja: ['ChatGPT アカウントが確認済みの関連付けと一致しません。目的のアカウントでログインするか、関連付けを明示的に変更してください。', '取得した ChatGPT セッションを確認できません。接続を確認して再試行してください。', 'ChatGPT が識別可能なアカウントを返しませんでした。先にログインを完了してください。', '承認された接続から選択した Chrome プロファイルを利用できません。Chrome で目的のプロファイルを選んで再試行するか、新しい分離ログインを使用してください。'],
  ko: ['ChatGPT 계정이 확인된 연결과 일치하지 않습니다. 의도한 계정으로 로그인하거나 연결을 명시적으로 변경하세요.', '가져온 ChatGPT 세션을 확인할 수 없습니다. 연결을 확인하고 검증을 다시 시도하세요.', 'ChatGPT가 식별 가능한 계정을 제공하지 않았습니다. 먼저 로그인을 완료하세요.', '승인된 연결에서 선택한 Chrome 프로필을 사용할 수 없습니다. Chrome에서 원하는 프로필을 선택하고 다시 시도하거나 새 격리 로그인을 사용하세요.'],
};
const codes = ['chrome-account-mismatch', 'chrome-account-unverified', 'chrome-account-unidentified', 'chrome-profile-claim-missing'];
export function profileLoginFailureText(code: string | null, language: Language = 'en'): string | undefined {
  const index = codes.indexOf(code ?? '');
  return index < 0 ? undefined : (messages[language] ?? messages.en)[index];
}
