import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Notice, Panel, PanelStack, TextField } from './design';
import type { Language } from './types';
import type { NativeAccountsApi, NativeAccountsRequest, NativeInventoryRequest, NativeExecutionCloseRequest, NativeAccountsSnapshot, NativeAccountProfile } from './native-accounts-types';
import type { NativeOwnerRecoveryPreview, NativeOwnerRecoveryReceipt } from '../electron/native-account-recovery.cjs';
import { RemovalConfirmation } from './RemovalConfirmation';
import { NativeModelsOfflineNotice } from './NativeModelsOfflineNotice';
import { nativeModelsOfflineTarget } from './native-models-offline';
import './surfaces/native-accounts.css';

const verificationUrl = 'https://auth.openai.com/codex/device';
const pendingStates = new Set(['prepared', 'running', 'pending', 'cancel-requested']);
// Only an untouched fresh epoch proves no persisted CLI credential (a failed login can leave one behind);
// every other removal is acknowledged explicitly, matching the authority's credential check.
const unsignedStates = new Set(['fresh']);
type Mutation = Exclude<NativeAccountsRequest, { action: 'status' | 'preview-owner-recovery' }> | NativeInventoryRequest | NativeExecutionCloseRequest;
const recoveryPlanKey = (preview: NativeOwnerRecoveryPreview) => JSON.stringify({
  state: preview.state, reviewDigest: preview.reviewDigest, reasonCode: preview.reasonCode,
  markers: preview.markers, unsettledActionCount: preview.unsettledActionCount,
});

/** Presentation only: the native authority owns profiles, login processes and receipts. */
export function NativeAccountsPanel({ language, api, disabled = false, onChange }: {
  language: Language; api: NativeAccountsApi; disabled?: boolean; onChange?: () => void;
}) {
  const ru = language === 'ru';
  const transport = useRef(api); transport.current = api;
  const changed = useRef(onChange); changed.current = onChange;
  const qualificationRequests = useRef(new Map<string, 'inspect-models' | 'close-execution'>());
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const uncertainRequest = useRef<Mutation | null>(null);
  const [snapshot, setSnapshot] = useState<NativeAccountsSnapshot | null>(null);
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState<{ profile: NativeAccountProfile; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(false);
  const [auxError, setAuxError] = useState(false);
  const [recoveryPreview, setRecoveryPreview] = useState<NativeOwnerRecoveryPreview | null>(null);
  const recoveryPlan = useRef<string | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoveryReceipt, setRecoveryReceipt] = useState<NativeOwnerRecoveryReceipt | null>(null);
  const [removing, setRemoving] = useState<NativeAccountProfile | null>(null);

  const acceptSnapshot = (result: NativeAccountsSnapshot) => {
    setSnapshot(result);
    if (result.recoveryReceipt) setRecoveryReceipt(result.recoveryReceipt);
    if (result.recoveryReceipt?.state === 'completed' && result.recoveryReceipt.terminal && !result.recoveryReceipt.ownerHeld) {
      recoveryPlan.current = null; setRecoveryPreview(null); setRecoveryAcknowledged(false);
    } else if (result.recoverySupported === false) {
      recoveryPlan.current = null; setRecoveryPreview(null); setRecoveryAcknowledged(false);
    } else if (result.recoveryPreview) {
      const next = recoveryPlanKey(result.recoveryPreview);
      if (next !== recoveryPlan.current) setRecoveryAcknowledged(false);
      recoveryPlan.current = next; setRecoveryPreview(result.recoveryPreview);
    }
  };
  const acceptQualification = (result: NativeAccountsSnapshot) => {
    let qualified = false;
    for (const [actionId, action] of qualificationRequests.current) {
      const inventory = action === 'inspect-models' ? result.inventory?.receipts.find(row => row.actionId === actionId) : undefined;
      const closed = action === 'close-execution' ? result.receipts.find(row => row.actionId === actionId && row.kind === action && row.state === 'completed') : undefined;
      if (inventory?.state === 'completed' && !inventory.ownerHeld || closed) {
        qualificationRequests.current.delete(actionId); qualified = true;
      } else if (result.rejectedAction?.actionId === actionId || inventory && !inventory.ownerHeld && inventory.state === 'unknown') {
        qualificationRequests.current.delete(actionId);
      }
    }
    return qualified;
  };
  const reconciledRecovery = (result: NativeAccountsSnapshot, body: Mutation) =>
    result.rejectedAction?.actionId === body.actionId && result.rejectedAction.knownNotStarted
    || result.recoveryReceipt?.actionId === body.actionId && result.recoveryReceipt.terminal && !result.recoveryReceipt.ownerHeld;

  const read = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    let qualified = false;
    if (mounted.current) setBusy(true);
    try {
      const outstanding = uncertainRequest.current;
      const result = await transport.current.request({ action: 'status', ...(outstanding ? { actionId: outstanding.actionId } : {}) });
      if (!mounted.current) return;
      acceptSnapshot(result); qualified = acceptQualification(result); setError(false);
      if (outstanding && (outstanding.action === 'recover-owner' ? reconciledRecovery(result, outstanding) : (result.receipts?.some(receipt => receipt.actionId === outstanding.actionId)
        || result.inventory?.receipts.some(receipt => receipt.actionId === outstanding.actionId)
        || result.rejectedAction?.actionId === outstanding.actionId && result.rejectedAction.knownNotStarted))) {
        uncertainRequest.current = null; setUncertain(false);
        if (outstanding.action === 'prepare-profile') setLabel('');
        if (outstanding.action === 'rename-profile' && result.receipts.some(row => row.actionId === outstanding.actionId && row.state === 'completed')) { setRenaming(null); qualified = true; }
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && qualified) changed.current?.();
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
    if (body.action === 'inspect-models' || body.action === 'close-execution') qualificationRequests.current.set(body.actionId, body.action);
    let qualified = false;
    try {
      const result = await transport.current.request(body);
      if (!mounted.current) return;
      acceptSnapshot(result);
      qualified = acceptQualification(result)
        // A removal may have closed the profile's execution: Agent mode re-reads its models.
        || body.action === 'remove-profile' && result.receipts.some(row => row.actionId === body.actionId && row.state === 'completed');
      if (body.action !== 'recover-owner' || reconciledRecovery(result, body)) {
        uncertainRequest.current = null; setUncertain(false);
      } else setUncertain(true);
      if (result.rejectedAction?.actionId === body.actionId) setError(true);
      if (body.action === 'prepare-profile') setLabel('');
      if (body.action === 'rename-profile' && result.receipts.some(row => row.actionId === body.actionId && row.state === 'completed')) { setRenaming(null); qualified = true; }
    } catch {
      if (mounted.current) { setUncertain(true); setError(true); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && qualified) changed.current?.();
    }
  };

  const previewRecovery = async () => {
    if (inFlight.current || uncertainRequest.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const result = await transport.current.request({ action: 'preview-owner-recovery' });
      if (mounted.current) acceptSnapshot(result);
    } catch { if (mounted.current) setError(true); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
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
  const offline = nativeModelsOfflineTarget(snapshot);

  return <Panel title={ru ? 'Аккаунты Native Codex' : 'Native Codex accounts'} className="native-accounts"
    actions={<Button disabled={disabled || busy} busy={busy} onClick={() => void read()}>{ru ? 'Обновить статус' : 'Refresh status'}</Button>}>
    <PanelStack className="native-accounts__body">
    {offline ? <NativeModelsOfflineNotice language={language} target={offline} disabled={locked} busy={busy && qualificationRequests.current.size > 0}
      consequence={ru ? 'До этого Native Agent-задачи нельзя создать или запустить.' : 'Until then Native Agent tasks cannot be created or run.'}
      onCheck={() => void mutate({ action: 'inspect-models', actionId: crypto.randomUUID(), profileId: offline.profileId, epoch: offline.epoch })} /> : null}
    <p>{ru ? 'Создайте отдельный профиль и явно запустите вход через OpenAI. Вход сам по себе не подтверждает доступные модели или возможность выполнения задач.' : 'Prepare a separate profile and explicitly start OpenAI sign-in. Sign-in alone does not establish model availability or task execution readiness.'}</p>
    {error ? <Notice tone="warning" title={ru ? 'Не удалось подтвердить актуальный статус.' : 'The current status could not be confirmed.'}>{ru ? 'Обновите статус. Не подтверждённое действие не повторяется автоматически.' : 'Refresh status. An unconfirmed action is never replayed automatically.'}</Notice> : null}
    {uncertain ? <Notice tone="warning" title={ru ? 'Результат действия пока неизвестен.' : 'The action outcome is still unknown.'}>{ru ? 'Сохранён идентификатор исходного действия. Обновление сверит его с журналом; новые изменения пока заблокированы.' : 'The original action identity has been retained. Refresh checks its receipt; further changes are blocked until reconciliation.'}</Notice> : null}
    {auxError ? <Notice tone="error" title={ru ? 'Не удалось открыть страницу или скопировать код.' : 'Could not open the page or copy the code.'}>{ru ? 'Можно вручную открыть официальный адрес и ввести показанный код.' : 'You can manually open the official address and enter the displayed code.'}</Notice> : null}
    {snapshot && !snapshot.available ? <Notice tone="warning" title={ru ? 'Управление Native сейчас недоступно.' : 'Native account management is unavailable.'}>{ru ? 'Проверьте подключение Native и обновите статус.' : 'Check the Native connection and refresh status.'}</Notice> : null}
    {snapshot?.recoverySupported && (!snapshot.available || recoveryPreview || recoveryReceipt) ? <section aria-label={ru ? 'Восстановление владельца Native' : 'Native owner recovery'}>
      <h3>{ru ? 'Восстановление Native после сбоя' : 'Native recovery after a failure'}</h3>
      <p>{ru ? 'Сначала проверьте план. Восстановление убирает подтверждённые устаревшие блокировки, сохраняя аккаунт и сеансы. Прежние запросы не повторяются; вход, каталог и модели не запускаются.' : 'Review the plan first. Recovery archives confirmed stale locks and retains the account and sessions. Prior requests are not replayed; it starts no sign-in, inventory or model.'}</p>
      <Button disabled={disabled || busy || uncertain} onClick={() => void previewRecovery()}>{ru ? 'Приостановить инструменты и проверить восстановление' : 'Pause tool connections and preview recovery'}</Button>
      <p>{ru ? 'Проверка и подтверждённое восстановление временно приостанавливают соединения инструментов и затем восстанавливают их. Аккаунты, ключи и адреса туннелей сохраняются; активные Native HTTP-запросы продолжаются. Текущая работа Web и инструментов должна завершиться.' : 'Preview and reviewed recovery briefly pause tool connections and then restore them. Accounts, keys and tunnel addresses are retained; active Native HTTP requests continue. Finish current Web and tool work first.'}</p>
      {recoveryPreview ? <>
        <p role="status">{recoveryPreview.state === 'reviewable'
          ? (ru ? 'Подтверждены устаревшие маркеры. Проверьте точный план перед восстановлением.' : 'Stale markers confirmed. Review the exact plan before recovery.')
          : (ru ? 'Восстановление заблокировано. Живого или неопределённого владельца нельзя переопределить.' : 'Recovery blocked. A live or uncertain owner cannot be overridden.')}</p>
        {recoveryPreview.reasonCode ? <p>{ru ? 'Причина: ' : 'Reason: '}{recoveryPreview.reasonCode}</p> : null}
        <p>{ru ? `Маркеров в плане: ${recoveryPreview.markers.length}.` : `Markers in this plan: ${recoveryPreview.markers.length}.`}</p>
        <details><summary>{ru ? 'Сведения проверки' : 'Verification details'}</summary>
        <ul>{recoveryPreview.markers.map((marker, index) => <li key={`${marker.kind}:${marker.sha256}:${index}`}>
          {marker.kind} · PID {marker.formerPid}{marker.profileId ? ` · profile ${marker.profileId}` : ''}{marker.epoch ? ` · epoch ${marker.epoch}` : ''} · SHA-256 {marker.sha256}
        </li>)}</ul>
        {recoveryPreview.reviewDigest ? <p>{ru ? 'SHA-256 плана: ' : 'Plan SHA-256: '}{recoveryPreview.reviewDigest}</p> : null}
        </details>
        <p>{ru ? `Прежних неподтверждённых действий: ${recoveryPreview.unsettledActionCount}. Их результат останется неизвестным; повторной отправки не будет.` : `Prior unsettled actions: ${recoveryPreview.unsettledActionCount}. Their outcome remains unknown; they will not be replayed.`}</p>
        {recoveryPreview.state === 'reviewable' && recoveryPreview.reviewDigest ? <>
          <Checkbox checked={recoveryAcknowledged} disabled={disabled || busy || uncertain} onChange={setRecoveryAcknowledged} label={ru ? 'Я проверил этот план и подтверждаю архивирование указанных устаревших маркеров без повтора прежних действий.' : 'I reviewed this plan and approve archiving these stale markers without replaying prior actions.'} />
          <Button disabled={disabled || busy || uncertain || !recoveryAcknowledged} onClick={() => void mutate({ action: 'recover-owner', actionId: crypto.randomUUID(), reviewDigest: recoveryPreview.reviewDigest! })}>{ru ? 'Приостановить инструменты и восстановить' : 'Pause tool connections and recover reviewed owner'}</Button>
        </> : null}
      </> : null}
      {recoveryReceipt ? <div role="status">
        <p>{ru ? 'Квитанция восстановления: ' : 'Recovery receipt: '}{recoveryReceipt.state} · {recoveryReceipt.actionId}</p>
        <p>{ru ? `Архивировано маркеров: ${recoveryReceipt.archivedCount}. Владелец удерживается: ${recoveryReceipt.ownerHeld ? 'да' : 'нет'}. Операция завершена: ${recoveryReceipt.terminal ? 'да' : 'нет'}.` : `Archived markers: ${recoveryReceipt.archivedCount}. Owner held: ${recoveryReceipt.ownerHeld ? 'yes' : 'no'}. Terminal: ${recoveryReceipt.terminal ? 'yes' : 'no'}.`}</p>
        <p>{ru ? `Прежних неподтверждённых действий: ${recoveryReceipt.unsettledActionCount}. Результаты не восстановлены и действия не повторены.` : `Prior unsettled actions: ${recoveryReceipt.unsettledActionCount}. Their results have not been recovered and no actions have been replayed.`}</p>
        {recoveryReceipt.reasonCode ? <p>{ru ? 'Причина: ' : 'Reason: '}{recoveryReceipt.reasonCode}</p> : null}
      </div> : null}
    </section> : null}
    <section className="native-accounts__prepare" aria-label={ru ? 'Новый профиль Native' : 'New Native profile'}>
      <h3>{ru ? 'Новый профиль' : 'New profile'}</h3>
      <TextField label={ru ? 'Название нового профиля' : 'New profile name'} value={label} maxLength={80} disabled={locked} onChange={event => setLabel(event.target.value)} />
      <div className="native-accounts__actions"><Button disabled={locked || !label.trim()} onClick={() => void mutate({ action: 'prepare-profile', actionId: crypto.randomUUID(), label: label.trim() })}>{ru ? 'Подготовить новый профиль' : 'Prepare new profile'}</Button></div>
    </section>
    {!snapshot && !error ? <p role="status">{ru ? 'Читаем статус Native…' : 'Reading Native status…'}</p> : null}
    {snapshot && !snapshot.profiles.length ? <p>{ru ? 'Подготовленных профилей пока нет.' : 'No profiles have been prepared yet.'}</p> : null}
    {snapshot?.profiles.length ? <h3>{ru ? 'Сохранённые профили' : 'Retained profiles'}</h3> : null}
    <ul className="native-accounts__profiles">{snapshot?.profiles.map(profile => {
      const login = profile.login;
      const pending = Boolean(login && pendingStates.has(login.state));
      const showCode = login?.state === 'pending' && login.verificationUrl === verificationUrl && Boolean(login.userCode);
      const mayStart = profile.state === 'fresh' && !pending;
      const inventory = snapshot?.inventory?.receipts.filter(receipt => receipt.profileId === profile.id && receipt.epoch === profile.epoch).at(-1);
      const execution = snapshot?.execution?.profileId === profile.id && snapshot.execution.epoch === profile.epoch && snapshot.execution.ownerHeld ? snapshot.execution : undefined;
      return <li key={profile.id} className="native-accounts__profile">
        <strong>{profile.label}</strong>
        {renaming?.profile.id === profile.id && renaming.profile.epoch === profile.epoch ? <form onSubmit={event => {
          event.preventDefault();
          if (!renaming.label.trim() || renaming.label === renaming.profile.label || locked) return;
          void mutate({ action: 'rename-profile', actionId: crypto.randomUUID(), profileId: renaming.profile.id,
            epoch: renaming.profile.epoch, expectedLabel: renaming.profile.label, label: renaming.label.trim() });
        }}>
          <TextField label={ru ? 'Название профиля Native' : 'Native profile label'} value={renaming.label} maxLength={80}
            disabled={locked} autoFocus onChange={event => setRenaming({ ...renaming, label: event.currentTarget.value })} />
          <div className="native-accounts__actions">
            <Button type="submit" disabled={locked || !renaming.label.trim() || renaming.label.trim() === renaming.profile.label}>{ru ? 'Сохранить название' : 'Save label'}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setRenaming(null)}>{ru ? 'Отмена' : 'Cancel'}</Button>
          </div>
          <p>{ru ? 'Меняется только название; вход и текущее выполнение сохраняются.' : 'Only the label changes; sign-in and current execution are retained.'}</p>
        </form> : null}
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
          <Button variant="ghost" disabled={locked || Boolean(renaming)} onClick={() => setRenaming({ profile, label: profile.label })}>{ru ? 'Переименовать профиль' : 'Rename profile'}</Button>
          {!pending ? <Button variant="ghost" disabled={locked} onClick={() => setRemoving(profile)}>{ru ? 'Удалить профиль' : 'Remove profile'}</Button> : null}
        </div>
      </li>;
    })}</ul>
    {removing ? (() => {
      const owned = snapshot?.execution?.profileId === removing.id && snapshot.execution.epoch === removing.epoch && snapshot.execution.ownerHeld;
      const confirmSignedIn = !unsignedStates.has(removing.state) || Boolean(owned);
      return <RemovalConfirmation eyebrow={removing.label} title={ru ? 'Удалить этот профиль Native?' : 'Remove this Native profile?'}
        keepLabel={ru ? 'Оставить профиль' : 'Keep profile'} confirmLabel={ru ? 'Удалить профиль' : 'Remove profile'} pending={busy}
        acknowledge={confirmSignedIn ? (ru ? 'Я понимаю, что профиль может быть авторизован или выполнять задачи: NEKODEX закроет его выполнение и удалит локальные учётные данные.' : 'I understand this profile may be signed in or running tasks: NEKODEX closes its execution and deletes its local credentials.') : undefined}
        onKeep={() => setRemoving(null)} onConfirm={() => {
          const target = removing; setRemoving(null);
          void mutate({ action: 'remove-profile', actionId: crypto.randomUUID(), profileId: target.id, epoch: target.epoch, ...(confirmSignedIn ? { confirmSignedIn: true } : {}) });
        }}>
        <p>{ru ? 'Профиль, его каталог Codex и приватные данные будут удалены с этого Mac. Сначала будут отозваны и удалены OAuth-провайдеры, зарегистрированные для этого аккаунта. Журнал сохранит запись об удалении. Сеанс входа на стороне OpenAI этим не отзывается.' : 'The profile, its Codex home and private data are deleted from this Mac. OAuth providers registered for this account are revoked and removed first. The journal keeps a removal receipt. This does not revoke the sign-in session on the OpenAI side.'}</p>
        {owned ? <p>{ru ? 'Сначала будет закрыто выполнение этого профиля; текущие Native-задачи и беседы на нём остановятся.' : 'Its execution is closed first; running Native tasks and conversations on it stop.'}</p> : null}
      </RemovalConfirmation>;
    })() : null}
    </PanelStack>
  </Panel>;
}
