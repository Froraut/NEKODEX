const { isExistingChromeErrorCode, existingChromeError } = require('./existing-chrome-errors.cjs');

// Fixed diagnostics only: helper messages may contain connection URLs or cookies.
const GUIDANCE = Object.freeze({
  'chrome-too-old': [
    'Update Google Chrome to version 144 or later, then reopen the selected profile and retry.',
    'Обновите Google Chrome до версии 144 или новее, затем откройте выбранный профиль и повторите подключение.'],
  'chrome-profile-access-denied': [
    'The operating system denied access to Chrome connection information. Check NEKODEX file-access permissions in system settings, then retry with the same Chrome profile.',
    'Операционная система запретила доступ к сведениям о соединении Chrome. Проверьте разрешения NEKODEX на доступ к файлам в системных настройках и повторите подключение того же профиля Chrome.'],
  'chrome-permission-denied': [
    'Chrome declined the connection. Retry and approve the connection request in the selected Chrome profile.',
    'Chrome отклонил подключение. Повторите попытку и разрешите подключение в выбранном профиле Chrome.'],
  'chrome-permission-timeout': [
    'Chrome connection approval timed out. Keep the selected profile open, retry, and respond to the Chrome permission prompt.',
    'Истекло время ожидания разрешения Chrome. Оставьте выбранный профиль открытым, повторите попытку и ответьте на запрос разрешения Chrome.'],
  'chrome-unavailable': [
    'Open the selected Chrome profile and enable remote debugging at chrome://inspect/#remote-debugging, then retry.',
    'Откройте выбранный профиль Chrome и включите удалённую отладку на chrome://inspect/#remote-debugging, затем повторите подключение.'],
  'invalid-endpoint': [
    'Chrome connection information is invalid. Reopen chrome://inspect/#remote-debugging in the selected profile, check that remote debugging is enabled, and retry.',
    'Сведения о соединении Chrome недействительны. Откройте chrome://inspect/#remote-debugging в выбранном профиле, проверьте, что удалённая отладка включена, и повторите подключение.'],
  'chrome-disconnected': [
    'Chrome disconnected. Reopen the selected profile, keep its window open, and retry the connection.',
    'Соединение с Chrome прервано. Снова откройте выбранный профиль, оставьте его окно открытым и повторите подключение.'],
  'session-missing': [
    'Sign in to the intended ChatGPT account in the selected Chrome profile, then retry verification.',
    'Войдите в нужный аккаунт ChatGPT в выбранном профиле Chrome, затем повторите проверку.'],
  'launcher-authorization-failed': [
    'NEKODEX could not authorize its private import helper. Restart NEKODEX and retry with the selected Chrome profile.',
    'NEKODEX не смог авторизовать свой служебный процесс импорта. Перезапустите NEKODEX и повторите подключение выбранного профиля Chrome.'],
  'chrome-profile-claim-missing': [
    'The selected profile’s connection tab was not found through the approved Chrome connection. Keep the selected profile window open and retry connecting.',
    'Не удалось найти служебную вкладку выбранного профиля через разрешённое соединение Chrome. Оставьте окно выбранного профиля открытым и повторите подключение.'],
  'chrome-account-mismatch': [
    'Chrome returned a different previously bound ChatGPT account. Check the intended ChatGPT account in the selected profile before retrying.',
    'Chrome вернул другой ранее привязанный аккаунт ChatGPT. Перед повторной попыткой проверьте нужный аккаунт ChatGPT в выбранном профиле.'],
  'existing_chrome_cleanup_failed': [
    'Temporary Chrome sign-in data could not be cleaned up. Restart NEKODEX and retry before using the imported session.',
    'Не удалось очистить временные данные входа Chrome. Перезапустите NEKODEX и повторите попытку перед использованием импортированной сессии.'],
});
const FALLBACK = [
  'Could not verify sign-in from the selected Chrome profile. Check ChatGPT sign-in and Chrome connection approval.',
  'Не удалось подтвердить вход из выбранного Chrome. Проверьте вход в ChatGPT и разрешение Chrome на подключение.'];
const EXTRA_ERRORS = Object.freeze({
  'chrome-account-mismatch': 'Chrome returned a different previously bound ChatGPT account',
  'chrome-account-unverified': 'Chrome returned an unverified ChatGPT account',
  'chrome-account-unidentified': 'ChatGPT identity has no user-visible label',
  'profile-login-cancelled': 'Sign-in cancelled',
  'profile-login-timeout': 'Chrome sign-in timed out',
  'existing_chrome_cleanup_failed': 'Temporary Chrome sign-in cleanup failed',
});

function safeProfileLoginError(error) {
  const code = error?.code;
  if (isExistingChromeErrorCode(code)) return existingChromeError(code);
  if (typeof code === 'string' && Object.hasOwn(EXTRA_ERRORS, code)) {
    return Object.assign(new Error(EXTRA_ERRORS[code]), { code });
  }
  return existingChromeError('import-failed');
}

function chromeProfileErrorGuidance(code, language) {
  const index = language === 'ru' ? 1 : 0;
  const guidance = typeof code === 'string' && Object.hasOwn(GUIDANCE, code) ? GUIDANCE[code] : FALLBACK;
  return guidance[index];
}

module.exports = { chromeProfileErrorGuidance, safeProfileLoginError };
