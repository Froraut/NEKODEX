import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Panel, TextField } from './design';
import type { Language } from './types';
import type { NativeAccountsApi, NativeAccountsRequest, NativeInventoryRequest, NativeExecutionCloseRequest, NativeAccountsSnapshot, NativeAccountProfile } from './native-accounts-types';
import './surfaces/native-accounts.css';

const verificationUrl = 'https://auth.openai.com/codex/device';
const pendingStates = new Set(['prepared', 'running', 'pending', 'cancel-requested']);
type Mutation = Exclude<NativeAccountsRequest, { action: 'status' }> | NativeInventoryRequest | NativeExecutionCloseRequest;

/** Presentation only: the native authority owns profiles, login processes and receipts. */
export function NativeAccountsPanel({ language, api, disabled = false }: {
  language: Language; api: NativeAccountsApi; disabled?: boolean;
}) {
  const ru = language === 'ru';
  const transport = useRef(api); transport.current = api;
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const uncertainRequest = useRef<Mutation | null>(null);
  const [snapshot, setSnapshot] = useState<NativeAccountsSnapshot | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(false);
  const [auxError, setAuxError] = useState(false);

  const read = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (mounted.current) setBusy(true);
    try {
      const outstanding = uncertainRequest.current;
      const result = await transport.current.request({ action: 'status', ...(outstanding ? { actionId: outstanding.actionId } : {}) });
      if (!mounted.current) return;
      setSnapshot(result); setError(false);
      if (outstanding && (result.receipts?.some(receipt => receipt.actionId === outstanding.actionId)
        || result.inventory?.receipts.some(receipt => receipt.actionId === outstanding.actionId)
        || result.rejectedAction?.actionId === outstanding.actionId && result.rejectedAction.knownNotStarted)) {
        uncertainRequest.current = null; setUncertain(false);
        if (outstanding.action === 'prepare-profile') setLabel('');
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void read();
    return () => { mounted.current = false; };
  }, []);

  const hasPending = (snapshot?.profiles.some(profile => profile.login && pendingStates.has(profile.login.state)) ?? false) || Boolean(snapshot?.inventory?.activeCount);
  useEffect(() => {
    if (!hasPending || disabled) return;
    // Only observe the existing owner's login; no login, inventory or inference is started here.
    const timer = window.setInterval(() => void read(), 2000);
    return () => window.clearInterval(timer);
  }, [hasPending, disabled]);

  const mutate = async (body: Mutation) => {
    if (inFlight.current || uncertainRequest.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(false); setAuxError(false);
    // Keep this exact identity if the response is lost. Refresh reconciles its receipt, never resubmits it.
    uncertainRequest.current = body;
    try {
      const result = await transport.current.request(body);
      if (!mounted.current) return;
      setSnapshot(result); uncertainRequest.current = null; setUncertain(false);
      if (result.rejectedAction?.actionId === body.actionId) setError(true);
      if (body.action === 'prepare-profile') setLabel('');
    } catch {
      if (mounted.current) { setUncertain(true); setError(true); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const externalAction = async (action: () => Promise<unknown>) => {
    setAuxError(false);
    try { await action(); } catch { if (mounted.current) setAuxError(true); }
  };
  const stateText = (profile: NativeAccountProfile) => {
    if (profile.login?.state === 'cancel-requested') return ru ? 'Остановка входа запрошена; ожидаем подтверждения.' : 'Sign-in cancellation requested; awaiting confirmation.';
    if (profile.login?.state === 'pending') return ru ? 'Ожидает вашего входа на официальной странице OpenAI.' : 'Waiting for you to sign in on the official OpenAI page.';
    const copy = {
      fresh: [ 'Профиль подготовлен. Вход ещё не запущен.', 'Profile prepared. Sign-in has not started.' ],
      'login-pending': [ 'Запрашиваем код входа OpenAI…', 'Requesting an OpenAI sign-in code…' ],
      'signed-in-checking': [ 'Вход подтверждён. Каталог моделей и допуск к выполнению проверяются отдельно.', 'Sign-in confirmed. Model inventory and execution admission are checked separately.' ],
      'auth-outcome-unknown': [ 'Результат входа неизвестен. Обновите статус перед следующим действием.', 'Sign-in outcome is unknown. Refresh status before taking another action.' ],
      'login-failed': [ 'Вход не завершён. Для новой попытки подготовьте отдельный новый профиль.', 'Sign-in did not complete. Prepare a separate new profile for another attempt.' ],
      cancelled: [ 'Вход отменён. Состояние доступа и моделей отдельно не проверено.', 'Sign-in cancelled. Account access and models have not been independently verified.' ],
    };
    return copy[profile.state]?.[ru ? 0 : 1] ?? (ru ? 'Статус требует проверки.' : 'Status needs verification.');
  };
  const locked = disabled || busy || uncertain || !snapshot?.available;

  return <Panel title={ru ? 'Аккаунты Native Codex' : 'Native Codex accounts'} className="native-accounts"
    actions={<Button disabled={disabled || busy} busy={busy} onClick={() => void read()}>{ru ? 'Обновить статус' : 'Refresh status'}</Button>}>
    <p>{ru ? 'Создайте отдельный профиль и явно запустите вход через OpenAI. Вход сам по себе не подтверждает доступные модели или возможность выполнения задач.' : 'Prepare a separate profile and explicitly start OpenAI sign-in. Sign-in alone does not establish model availability or task execution readiness.'}</p>
    {error ? <Notice tone="warning" title={ru ? 'Не удалось подтвердить актуальный статус.' : 'The current status could not be confirmed.'}>{ru ? 'Обновите статус. Не подтверждённое действие не повторяется автоматически.' : 'Refresh status. An unconfirmed action is never replayed automatically.'}</Notice> : null}
    {uncertain ? <Notice tone="warning" title={ru ? 'Результат действия пока неизвестен.' : 'The action outcome is still unknown.'}>{ru ? 'Сохранён идентификатор исходного действия. Обновление сверит его с журналом; новые изменения пока заблокированы.' : 'The original action identity has been retained. Refresh checks its receipt; further changes are blocked until reconciliation.'}</Notice> : null}
    {auxError ? <Notice tone="error" title={ru ? 'Не удалось открыть страницу или скопировать код.' : 'Could not open the page or copy the code.'}>{ru ? 'Можно вручную открыть официальный адрес и ввести показанный код.' : 'You can manually open the official address and enter the displayed code.'}</Notice> : null}
    {snapshot && !snapshot.available ? <Notice tone="warning" title={ru ? 'Управление Native сейчас недоступно.' : 'Native account management is unavailable.'}>{ru ? 'Проверьте подключение Native и обновите статус.' : 'Check the Native connection and refresh status.'}</Notice> : null}
    <div className="native-accounts__prepare">
      <TextField label={ru ? 'Название нового профиля' : 'New profile name'} value={label} maxLength={80} disabled={locked} onChange={event => setLabel(event.target.value)} />
      <div className="native-accounts__actions"><Button disabled={locked || !label.trim()} onClick={() => void mutate({ action: 'prepare-profile', actionId: crypto.randomUUID(), label: label.trim() })}>{ru ? 'Подготовить новый профиль' : 'Prepare new profile'}</Button></div>
    </div>
    {!snapshot && !error ? <p role="status">{ru ? 'Читаем статус Native…' : 'Reading Native status…'}</p> : null}
    {snapshot && !snapshot.profiles.length ? <p>{ru ? 'Подготовленных профилей пока нет.' : 'No profiles have been prepared yet.'}</p> : null}
    <ul className="native-accounts__profiles">{snapshot?.profiles.map(profile => {
      const login = profile.login;
      const pending = Boolean(login && pendingStates.has(login.state));
      const showCode = login?.state === 'pending' && login.verificationUrl === verificationUrl && Boolean(login.userCode);
      const mayStart = profile.state === 'fresh' && !pending;
      const inventory = snapshot?.inventory?.receipts.filter(receipt => receipt.profileId === profile.id && receipt.epoch === profile.epoch).at(-1);
      const execution = snapshot?.execution?.profileId === profile.id && snapshot.execution.epoch === profile.epoch && snapshot.execution.ownerHeld ? snapshot.execution : undefined;
      return <li key={profile.id} className="native-accounts__profile">
        <strong>{profile.label}</strong>
        <p role="status">{stateText(profile)}</p>
        {inventory ? <p role="status">{inventory.state === 'completed'
          ? (ru ? `Аккаунт и каталог подтверждены: ${inventory.metadata?.modelCount ?? 0} моделей. Результаты выполнения показаны в задачах.` : `Account and catalog verified: ${inventory.metadata?.modelCount ?? 0} models. Execution results are shown in the tasks.`)
          : inventory.ownerHeld ? (ru ? 'Проверка аккаунта и каталога ещё удерживает своего исполнителя.' : 'Account and catalog inspection still owns its worker.')
          : (ru ? 'Проверка каталога не завершилась подтверждённым результатом. Сохранена квитанция без повторной отправки.' : 'Catalog inspection has no confirmed result. Its receipt is retained without replay.')}</p> : null}
        {execution ? <p>{ru ? `Настроены Native-модели: ${execution.models.map(model => model.label || model.id).join(', ') || 'выполнение приостановлено'}.` : `Configured Native models: ${execution.models.map(model => model.label || model.id).join(', ') || 'execution held'}.`}</p> : null}
        {showCode ? <>
          <p>{verificationUrl}</p>
          <TextField label={ru ? 'Одноразовый код OpenAI' : 'OpenAI one-time code'} value={login!.userCode} readOnly className="native-accounts__code" />
          <div className="native-accounts__actions">
            <Button disabled={disabled} onClick={() => void externalAction(() => transport.current.openVerificationUrl(verificationUrl))}>{ru ? 'Открыть страницу OpenAI' : 'Open OpenAI page'}</Button>
            {api.copyCode ? <Button disabled={disabled} onClick={() => void externalAction(() => transport.current.copyCode!(login!.userCode!))}>{ru ? 'Скопировать код' : 'Copy code'}</Button> : null}
          </div>
        </> : null}
        <div className="native-accounts__actions">
          {mayStart ? <Button disabled={locked} onClick={() => void mutate({ action: 'begin-device-login', actionId: crypto.randomUUID(), profileId: profile.id, epoch: profile.epoch })}>{ru ? 'Войти через OpenAI' : 'Sign in with OpenAI'}</Button> : null}
          {pending && login ? <Button disabled={locked || login.state === 'cancel-requested'} onClick={() => void mutate({ action: 'cancel-login', actionId: crypto.randomUUID(), loginAttemptId: login.id })}>{ru ? 'Отменить вход' : 'Cancel sign-in'}</Button> : null}
          {profile.state === 'signed-in-checking' && !execution ? <Button disabled={locked || Boolean(snapshot?.inventory?.activeCount)} onClick={() => void mutate({ action: 'inspect-models', actionId: crypto.randomUUID(), profileId: profile.id, epoch: profile.epoch })}>{ru ? 'Проверить аккаунт и модели' : 'Inspect account and models'}</Button> : null}
          {execution ? <Button disabled={locked} onClick={() => void mutate({ action: 'close-execution', actionId: crypto.randomUUID(), profileId: profile.id, epoch: profile.epoch })}>{ru ? 'Закрыть Native и всех его исполнителей' : 'Close Native and all its workers'}</Button> : null}
        </div>
      </li>;
    })}</ul>
  </Panel>;
}
