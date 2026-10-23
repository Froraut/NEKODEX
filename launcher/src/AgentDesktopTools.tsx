import { Badge, Button, Notice, Panel } from './design';
import type { AgentDesktopToolsProps, DesktopPermission, MacosWindowSelection } from './agent-desktop-types';
import './surfaces/agent-desktop.css';

const sameWindow = (a: MacosWindowSelection, b: MacosWindowSelection) => a.windowId === b.windowId && a.processId === b.processId && a.windowEpoch === b.windowEpoch;
/** The entry the user turns on; equal to the release helper bundle's CFBundleName. */
export const DESKTOP_HELPER_ENTRY = 'NEKODEX Desktop Helper';
/** Ad-hoc DEV builds carry this separate identity (scripts/build-desktop-helper.cjs). */
export const DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER = 'dev.nekodex.desktop-provider.development.v1';

/** Pure cached presentation. Mounting, parent refreshes and task selection never
 * inspect permissions, enumerate native windows, capture or dispatch input. */
export function AgentDesktopTools({ api, desktop, scope, locked, choose, act, refresh }: AgentDesktopToolsProps) {
  const attachments = desktop?.bindings.filter(row => row.taskId === scope?.taskId && row.generation === scope?.generation) ?? [];
  const selected = desktop?.selected;
  const bound = attachments.length > 0;
  const maximum = desktop?.maxWindowsPerTask ?? 8;
  const supported = desktop?.platform === 'darwin';
  const closed = desktop?.state === 'closed';
  const enabled = desktop?.enabled === true;
  // Enabled is the user's preference, not proof that the retained helper still runs.
  // A false readiness value alone can also mean a missing selection or permission.
  const helperUnavailable = enabled && desktop?.available === false && desktop.nativeStatus === null && !!desktop.reason;
  const unavailable = desktop?.state === 'unavailable' || closed || helperUnavailable;
  const send = (body: Record<string, unknown>) => void act(async () => { await api.request(body); await refresh(); });
  const client = desktop?.permissionClient ?? null;
  const entry = client?.name ?? DESKTOP_HELPER_ENTRY;
  const development = client?.bundleIdentifier === DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER;
  const settingsDisabled = locked || !desktop || !supported || closed || helperUnavailable;
  const screenPane = { en: 'Screen & System Audio Recording', ru: 'Запись экрана и системного звука' }, accessibilityPane = { en: 'Accessibility', ru: 'Универсальный доступ' };
  const rows: { permission: DesktopPermission; label: string; granted: boolean | undefined; pane: { en: string; ru: string } }[] = [
    { permission: 'screenCapture', label: choose('Screen recording permission', 'Разрешение записи экрана'), granted: desktop?.permissions?.screenCaptureGranted, pane: screenPane },
    { permission: 'accessibility', label: choose('Accessibility permission (AX)', 'Разрешение универсального доступа (AX)'), granted: desktop?.permissions?.accessibilityGranted, pane: accessibilityPane },
    { permission: 'postEvent', label: choose('Post-event permission — foreground pixel fallback', 'Разрешение отправки событий — ввод по пикселям активного окна'), granted: desktop?.permissions?.postEventGranted, pane: accessibilityPane },
  ];
  const missing = rows.some(row => row.granted === false);
  const permission = (value: boolean | undefined) => value === undefined ? choose('Not inspected', 'Не проверено') : value ? choose('Granted', 'Разрешено системой') : choose('Unavailable', 'Нет системного разрешения');
  return <Panel title={choose('Selected macOS desktop tools', 'Инструменты окон macOS')} className="agent-desktop-tools">
    <p>{choose(`Enable desktop access and add up to ${maximum} exact windows to this task. The model chooses an attached window for each approved read; each click or text input needs a fresh observation of that window. Access is off after a runtime restart.`, `Включите доступ к рабочему столу и добавьте в задачу до ${maximum} точных окон. Модель выбирает прикреплённое окно для каждого подтверждённого чтения; клик или ввод текста требует свежего наблюдения этого окна. После перезапуска среды доступ выключен.`)}</p>
    <div className="agent-desktop-tools__actions">
      <Badge tone={enabled && !unavailable ? 'success' : 'neutral'}>{!desktop ? choose('Status unavailable', 'Состояние недоступно') : unavailable ? choose('Desktop helper unavailable', 'Desktop helper недоступен') : enabled ? choose('Enabled by explicit action', 'Включено явным действием') : choose('Disabled', 'Выключено')}</Badge>
      <Badge tone={bound ? 'success' : 'neutral'}>{bound ? choose(`${attachments.length} windows in this task`, `Окон в задаче: ${attachments.length}`) : choose('No windows in this task', 'В задаче нет окон')}</Badge>
      <span>{choose('Active operations', 'Активные операции')}: {desktop?.activeCount ?? 0}</span>
    </div>
    {!desktop ? <Notice>{choose('Native desktop controller status is unavailable. This panel does not start a helper automatically.', 'Состояние native desktop controller недоступно. Эта панель не запускает helper автоматически.')}</Notice> : !supported ? <Notice tone="warning">{choose('Native desktop control is available only on macOS. This platform is unavailable.', 'Native desktop поддерживается только на macOS. На текущей платформе он недоступен.')}</Notice> : unavailable || desktop.reason ? <Notice tone="warning">
      <p>{desktop.reason ?? choose('The native desktop owner is unavailable.', 'Native desktop owner недоступен.')}</p>
      {unavailable && enabled && !closed ? <p>{choose('Choose Disable and release desktop access, then Enable desktop provider to start a fresh helper and answer its Allow confirmation. Nothing restarts automatically; retained unknown outcomes are not replayed.', 'Нажмите «Выключить и освободить доступ», затем «Включить desktop provider», чтобы запустить новый helper и ответить на его подтверждение Allow. Автоматического перезапуска и повтора сохранённых неизвестных исходов нет.')}</p> : null}
    </Notice> : null}
    <dl className="agent-desktop-tools__permissions">
      {rows.map(row => <div key={row.permission}><dt>{row.label}</dt><dd>{permission(row.granted)}
        {row.granted === false ? <> · <Button size="sm" disabled={settingsDisabled} onClick={() => send({ action: 'openDesktopPermissionSettings', permission: row.permission, explicitUserAction: true })}>{choose(`Open ${row.pane.en}`, `Открыть «${row.pane.ru}»`)}</Button></> : null}
      </dd></div>)}
    </dl>
    {client && !client.selfResponsible ? <Notice tone="warning">{choose(`The helper is not running under its own identity, so macOS is judging the app or terminal that started NEKODEX. Do not grant that app; it would give every process it starts the same access. Update NEKODEX, then inspect again.`, `Helper запущен не под собственным идентификатором, и macOS проверяет приложение или терминал, запустивший NEKODEX. Не выдавайте разрешение ему: тогда доступ получат все его процессы. Обновите NEKODEX и проверьте снова.`)}</Notice> : null}
    {missing ? <Notice>
      <p>{choose(`macOS grants these permissions to "${entry}", not to NEKODEX itself. Use the button next to a missing permission: macOS may first ask about "${entry}", then System Settings opens at Privacy & Security. Turn on "${entry}" in Screen & System Audio Recording and in Accessibility (on macOS 27: Device Control and Data Access), then choose Disable and release desktop access and inspect again: macOS applies a new grant only to a fresh helper process.`, `macOS выдаёт эти разрешения «${entry}», а не самому NEKODEX. Нажмите кнопку рядом с недостающим разрешением: macOS может сначала спросить о «${entry}», затем откроются «Конфиденциальность и безопасность» в Системных настройках. Включите «${entry}» в «Запись экрана и системного звука» и в «Универсальный доступ» (в macOS 27: «Управление устройством и доступ к данным»), затем нажмите «Выключить и освободить доступ» и проверьте снова: новое разрешение macOS применяет только к новому процессу helper.`)}</p>
      <p>{choose(`If "${entry}" is already switched on but the permission still shows as missing, macOS is holding an entry recorded for a different build of the helper; switching it off and on does not repair it. Select "${entry}", remove it with the minus button, then add it again with + and the path below.`, `Если «${entry}» уже включён, а разрешение всё ещё отсутствует, macOS хранит запись, созданную для другой сборки helper; выключение и включение её не исправляет. Выберите «${entry}», удалите кнопкой «минус» и добавьте снова через + по пути ниже.`)}</p>
      {client?.bundlePath ? <p>{choose(`To add "${entry}" with +, press Command-Shift-G and paste this path. It stays the same across NEKODEX updates, and the grant follows the helper's signature, so you grant it once:`, `Чтобы добавить «${entry}» через +, нажмите Command-Shift-G и вставьте этот путь. Он не меняется при обновлениях NEKODEX, а разрешение привязано к подписи helper, поэтому его выдают один раз:`)} <code>{client.bundlePath}</code></p> : null}
      {development ? <p>{choose(`This is an ad-hoc development build with its own entry, "${entry}". Its grant does not apply to signed releases and has to be renewed after each rebuild.`, `Это сборка для разработки с отдельной записью «${entry}». Её разрешение не действует для подписанных релизов и требует повторной выдачи после каждой пересборки.`)}</p> : null}
    </Notice> : null}
    <p className="agent-desktop-tools__muted">{choose(`Enable desktop provider shows an alert from "${entry}" itself, "Allow NEKODEX desktop control?": choose Allow. This is NEKODEX's own confirmation, not a macOS permission request, and it never changes System Settings. It appears once per helper process, so again after Disable and release desktop access or a restart: any app on this Mac could start the helper, and only your answer lets it act. Window titles appear after enabling.`, `«Включить desktop provider» показывает окно самого «${entry}» — «Allow NEKODEX desktop control?»: нажмите «Allow». Это собственное подтверждение NEKODEX, а не системный запрос разрешения, и оно не меняет Системные настройки. Оно появляется один раз на процесс helper, то есть снова после «Выключить и освободить доступ» или перезапуска: helper может запустить любое приложение на этом Mac, а действовать он может только после вашего ответа. Заголовки окон видны после включения.`)}</p>
    <p className="agent-desktop-tools__muted">{choose('Permission values are cached until you inspect them. Inspection never prompts. Only an Open System Settings button asks macOS to list the helper, for that one permission; it never grants access or activates a window. AX supports selected accessible background windows; pixel fallback is restricted to the selected foreground window.', 'Разрешения показаны из последней явной проверки. Проверка не вызывает системный запрос. Только кнопка открытия Системных настроек просит macOS добавить helper в список для одного разрешения; она не выдаёт доступ и не активирует окна. AX поддерживает выбранные доступные фоновые окна; ввод по пикселям ограничен выбранным активным окном.')}</p>
    <div className="agent-desktop-tools__actions">
      <Button disabled={locked || !desktop || !supported || closed || helperUnavailable} onClick={() => send({ action: 'inspectDesktopPermissions', explicitUserAction: true })}>{choose('Inspect permissions without prompting', 'Проверить разрешения без системного запроса')}</Button>
      <Button disabled={locked || !desktop || !supported || closed || helperUnavailable} onClick={() => send({ action: 'listDesktopWindows', explicitUserAction: true })}>{choose('List window metadata', 'Получить список окон')}</Button>
      <Button disabled={locked || !desktop || !supported || closed || enabled} onClick={() => send({ action: 'setDesktopEnabled', enabled: true, explicitUserAction: true })}>{choose('Enable desktop provider', 'Включить desktop provider')}</Button>
      <Button disabled={locked || !desktop || (!enabled && !desktop.created)} onClick={() => send({ action: 'setDesktopEnabled', enabled: false, explicitUserAction: true })}>{choose('Disable and release desktop access', 'Выключить и освободить доступ')}</Button>
    </div>
    {selected ? <div className="agent-desktop-tools__selection"><strong>{choose('Last selected native window', 'Последнее выбранное окно')}</strong><span>{choose('Window', 'Окно')}: {selected.windowId} · {choose('Process identity', 'Идентификатор процесса')}: {selected.processId}</span><code>{selected.windowEpoch}</code>
      {desktop?.nativeStatus?.selectionCurrent === false ? <Notice tone="warning">{choose('The selected window is no longer current. List windows again and attach the exact new identity.', 'Выбранное окно больше не актуально. Обновите список и прикрепите точный новый идентификатор.')}</Notice> : null}
    </div> : null}
    {!scope ? <p className="agent-desktop-tools__muted">{choose('Select an owned Agent task above before attaching a window.', 'Перед привязкой окна выберите Agent-задачу выше.')}</p> : <p className="agent-desktop-tools__muted">{choose('Task generation', 'Поколение задачи')}: <code>{scope.taskId}</code> / {scope.generation}</p>}
    {attachments.length ? <>
      <h3>{choose('This task’s window set', 'Набор окон этой задачи')} · {attachments.length}/{maximum}</h3>
      <ul className="agent-desktop-tools__windows">{attachments.map(attachment => {
        const row = desktop?.windows.find(window => sameWindow(window, attachment.selection));
        const selection = attachment.selection;
        return <li key={`${selection.windowId}:${selection.processId}:${selection.windowEpoch}`}>
          <strong>{row ? `${row.owner}${row.title ? ` · ${row.title}` : ''}` : choose(`Window ${selection.windowId}`, `Окно ${selection.windowId}`)}</strong>
          <span>{choose('Window', 'Окно')}: {selection.windowId} · {choose('Process', 'Процесс')}: {selection.processId}</span>
          <div><Button size="sm" disabled={locked || !scope} onClick={() => send({ action: 'revokeDesktopTools', scope, expectedSelection: selection, explicitUserAction: true })}>{choose('Remove this window', 'Убрать это окно')}</Button></div>
        </li>;
      })}</ul>
    </> : null}
    {unavailable && desktop?.windows.length ? <Notice>{choose('The window list below is cached. The unavailable helper cannot confirm these windows or add them to this task.', 'Список окон ниже сохранён в кэше. Недоступный helper не может подтвердить эти окна или добавить их в задачу.')}</Notice> : null}
    {desktop?.windows.length ? <ul className="agent-desktop-tools__windows">{desktop.windows.map(row => {
      const selection = { windowId: row.windowId, processId: row.processId, windowEpoch: row.windowEpoch };
      const attached = attachments.some(attachment => sameWindow(attachment.selection, selection));
      return <li key={`${row.windowId}:${row.processId}:${row.windowEpoch}`}>
        <strong>{row.owner}{row.title ? ` · ${row.title}` : ''}</strong>
        <span>{row.foreground ? choose('Foreground', 'Активное окно') : choose('Background', 'Фоновое окно')} · {choose('Window', 'Окно')}: {row.windowId} · {choose('Process', 'Процесс')}: {row.processId}</span>
        <code>{row.windowEpoch}</code>
        <div><Button size="sm" disabled={locked || !scope || !enabled || !supported || attached || unavailable || attachments.length >= maximum} onClick={() => send({ action: 'selectDesktopWindow', scope, expectedSelection: selection, explicitUserAction: true })}>{attached ? choose('In this task', 'В этой задаче') : choose('Add this window to the task', 'Добавить окно в задачу')}</Button></div>
      </li>;
    })}</ul> : <p className="agent-desktop-tools__muted">{choose('The cached window list is empty. Use List window metadata to refresh it. No screenshot is read on this screen.', 'Сохранённый список окон пуст. Обновите его кнопкой «Получить список окон». Снимки экрана на этой панели не читаются.')}</p>}
    <div><Button disabled={locked || !scope || !bound} onClick={() => send({ action: 'revokeDesktopTools', scope, explicitUserAction: true })}>{choose('Remove all windows from this task', 'Убрать все окна из задачи')}</Button></div>
    {bound ? <Notice>{choose('Adding and switching attached windows uses the same enabled helper without another Allow. Each approved read names one exact window from this set. Switching windows consumes the previous screenshot: observe again before input, and re-read AX element identities before verifying a property after a switch. Foreground pixel input waits for you to return that exact window; the helper never activates it. Input receipts still need separate application-result verification.', 'Добавление и переключение прикреплённых окон использует тот же включённый helper без нового Allow. Каждый подтверждённый запрос чтения указывает одно точное окно набора. После переключения прежний снимок недействителен: перед вводом нужно новое наблюдение, а перед проверкой свойства — заново прочитать AX-элементы окна. Ввод по пикселям ждёт возврата точного окна на передний план; helper сам его не активирует. Квитанция ввода по-прежнему требует отдельной проверки результата в приложении.')}</Notice> : null}
    <Notice>{choose('Screenshots, AX reads and input start only after you approve the model’s exact retained pending tool call in the approval panel. An input receipt proves only that input was dispatched; the application result needs separate observation and verification. Unknown effects are retained without automatic replay.', 'Снимки, чтение AX и ввод начинаются только после подтверждения точного сохранённого запроса инструмента от модели в панели подтверждений. Квитанция ввода подтверждает только отправку события; результат в приложении требует отдельного наблюдения и проверки. Неизвестный исход сохраняется без автоматического повтора.')}</Notice>
  </Panel>;
}
