import type { Language, BrowserState } from './types';
import { workflowCopy } from './workflow-copy';
const messages = {
  en: ['The session check timed out. Check your connection and retry.', 'ChatGPT redirected or refused the session check. Open Browser to inspect the page; this is not proof of sign-out.', 'ChatGPT limited session checks. Wait before retrying.', 'The session service could not be reached. Check your connection and retry.', 'The account identity could not be confirmed. Open Browser, then retry verification.', 'ChatGPT returned an unexpected session response. Retry later.', 'The ChatGPT page is not ready. Open Browser and let it finish loading, then retry.'],
  ru: ['Проверка сессии превысила время ожидания. Проверьте соединение и повторите.', 'ChatGPT перенаправил или отклонил проверку. Откройте браузер и проверьте страницу; это не подтверждает выход из аккаунта.', 'ChatGPT ограничил частоту проверок. Подождите перед повторной попыткой.', 'Сервис проверки сессии недоступен. Проверьте соединение и повторите.', 'Не удалось подтвердить аккаунт. Откройте браузер, затем повторите проверку.', 'ChatGPT вернул неожиданный ответ проверки сессии. Повторите позже.', 'Страница ChatGPT не готова. Откройте браузер, дождитесь загрузки и повторите проверку.'],
  'zh-CN': ['会话检查超时。请检查网络后重试。', 'ChatGPT 重定向或拒绝了检查。请打开浏览器查看页面；这不代表已退出登录。', 'ChatGPT 限制了检查频率。请稍后重试。', '无法连接会话服务。请检查网络后重试。', '无法确认账户身份。请打开浏览器后重新检查。', 'ChatGPT 返回了异常的会话响应。请稍后重试。', 'ChatGPT 页面尚未就绪。请打开浏览器，等待加载后重试。'],
  'zh-TW': ['工作階段檢查逾時。請檢查網路後重試。', 'ChatGPT 重新導向或拒絕了檢查。請開啟瀏覽器查看頁面；這不代表已登出。', 'ChatGPT 限制了檢查頻率。請稍後重試。', '無法連線至工作階段服務。請檢查網路後重試。', '無法確認帳戶身分。請開啟瀏覽器後重新檢查。', 'ChatGPT 傳回非預期的工作階段回應。請稍後重試。', 'ChatGPT 頁面尚未就緒。請開啟瀏覽器，等待載入後重試。'],
  ja: ['セッション確認がタイムアウトしました。接続を確認して再試行してください。', 'ChatGPT が確認を転送または拒否しました。ブラウザーでページを確認してください。ログアウトを意味するものではありません。', 'ChatGPT が確認の頻度を制限しました。しばらく待ってから再試行してください。', 'セッションサービスに接続できません。接続を確認して再試行してください。', 'アカウントを確認できませんでした。ブラウザーを開いてから再試行してください。', 'ChatGPT から予期しない応答が返されました。後で再試行してください。', 'ChatGPT ページの準備ができていません。ブラウザーを開き、読み込み後に再試行してください。'],
  ko: ['세션 확인 시간이 초과되었습니다. 연결을 확인하고 다시 시도하세요.', 'ChatGPT가 확인을 리디렉션하거나 거부했습니다. 브라우저에서 페이지를 확인하세요. 로그아웃되었다는 의미는 아닙니다.', 'ChatGPT가 확인 빈도를 제한했습니다. 잠시 후 다시 시도하세요.', '세션 서비스에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.', '계정을 확인할 수 없습니다. 브라우저를 열고 다시 확인하세요.', 'ChatGPT가 예상하지 못한 세션 응답을 반환했습니다. 나중에 다시 시도하세요.', 'ChatGPT 페이지가 준비되지 않았습니다. 브라우저를 열어 로딩이 끝난 후 다시 시도하세요.'],
};
export function sessionIssueCopy(language: Language, issue: BrowserState['authenticationIssue']): string {
  const index = ['timeout', 'access', 'rate-limit', 'network', 'identity', 'response', 'browser'].indexOf(issue ?? 'unknown');
  return index < 0 ? workflowCopy(language).session.verificationUnavailableBody : (messages[language] ?? messages.en)[index]!;
}
