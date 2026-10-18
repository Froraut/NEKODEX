import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Notice, Page, Panel, SurfaceHeader, TextField } from './design';
import type { Language } from './types';
import type { BrowserCompanionApi, BrowserCompanionPairing, BrowserCompanionStatus } from './browser-companion-types';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/browser-companion.css';

function copy(language: Language) {
  return language === 'ru' ? {
    title: 'Браузерный companion', subtitle: 'Подключите одну выбранную вкладку Chrome к локальной задаче.', refresh: 'Обновить',
    disabled: 'Выключен', listening: 'Локальный сервер включён', paired: 'Расширение сопряжено', selected: 'Вкладка выбрана', connected: 'Popup подключён', unavailable: 'Недоступен',
    setup: 'Подключение расширения', id: 'ID расширения Chrome', idHint: '32 буквы a–p из карточки проверенного расширения в chrome://extensions.',
    invalidId: 'Введите точный ID расширения: 32 буквы a–p.', enable: 'Включить локальное подключение', disable: 'Выключить',
    enableHint: 'Подключение запускается только этой кнопкой. После перезапуска приложения оно снова выключено.',
    install: 'В профиле Chrome для разработки откройте chrome://extensions, включите режим разработчика и выберите «Загрузить распакованное расширение». Укажите эту папку:',
    missing: 'В этой установке не найден исходный артефакт расширения. Используйте проверенную папку browser-companion из исходников.',
    extensionPath: 'Папка расширения', manifest: 'Manifest',
    create: 'Создать данные сопряжения', pairing: 'Одноразовое сопряжение', copy: 'Скопировать и скрыть', hide: 'Скрыть данные',
    pairingHint: 'Откройте расширение на нужной странице, вставьте эти частные данные, нажмите Pair, затем Select current tab and connect. После копирования код скрывается.',
    copied: 'Данные сопряжения скопированы. Вставьте их в popup расширения.', revoke: 'Отозвать сопряжение',
    instructions: 'Выбор вкладки и приватность', privacy: 'Текст и элементы страницы передаются только после явного выбора вкладки. Закрытие popup прекращает получение действий; Stop sharing отзывает сопряжение. История браузера и данные аккаунтов не копируются.',
    scope: 'Текущая область', noScope: 'Откройте popup расширения и явно выберите текущую вкладку.', tab: 'Вкладка', window: 'Окно', document: 'Документ',
    operation: 'Операция', unknown: 'У ранее отправленного действия нет подтверждённого исхода. Оно не будет автоматически повторено; проверьте его результат.',
    receipt: 'Последняя остановленная операция',
    capabilities: 'Возможности', browser: 'Chrome: наблюдение, click и type по свежим ссылкам выбранной страницы.',
    boundaries: 'Отправка ChatGPT через companion ещё не подключена к владельцу аккаунта/turn. Native desktop требует отдельно настроенного MCP provider; Firefox пока не проверен.',
    error: 'Не удалось выполнить действие', readAfterError: 'Обновите состояние перед следующим действием. Автоматического повтора нет.', runtime: 'Запустите текущий runtime NEKODEX для подключения.',
    loading: 'Чтение состояния…', local: 'Локальный адрес', notAutoInstalled: 'Расширение не устанавливается автоматически. Сначала проверьте его исходники и разрешения.',
  } : {
    title: 'Browser companion', subtitle: 'Connect one selected Chrome tab to a local task.', refresh: 'Refresh',
    disabled: 'Disabled', listening: 'Local listener enabled', paired: 'Extension paired', selected: 'Tab selected', connected: 'Popup connected', unavailable: 'Unavailable',
    setup: 'Connect extension', id: 'Chrome extension ID', idHint: '32 letters a–p from the reviewed extension card in chrome://extensions.',
    invalidId: 'Enter the exact extension ID: 32 letters a–p.', enable: 'Enable local connection', disable: 'Disable',
    enableHint: 'Only this button starts the connection. It is off again after application restart.',
    install: 'In a development Chrome profile, open chrome://extensions, turn on Developer mode and choose Load unpacked. Select this directory:',
    missing: 'This installation does not contain the extension source artifact. Use the reviewed browser-companion directory from the source checkout.',
    extensionPath: 'Extension directory', manifest: 'Manifest',
    create: 'Create pairing details', pairing: 'One-time pairing', copy: 'Copy and hide', hide: 'Hide details',
    pairingHint: 'Invoke the extension on the intended page, paste these private details, choose Pair, then Select current tab and connect. Copying hides this code.',
    copied: 'Pairing details copied. Paste them into the extension popup.', revoke: 'Revoke pairing',
    instructions: 'Tab selection and privacy', privacy: 'Page text and controls are shared only after explicit tab selection. Closing the popup stops receiving actions; Stop sharing revokes pairing. Browser history and account credentials are not copied.',
    scope: 'Current scope', noScope: 'Open the extension popup and explicitly select the current tab.', tab: 'Tab', window: 'Window', document: 'Document',
    operation: 'Operation', unknown: 'A previously dispatched input has no confirmed outcome. It will not be retried automatically; inspect its result.',
    receipt: 'Last stopped operation',
    capabilities: 'Capabilities', browser: 'Chrome: observe, click and type using fresh references from the selected page.',
    boundaries: 'Companion ChatGPT sending is not yet connected to the account/turn owner. Native desktop needs a separately configured MCP provider; Firefox has not been verified.',
    error: 'Action failed', readAfterError: 'Refresh state before the next action. Nothing is retried automatically.', runtime: 'Start the current NEKODEX runtime to connect.',
    loading: 'Reading state…', local: 'Local address', notAutoInstalled: 'The extension is not installed automatically. Review its source and permissions first.',
  };
}

/** The guarded app control owns listener configuration. No browser commands, credentials,
 * automatic installation or account send authority originate in this renderer. */
export function BrowserCompanionSurface({ language, api, disabled = false }: { language: Language; api: BrowserCompanionApi; disabled?: boolean }) {
  const text = copy(language);
  const apiRef = useRef(api); apiRef.current = api;
  const mounted = useRef(true), pendingRef = useRef(false);
  const [state, setState] = useState<BrowserCompanionStatus | null>(null);
  const [extensionId, setExtensionId] = useState('');
  const [pairing, setPairing] = useState<BrowserCompanionPairing | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pairingId = useId();
  const locked = disabled || pending !== null;
  const validId = /^[a-p]{32}$/.test(extensionId);
  const uncertain = state?.companion?.operation?.phase === 'unknown' || state?.lastReceipt?.outcome === 'unknown';
  const update = (value: BrowserCompanionStatus) => {
    if (!mounted.current) return;
    setState(value);
    if (value.extensionId) setExtensionId(value.extensionId);
    if (!value.enabled || value.companion?.paired) setPairing(null);
  };
  async function run(name: string, operation: () => Promise<void>) {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true; setPending(name); setError(null); setNotice(null);
    try { await operation(); }
    catch (cause) { if (mounted.current) setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(null); }
  }
  const refresh = async () => update(await apiRef.current.request({ action: 'status' }) as BrowserCompanionStatus);
  useEffect(() => {
    mounted.current = true;
    if (!disabled) void run('status', refresh);
    return () => { mounted.current = false; };
    // API is read through apiRef; only runtime availability starts a new state read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  const action = (name: 'enable' | 'disable' | 'revoke') => void run(name, async () => {
    setPairing(null);
    if (name === 'enable' && !validId) throw new Error(text.invalidId);
    update(await apiRef.current.request({ action: name, ...(name === 'enable' ? { extensionId } : {}) }) as BrowserCompanionStatus);
  });
  const createPairing = () => void run('pair', async () => {
    setPairing(null);
    const result = await apiRef.current.request({ action: 'create-pairing' }) as { status: BrowserCompanionStatus; pairing: BrowserCompanionPairing };
    update(result.status);
    if (mounted.current) setPairing(result.pairing);
  });
  const copyPairing = () => void run('copy', async () => {
    if (!pairing) return;
    const value = JSON.stringify(pairing);
    if (apiRef.current.copyPairing) {
      if (!(await apiRef.current.copyPairing(value)).copied) throw new Error(text.error);
    } else await navigator.clipboard.writeText(value);
    if (mounted.current) { setPairing(null); setNotice(text.copied); }
  });
  const selected = state?.companion?.selected;
  return <Page width="narrow" className="browser-companion-surface">
    <SurfaceHeader title={text.title} subtitle={text.subtitle} actions={<Button disabled={locked} busy={pending === 'status'} onClick={() => void run('status', refresh)}>{text.refresh}</Button>} />
    {disabled ? <Notice tone="warning">{text.runtime}</Notice> : null}
    {error ? <Notice tone="error" title={text.error}>{error} {text.readAfterError}</Notice> : null}
    {notice ? <Notice>{notice}</Notice> : null}
    {!state && pending ? <p role="status">{text.loading}</p> : null}
    {state ? <div className="browser-companion-badges" aria-live="polite">
      <Badge>{state.state === 'unavailable' ? text.unavailable : state.enabled ? text.listening : text.disabled}</Badge>
      {state.companion?.paired ? <Badge>{text.paired}</Badge> : null}
      {state.companion?.connected ? <Badge>{text.connected}</Badge> : null}
      {selected ? <Badge>{text.selected}</Badge> : null}
    </div> : null}
    {state?.reason ? <Notice tone="warning">{state.reason}</Notice> : null}
    {uncertain ? <Notice tone="warning">{text.unknown}</Notice> : null}
    <Panel title={text.setup}>
      <p>{text.notAutoInstalled}</p>
      {state?.extensionArtifact.available ? <>
        <p>{text.install}</p>
        <dl className="browser-companion-data"><dt>{text.extensionPath}</dt><dd><code>{state.extensionArtifact.directory}</code></dd><dt>{text.manifest}</dt><dd><code>{state.extensionArtifact.manifestPath}</code></dd></dl>
      </> : state ? <Notice tone="warning">{text.missing}</Notice> : null}
      <TextField label={text.id} hint={text.idHint} value={extensionId} autoComplete="off" spellCheck={false} maxLength={32}
        disabled={locked || !!state?.enabled} onChange={event => setExtensionId(event.target.value.trim())} />
      <p className="browser-companion-muted">{text.enableHint}</p>
      <div className="browser-companion-actions">
        <Button variant="primary" disabled={locked || !validId || !!state?.enabled} busy={pending === 'enable'} onClick={() => action('enable')}>{text.enable}</Button>
        <Button disabled={locked || (!state?.enabled && state?.state !== 'unavailable')} busy={pending === 'disable'} onClick={() => action('disable')}>{text.disable}</Button>
      </div>
      {state ? <p>{text.local}: <code>{state.origin}</code></p> : null}
    </Panel>
    <Panel title={text.pairing}>
      <p>{text.pairingHint}</p>
      <div className="browser-companion-actions">
        <Button disabled={locked || !state?.enabled || !!state.companion?.operation} busy={pending === 'pair'} onClick={createPairing}>{text.create}</Button>
        <Button disabled={locked || !state?.enabled} busy={pending === 'revoke'} onClick={() => action('revoke')}>{text.revoke}</Button>
      </div>
      {pairing ? <div className="browser-companion-pairing">
        <label htmlFor={pairingId}>{text.pairing}</label>
        <textarea id={pairingId} readOnly rows={5} value={JSON.stringify(pairing)} autoComplete="off" spellCheck={false} />
        <div className="browser-companion-actions"><Button disabled={locked} busy={pending === 'copy'} onClick={copyPairing}>{text.copy}</Button><Button disabled={locked} onClick={() => setPairing(null)}>{text.hide}</Button></div>
      </div> : null}
    </Panel>
    <Panel title={text.scope}>
      {selected ? <dl className="browser-companion-data"><dt>{text.tab}</dt><dd>{selected.tabId}</dd><dt>{text.window}</dt><dd>{selected.windowId}</dd><dt>{text.document}</dt><dd><code>{selected.documentId}</code></dd></dl> : <p>{text.noScope}</p>}
      {state?.companion?.operation ? <p>{text.operation}: <code>{state.companion.operation.operationId}</code> · {state.companion.operation.phase}</p> : null}
      {state?.lastReceipt ? <p>{text.receipt}: <code>{state.lastReceipt.operationId}</code> · {state.lastReceipt.outcome}</p> : null}
    </Panel>
    <Panel title={text.instructions}><p>{text.privacy}</p></Panel>
    <Panel title={text.capabilities}><p>{text.browser}</p><p>{text.boundaries}</p></Panel>
  </Page>;
}
