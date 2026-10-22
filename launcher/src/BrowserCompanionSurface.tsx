import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Notice, Page, Panel, Select, SurfaceHeader, TextField } from './design';
import type { Language } from './types';
import { BROWSER_COMPANION_CHROME_ID, BROWSER_COMPANION_FIREFOX_ID, type BrowserCompanionApi, type BrowserCompanionChatGptBind, type BrowserCompanionPairing, type BrowserCompanionStatus } from './browser-companion-types';

/** Explicit attestation of what the bound ChatGPT tab visibly has selected, with the model version
 * the matching NEKODEX model rows request (GPT-5.6 Sol levels 5.6, GPT-6 Astra Pro 6, Luna none). */
const CHATGPT_MODES: { id: string; label: string; value: BrowserCompanionChatGptBind; version?: string }[] = [
  { id: 'sol-low', label: 'Sol · Instant', value: { modelId: 'gpt-5.6-sol', reasoning: 'low' }, version: '5.6' },
  { id: 'sol-medium', label: 'Sol · Medium', value: { modelId: 'gpt-5.6-sol', reasoning: 'medium' }, version: '5.6' },
  { id: 'sol-high', label: 'Sol · High', value: { modelId: 'gpt-5.6-sol', reasoning: 'high' }, version: '5.6' },
  { id: 'sol-xhigh', label: 'Sol · Extra High', value: { modelId: 'gpt-5.6-sol', reasoning: 'xhigh' }, version: '5.6' },
  { id: 'sol-max', label: 'Sol · Pro', value: { modelId: 'gpt-5.6-sol', reasoning: 'max' }, version: '6' },
  { id: 'luna-low', label: 'Luna', value: { modelId: 'gpt-5.6-luna', reasoning: 'low' } },
  { id: 'luna-medium', label: 'Luna · Think', value: { modelId: 'gpt-5.6-luna', reasoning: 'medium' } },
];
const DEFAULT_CHATGPT_MODE = 'sol-high';
const modeVersion = (id: string) => CHATGPT_MODES.find(row => row.id === id)?.version ?? '';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/browser-companion.css';

function copy(language: Language) {
  return language === 'ru' ? {
    title: 'Браузерный companion', subtitle: 'Подключите одну выбранную вкладку Chrome или Firefox к локальной задаче.', refresh: 'Обновить',
    disabled: 'Выключен', listening: 'Локальный сервер включён', paired: 'Расширение сопряжено', selected: 'Вкладка выбрана', connected: 'Popup подключён', unavailable: 'Недоступен',
    setup: 'Подключение расширения', id: 'ID расширения', idHint: `Chrome: проверенное расширение всегда загружается с ID ${BROWSER_COMPANION_CHROME_ID}; сверьте его в chrome://extensions. Firefox 153+: ${BROWSER_COMPANION_FIREFOX_ID} из popup.`,
    extensionOrigin: 'Origin расширения Firefox (moz-extension://UUID)', originHint: 'Точный moz-extension://UUID из popup расширения. Для Chrome оставьте пустым.',
    invalidId: `Для Chrome подходит только ID проверенного расширения ${BROWSER_COMPANION_CHROME_ID}. Для Firefox введите ${BROWSER_COMPANION_FIREFOX_ID} и его moz-extension://UUID.`, enable: 'Включить локальное подключение', disable: 'Выключить',
    enableHint: 'Подключение запускается только этой кнопкой. После перезапуска приложения оно снова выключено.',
    install: 'В профиле Chrome для разработки откройте chrome://extensions, включите режим разработчика и выберите «Загрузить распакованное расширение». Укажите эту папку:',
    stableId: 'ID расширения не зависит от папки и версии NEKODEX: после обновления загрузите новую папку так же, и Chrome заменит прежнюю под тем же ID.',
    firefoxInstall: 'Для Firefox 153+ подготовьте Firefox-артефакт расширения, затем откройте about:debugging#/runtime/this-firefox и выберите «Загрузить временное дополнение», указав его manifest.json. Файл manifest.firefox.json из исходников нужно сначала преобразовать сборкой; показанная папка Chrome не является готовым Firefox-артефактом.',
    missing: 'В этой установке не найден исходный артефакт расширения. Используйте проверенную папку browser-companion из исходников.',
    extensionPath: 'Папка расширения Chrome', manifest: 'Manifest',
    create: 'Создать данные сопряжения', pairing: 'Одноразовое сопряжение', copy: 'Скопировать и скрыть', hide: 'Скрыть данные',
    pairingHint: 'Откройте расширение на нужной странице, вставьте эти частные данные, нажмите Pair, затем Select current tab and connect. После копирования код скрывается.',
    copied: 'Данные сопряжения скопированы. Вставьте их в popup расширения.', revoke: 'Отозвать сопряжение',
    instructions: 'Выбор вкладки и приватность', privacy: 'Текст и элементы страницы передаются только после явного выбора вкладки. Закрытие popup прекращает получение действий; Stop sharing отзывает сопряжение. История браузера и данные аккаунтов не копируются.',
    scope: 'Текущая область', noScope: 'Откройте popup расширения и явно выберите текущую вкладку.', tab: 'Вкладка', window: 'Окно', document: 'Документ',
    operation: 'Операция', unknown: 'У ранее отправленного действия нет подтверждённого исхода. Оно не будет автоматически повторено; проверьте его результат.',
    receipt: 'Последняя остановленная операция',
    capabilities: 'Возможности', browser: 'Chrome и Firefox 153+: наблюдение, click и type по свежим ссылкам выбранной страницы.',
    boundaries: 'Отправка ChatGPT через companion работает только для явно привязанной вкладки chatgpt.com и текстовых задач Browser-only. Настройка native desktop выполняется отдельно. Приёмка настоящего Firefox остаётся отдельной проверкой.',
    chatgpt: 'Отправка в ChatGPT', chatgptHint: 'Выберите в расширении вкладку chatgpt.com с новым чатом, выставьте в ней нужную модель и укажите здесь ту же модель. Перед каждой отправкой NEKODEX проверяет аккаунт, видимую модель и пустой новый чат; иначе ничего не отправляется. Для каждого следующего сообщения откройте в этой вкладке новый чат.',
    chatgptRouting: 'В привязанную вкладку идут только запросы Chat Completions Локального API с заголовком ниже. Все остальные задачи и клиенты по-прежнему работают через встроенный браузер. Запрос с другим отпечатком аккаунта, другой моделью или с функциями отклоняется без отправки.',
    optIn: 'Заголовок запроса',
    chatgptMode: 'Модель, выбранная во вкладке', chatgptFamily: 'Версия модели', chatgptFamilyHint: 'Заполняется по выбранной модели: уровни GPT-5.6 Sol — 5.6, Pro (GPT-6 Astra) — 6. Меняйте, только если запросы закрепляют другую версию. У Luna версии нет.',
    chatgptFamilyRequired: 'Укажите версию модели, например 5.6: запросы к этой модели её передают, и без неё каждая отправка будет отклонена.',
    bind: 'Привязать вкладку ChatGPT', unbind: 'Отвязать', bound: 'Вкладка ChatGPT привязана', unbound: 'Вкладка ChatGPT не привязана', sending: 'Идёт отправка', held: 'Исход удержан',
    account: 'Аккаунт (отпечаток)', visibleModel: 'Видимая модель', release: 'Я проверил вкладку, снять удержание',
    heldText: 'У отправленного через companion сообщения нет подтверждённого исхода. Оно никогда не отправляется повторно; новые запросы к этой вкладке отклоняются, пока вы не проверите её и не снимете удержание. Остальные задачи идут через встроенный браузер.',
    lastTurn: 'Последний ход', userMessage: 'Сообщение', assistantMessage: 'Ответ',
    error: 'Не удалось выполнить действие', readAfterError: 'Обновите состояние перед следующим действием. Автоматического повтора нет.', runtime: 'Запустите текущий runtime NEKODEX для подключения.',
    loading: 'Чтение состояния…', local: 'Локальный адрес', notAutoInstalled: 'Расширение не устанавливается автоматически. Сначала проверьте его исходники и разрешения.',
  } : {
    title: 'Browser companion', subtitle: 'Connect one selected Chrome or Firefox tab to a local task.', refresh: 'Refresh',
    disabled: 'Disabled', listening: 'Local listener enabled', paired: 'Extension paired', selected: 'Tab selected', connected: 'Popup connected', unavailable: 'Unavailable',
    setup: 'Connect extension', id: 'Extension ID', idHint: `Chrome: the reviewed companion always loads with ID ${BROWSER_COMPANION_CHROME_ID}; check that chrome://extensions shows it. Firefox 153+: ${BROWSER_COMPANION_FIREFOX_ID} from the popup.`,
    extensionOrigin: 'Firefox extension origin (moz-extension://UUID)', originHint: 'Exact moz-extension://UUID shown in the extension popup. Leave empty for Chrome.',
    invalidId: `Chrome accepts only the reviewed companion ID ${BROWSER_COMPANION_CHROME_ID}. For Firefox, enter ${BROWSER_COMPANION_FIREFOX_ID} with its moz-extension://UUID.`, enable: 'Enable local connection', disable: 'Disable',
    enableHint: 'Only this button starts the connection. It is off again after application restart.',
    install: 'In a development Chrome profile, open chrome://extensions, turn on Developer mode and choose Load unpacked. Select this directory:',
    stableId: 'The extension ID does not depend on this directory or the NEKODEX version: after an update, load the new directory the same way and Chrome replaces the previous one under the same ID.',
    firefoxInstall: 'For Firefox 153+, prepare the Firefox extension artifact, open about:debugging#/runtime/this-firefox and choose Load Temporary Add-on with its manifest.json. The source manifest.firefox.json must first be prepared by the build; the Chrome directory shown by this runtime is not a ready Firefox artifact.',
    missing: 'This installation does not contain the extension source artifact. Use the reviewed browser-companion directory from the source checkout.',
    extensionPath: 'Chrome extension directory', manifest: 'Manifest',
    create: 'Create pairing details', pairing: 'One-time pairing', copy: 'Copy and hide', hide: 'Hide details',
    pairingHint: 'Invoke the extension on the intended page, paste these private details, choose Pair, then Select current tab and connect. Copying hides this code.',
    copied: 'Pairing details copied. Paste them into the extension popup.', revoke: 'Revoke pairing',
    instructions: 'Tab selection and privacy', privacy: 'Page text and controls are shared only after explicit tab selection. Closing the popup stops receiving actions; Stop sharing revokes pairing. Browser history and account credentials are not copied.',
    scope: 'Current scope', noScope: 'Open the extension popup and explicitly select the current tab.', tab: 'Tab', window: 'Window', document: 'Document',
    operation: 'Operation', unknown: 'A previously dispatched input has no confirmed outcome. It will not be retried automatically; inspect its result.',
    receipt: 'Last stopped operation',
    capabilities: 'Capabilities', browser: 'Chrome and Firefox 153+: observe, click and type using fresh references from the selected page.',
    boundaries: 'Companion ChatGPT sending works only for an explicitly bound chatgpt.com tab and Browser-only text turns. Native desktop is configured separately. Live Firefox acceptance remains a separate check.',
    chatgpt: 'ChatGPT send', chatgptHint: 'Select a chatgpt.com tab with a new chat in the extension, choose the model in that tab, and pick the same model here. Before every send NEKODEX checks the account, the visible model and an empty new chat; otherwise nothing is sent. Open a new chat in that tab before each further message.',
    chatgptRouting: 'Only Local API Chat Completions requests that carry the header below go to the bound tab. Every other task and client keeps using the built-in browser. A request with another account fingerprint, another model or functions is refused without sending.',
    optIn: 'Request header',
    chatgptMode: 'Model selected in the tab', chatgptFamily: 'Model version', chatgptFamilyHint: 'Filled in from the selected model: GPT-5.6 Sol levels are 5.6 and Pro (GPT-6 Astra) is 6. Change it only if your requests pin another version. Luna has no version.',
    chatgptFamilyRequired: 'Enter the model version, for example 5.6: requests for this model carry it, and without it every send is refused.',
    bind: 'Bind ChatGPT tab', unbind: 'Unbind', bound: 'ChatGPT tab bound', unbound: 'ChatGPT tab not bound', sending: 'Sending', held: 'Outcome held',
    account: 'Account (fingerprint)', visibleModel: 'Visible model', release: 'I checked the tab, release the hold',
    heldText: 'A message sent through the companion has no confirmed outcome. It is never resent; new requests for this tab are refused until you inspect it and release the hold. Other tasks keep using the built-in browser.',
    lastTurn: 'Last turn', userMessage: 'Message', assistantMessage: 'Answer',
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
  const [extensionId, setExtensionId] = useState(BROWSER_COMPANION_CHROME_ID);
  const [extensionOrigin, setExtensionOrigin] = useState('');
  const [pairing, setPairing] = useState<BrowserCompanionPairing | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatGptMode, setChatGptMode] = useState(DEFAULT_CHATGPT_MODE);
  const [chatGptFamily, setChatGptFamily] = useState(() => modeVersion(DEFAULT_CHATGPT_MODE));
  const [notice, setNotice] = useState<string | null>(null);
  const pairingId = useId(), modeId = useId();
  const locked = disabled || pending !== null;
  const firefox = extensionId === BROWSER_COMPANION_FIREFOX_ID;
  // NEKODEX pins the reviewed artifacts: the key-derived Chrome ID, or the Firefox ID plus its profile origin.
  const validId = extensionId === BROWSER_COMPANION_CHROME_ID && (!extensionOrigin || extensionOrigin === `chrome-extension://${extensionId}`)
    || firefox && /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(extensionOrigin);
  const chatGptVersion = modeVersion(chatGptMode);
  // Sol/Pro requests carry their model version, so a binding without it would refuse every send.
  const chatGptFamilyValid = chatGptVersion ? /^\d{1,2}(?:\.\d{1,2})?$/.test(chatGptFamily) : chatGptFamily === '';
  const uncertain = state?.companion?.operation?.phase === 'unknown' || state?.lastReceipt?.outcome === 'unknown';
  const update = (value: BrowserCompanionStatus) => {
    if (!mounted.current) return;
    setState(value);
    if (value.extensionId) { setExtensionId(value.extensionId); setExtensionOrigin(value.extensionOrigin || ''); }
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
    update(await apiRef.current.request({ action: name, ...(name === 'enable' ? { extensionId, ...(extensionOrigin ? { extensionOrigin } : {}) } : {}) }) as BrowserCompanionStatus);
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
  const bindChatGpt = () => void run('bind-chatgpt', async () => {
    const mode = CHATGPT_MODES.find(row => row.id === chatGptMode)!;
    if (!chatGptFamilyValid) throw new Error(text.chatgptFamilyRequired);
    update(await apiRef.current.request({ action: 'bind-chatgpt', chatgpt: { ...mode.value, ...(mode.version ? { modelFamily: chatGptFamily } : {}) } }) as BrowserCompanionStatus);
  });
  const unbindChatGpt = () => void run('unbind-chatgpt', async () => update(await apiRef.current.request({ action: 'unbind-chatgpt' }) as BrowserCompanionStatus));
  const releaseHeld = (operationId: string) => void run('release-chatgpt-held', async () => update(await apiRef.current.request({ action: 'release-chatgpt-held', operationId }) as BrowserCompanionStatus));
  const selected = state?.companion?.selected;
  const chat = state?.chatGpt;
  return <Page width="narrow" className="browser-companion-surface">
    <SurfaceHeader title={text.title} subtitle={text.subtitle} actions={<Button disabled={locked} busy={pending === 'status'} onClick={() => void run('status', refresh)}>{text.refresh}</Button>} />
    {disabled ? <Notice tone="warning">{text.runtime}</Notice> : null}
    {error ? <Notice tone="error" title={text.error}>{error} {text.readAfterError}</Notice> : null}
    {notice ? <Notice>{notice}</Notice> : null}
    {!state && pending ? <p role="status">{text.loading}</p> : null}
    {state ? <BadgeRow aria-live="polite">
      <Badge>{state.state === 'unavailable' ? text.unavailable : state.enabled ? text.listening : text.disabled}</Badge>
      {state.companion?.paired ? <Badge>{text.paired}</Badge> : null}
      {state.companion?.connected ? <Badge>{text.connected}</Badge> : null}
      {selected ? <Badge>{text.selected}</Badge> : null}
    </BadgeRow> : null}
    {state?.reason ? <Notice tone="warning">{state.reason}</Notice> : null}
    {uncertain ? <Notice tone="warning">{text.unknown}</Notice> : null}
    <Panel title={text.setup}>
      <p>{text.notAutoInstalled}</p>
      {firefox ? <p>{text.firefoxInstall}</p> : state?.extensionArtifact.available ? <>
        <p>{text.install}</p>
        <dl className="browser-companion-data"><dt>{text.extensionPath}</dt><dd><code>{state.extensionArtifact.directory}</code></dd><dt>{text.manifest}</dt><dd><code>{state.extensionArtifact.manifestPath}</code></dd></dl>
        <p className="browser-companion-muted">{text.stableId}</p>
      </> : state ? <Notice tone="warning">{text.missing}</Notice> : null}
      <TextField label={text.id} hint={text.idHint} error={extensionId && !validId && !state?.enabled ? text.invalidId : undefined} value={extensionId} autoComplete="off" spellCheck={false} maxLength={128}
        disabled={locked || !!state?.enabled} onChange={event => setExtensionId(event.target.value.trim())} />
      <TextField label={text.extensionOrigin} hint={text.originHint} value={extensionOrigin} autoComplete="off" spellCheck={false} maxLength={160}
        disabled={locked || !!state?.enabled} onChange={event => setExtensionOrigin(event.target.value.trim())} />
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
        <textarea id={pairingId} readOnly rows={5} wrap="soft" value={JSON.stringify(pairing)} autoComplete="off" spellCheck={false} />
        <div className="browser-companion-actions"><Button disabled={locked} busy={pending === 'copy'} onClick={copyPairing}>{text.copy}</Button><Button disabled={locked} onClick={() => setPairing(null)}>{text.hide}</Button></div>
      </div> : null}
    </Panel>
    <Panel title={text.scope}>
      {selected ? <dl className="browser-companion-data"><dt>{text.tab}</dt><dd>{selected.tabId}</dd><dt>{text.window}</dt><dd>{selected.windowId}</dd><dt>{text.document}</dt><dd><code>{selected.documentId}</code></dd></dl> : <p>{text.noScope}</p>}
      {state?.companion?.operation ? <p>{text.operation}: <code>{state.companion.operation.operationId}</code> · {state.companion.operation.phase}</p> : null}
      {state?.lastReceipt ? <p>{text.receipt}: <code>{state.lastReceipt.operationId}</code> · {state.lastReceipt.outcome}</p> : null}
    </Panel>
    <Panel title={text.chatgpt}>
      <p>{text.chatgptHint}</p>
      <p>{text.chatgptRouting}</p>
      {chat ? <BadgeRow aria-live="polite"><Badge>{chat.state === 'held' ? text.held : chat.state === 'sending' ? text.sending : chat.state === 'bound' ? text.bound : text.unbound}</Badge></BadgeRow> : null}
      {chat?.held ? <Notice tone="warning">{text.heldText} <code>{chat.held.operationId}</code> · {chat.held.reason}
        <div className="browser-companion-actions"><Button disabled={locked} busy={pending === 'release-chatgpt-held'} onClick={() => releaseHeld(chat.held!.operationId)}>{text.release}</Button></div></Notice> : null}
      {chat?.bound ? <dl className="browser-companion-data">
        <dt>{text.chatgptMode}</dt><dd>{chat.bound.modelId} · {chat.bound.reasoning}{chat.bound.modelFamily ? ` · ${chat.bound.modelFamily}` : ''}</dd>
        <dt>{text.visibleModel}</dt><dd>{chat.bound.modelLabel}</dd>
        <dt>{text.account}</dt><dd><code>{chat.bound.accountFingerprint}</code></dd>
        <dt>{text.optIn}</dt><dd><code>X-NEKODEX-Companion-Account: {chat.bound.accountFingerprint}</code></dd>
        <dt>{text.tab}</dt><dd>{chat.bound.tabId}</dd><dt>{text.document}</dt><dd><code>{chat.bound.documentId}</code></dd>
      </dl> : <>
        <div className="nk-field"><label htmlFor={modeId}>{text.chatgptMode}</label>
          <Select id={modeId} value={chatGptMode} disabled={locked} options={CHATGPT_MODES.map(mode => ({ value: mode.id, label: mode.label }))}
            onChange={value => { setChatGptMode(value); setChatGptFamily(modeVersion(value)); }} /></div>
        <TextField label={text.chatgptFamily} hint={text.chatgptFamilyHint} error={chatGptFamilyValid ? undefined : text.chatgptFamilyRequired} value={chatGptFamily}
          autoComplete="off" spellCheck={false} maxLength={5} required={!!chatGptVersion}
          disabled={locked || !chatGptVersion} onChange={event => setChatGptFamily(event.target.value.trim())} />
      </>}
      <div className="browser-companion-actions">
        <Button variant="primary" disabled={locked || !selected || !!chat?.bound || !!chat?.held || !chatGptFamilyValid} busy={pending === 'bind-chatgpt'} onClick={bindChatGpt}>{text.bind}</Button>
        <Button disabled={locked || !chat?.bound} busy={pending === 'unbind-chatgpt'} onClick={unbindChatGpt}>{text.unbind}</Button>
      </div>
      {chat?.lastTurn ? <p>{text.lastTurn}: {text.userMessage} <code>{chat.lastTurn.userMessageId}</code>{chat.lastTurn.assistantMessageId ? <> · {text.assistantMessage} <code>{chat.lastTurn.assistantMessageId}</code></> : null}</p> : null}
    </Panel>
    <Panel title={text.instructions}><p>{text.privacy}</p></Panel>
    <Panel title={text.capabilities}><p>{text.browser}</p><p>{text.boundaries}</p></Panel>
  </Page>;
}
