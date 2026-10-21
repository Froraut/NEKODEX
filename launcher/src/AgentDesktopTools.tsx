import { Badge, Button, Notice, Panel } from './design';
import type { AgentDesktopToolsProps, DesktopPermission, MacosWindowSelection } from './agent-desktop-types';
import './surfaces/agent-desktop.css';

const sameWindow = (a: MacosWindowSelection, b: MacosWindowSelection) => a.windowId === b.windowId && a.processId === b.processId && a.windowEpoch === b.windowEpoch;
/** The entry the user turns on; equal to the helper bundle's CFBundleName. */
export const DESKTOP_HELPER_ENTRY = 'NEKODEX Desktop Helper';

/** Pure cached presentation. Mounting, parent refreshes and task selection never
 * inspect permissions, enumerate native windows, capture or dispatch input. */
export function AgentDesktopTools({ api, desktop, scope, locked, choose, act, refresh }: AgentDesktopToolsProps) {
  const attachment = desktop?.bindings.find(row => row.taskId === scope?.taskId && row.generation === scope?.generation);
  const selected = desktop?.selected;
  const bound = Boolean(attachment && selected && sameWindow(attachment.selection, selected));
  const supported = desktop?.platform === 'darwin';
  const closed = desktop?.state === 'closed';
  const enabled = desktop?.enabled === true;
  const send = (body: Record<string, unknown>) => void act(async () => { await api.request(body); await refresh(); });
  const client = desktop?.permissionClient ?? null;
  const settingsDisabled = locked || !desktop || !supported || closed;
  const screenPane = { en: 'Screen & System Audio Recording', ru: 'Запись экрана и системного звука' }, accessibilityPane = { en: 'Accessibility', ru: 'Универсальный доступ' };
  const rows: { permission: DesktopPermission; label: string; granted: boolean | undefined; pane: { en: string; ru: string } }[] = [
    { permission: 'screenCapture', label: choose('Screen recording permission', 'Разрешение записи экрана'), granted: desktop?.permissions?.screenCaptureGranted, pane: screenPane },
    { permission: 'accessibility', label: choose('Accessibility permission (AX)', 'Разрешение универсального доступа (AX)'), granted: desktop?.permissions?.accessibilityGranted, pane: accessibilityPane },
    { permission: 'postEvent', label: choose('Post-event permission — foreground pixel fallback', 'Разрешение отправки событий — ввод по пикселям активного окна'), granted: desktop?.permissions?.postEventGranted, pane: accessibilityPane },
  ];
  const missing = rows.some(row => row.granted === false);
  const permission = (value: boolean | undefined) => value === undefined ? choose('Not inspected', 'Не проверено') : value ? choose('Granted', 'Разрешено системой') : choose('Unavailable', 'Нет системного разрешения');
  return <Panel title={choose('Selected macOS desktop tools', 'Инструменты выбранного окна macOS')} className="agent-desktop-tools">
    <p>{choose('Desktop access is off by default and after a runtime restart. Inspect permissions and window metadata explicitly, then enable the provider and attach one exact window to the selected task generation.', 'Доступ к рабочему столу по умолчанию и после перезапуска среды выключен. Явно проверьте разрешения и список окон, включите provider и прикрепите одно точное окно к выбранному поколению задачи.')}</p>
    <div className="agent-desktop-tools__actions">
      <Badge tone={enabled ? 'success' : 'neutral'}>{!desktop ? choose('Status unavailable', 'Состояние недоступно') : enabled ? choose('Enabled by explicit action', 'Включено явным действием') : choose('Disabled', 'Выключено')}</Badge>
      <Badge tone={bound ? 'success' : 'neutral'}>{bound ? choose('Attached to this task generation', 'Прикреплено к этому поколению') : choose('No current task attachment', 'Нет привязки к текущему поколению')}</Badge>
      <span>{choose('Active operations', 'Активные операции')}: {desktop?.activeCount ?? 0}</span>
    </div>
    {!desktop ? <Notice>{choose('Native desktop controller status is unavailable. This panel does not start a helper automatically.', 'Состояние native desktop controller недоступно. Эта панель не запускает helper автоматически.')}</Notice> : !supported ? <Notice tone="warning">{choose('Native desktop control is available only on macOS. This platform is unavailable.', 'Native desktop поддерживается только на macOS. На текущей платформе он недоступен.')}</Notice> : desktop.state === 'unavailable' || closed ? <Notice tone="warning">{desktop.reason ?? choose('The native desktop owner is unavailable.', 'Native desktop owner недоступен.')}</Notice> : null}
    <dl className="agent-desktop-tools__permissions">
      {rows.map(row => <div key={row.permission}><dt>{row.label}</dt><dd>{permission(row.granted)}
        {row.granted === false ? <> · <Button size="sm" disabled={settingsDisabled} onClick={() => send({ action: 'openDesktopPermissionSettings', permission: row.permission, explicitUserAction: true })}>{choose(`Open ${row.pane.en}`, `Открыть «${row.pane.ru}»`)}</Button></> : null}
      </dd></div>)}
    </dl>
    {client && !client.selfResponsible ? <Notice tone="warning">{choose(`The helper is not running under its own identity, so macOS is judging the app or terminal that started NEKODEX. Do not grant that app; it would give every process it starts the same access. Update NEKODEX, then inspect again.`, `Helper запущен не под собственным идентификатором, и macOS проверяет приложение или терминал, запустивший NEKODEX. Не выдавайте разрешение ему: тогда доступ получат все его процессы. Обновите NEKODEX и проверьте снова.`)}</Notice> : null}
    {missing ? <Notice>
      <p>{choose(`macOS grants these permissions to "${DESKTOP_HELPER_ENTRY}", not to NEKODEX itself. Use the button next to a missing permission: macOS may first ask about "${DESKTOP_HELPER_ENTRY}", then System Settings opens at Privacy & Security. Turn on "${DESKTOP_HELPER_ENTRY}" in Screen & System Audio Recording and in Accessibility, then choose Disable and release desktop access and inspect again: macOS applies a new screen recording grant only to a fresh helper process.`, `macOS выдаёт эти разрешения «${DESKTOP_HELPER_ENTRY}», а не самому NEKODEX. Нажмите кнопку рядом с недостающим разрешением: macOS может сначала спросить о «${DESKTOP_HELPER_ENTRY}», затем откроются «Конфиденциальность и безопасность» в Системных настройках. Включите «${DESKTOP_HELPER_ENTRY}» в «Запись экрана и системного звука» и в «Универсальный доступ», затем нажмите «Выключить и освободить доступ» и проверьте снова: новое разрешение записи экрана macOS применяет только к новому процессу helper.`)}</p>
      <p>{choose('One grant survives NEKODEX updates. After the update that introduced this helper identity, grant it once more; earlier entries for NEKODEX or a terminal are not used and can be turned off.', 'Одно разрешение сохраняется при обновлениях NEKODEX. После обновления, в котором появился этот идентификатор helper, выдайте разрешение ещё один раз; прежние записи NEKODEX или терминала не используются, их можно выключить.')}</p>
      {client?.bundlePath ? <p>{choose(`If "${DESKTOP_HELPER_ENTRY}" is not listed, click +, press Command-Shift-G and paste:`, `Если «${DESKTOP_HELPER_ENTRY}» нет в списке, нажмите +, затем Command-Shift-G и вставьте:`)} <code>{client.bundlePath}</code></p> : null}
    </Notice> : null}
    <p className="agent-desktop-tools__muted">{choose(`Enable desktop provider shows a macOS alert from "${DESKTOP_HELPER_ENTRY}": choose Allow there to enable it. Window titles appear after enabling.`, `«Включить desktop provider» показывает системное окно от «${DESKTOP_HELPER_ENTRY}»: нажмите в нём «Allow». Заголовки окон видны после включения.`)}</p>
    <p className="agent-desktop-tools__muted">{choose('Permission values are cached until you inspect them. Inspection never prompts. Only an Open System Settings button asks macOS to list the helper, for that one permission; it never grants access or activates a window. AX supports selected accessible background windows; pixel fallback is restricted to the selected foreground window.', 'Разрешения показаны из последней явной проверки. Проверка не вызывает системный запрос. Только кнопка открытия Системных настроек просит macOS добавить helper в список для одного разрешения; она не выдаёт доступ и не активирует окна. AX поддерживает выбранные доступные фоновые окна; ввод по пикселям ограничен выбранным активным окном.')}</p>
    <div className="agent-desktop-tools__actions">
      <Button disabled={locked || !desktop || !supported || closed} onClick={() => send({ action: 'inspectDesktopPermissions', explicitUserAction: true })}>{choose('Inspect permissions without prompting', 'Проверить разрешения без системного запроса')}</Button>
      <Button disabled={locked || !desktop || !supported || closed} onClick={() => send({ action: 'listDesktopWindows', explicitUserAction: true })}>{choose('List window metadata', 'Получить список окон')}</Button>
      <Button disabled={locked || !desktop || !supported || closed || enabled} onClick={() => send({ action: 'setDesktopEnabled', enabled: true, explicitUserAction: true })}>{choose('Enable desktop provider', 'Включить desktop provider')}</Button>
      <Button disabled={locked || !desktop || (!enabled && !desktop.created)} onClick={() => send({ action: 'setDesktopEnabled', enabled: false, explicitUserAction: true })}>{choose('Disable and release desktop access', 'Выключить и освободить доступ')}</Button>
    </div>
    {selected ? <div className="agent-desktop-tools__selection"><strong>{choose('Selected native window', 'Выбранное native-окно')}</strong><span>{choose('Window', 'Окно')}: {selected.windowId} · {choose('Process identity', 'Идентификатор процесса')}: {selected.processId}</span><code>{selected.windowEpoch}</code>
      {desktop?.nativeStatus?.selectionCurrent === false ? <Notice tone="warning">{choose('The selected window is no longer current. List windows again and attach the exact new identity.', 'Выбранное окно больше не актуально. Обновите список и прикрепите точный новый идентификатор.')}</Notice> : null}
    </div> : null}
    {!scope ? <p className="agent-desktop-tools__muted">{choose('Select an owned Agent task above before attaching a window.', 'Перед привязкой окна выберите Agent-задачу выше.')}</p> : <p className="agent-desktop-tools__muted">{choose('Task generation', 'Поколение задачи')}: <code>{scope.taskId}</code> / {scope.generation}</p>}
    {desktop?.windows.length ? <ul className="agent-desktop-tools__windows">{desktop.windows.map(row => {
      const selection = { windowId: row.windowId, processId: row.processId, windowEpoch: row.windowEpoch };
      const attached = Boolean(bound && attachment && sameWindow(attachment.selection, selection));
      return <li key={`${row.windowId}:${row.processId}:${row.windowEpoch}`}>
        <strong>{row.owner}{row.title ? ` · ${row.title}` : ''}</strong>
        <span>{row.foreground ? choose('Foreground', 'Активное окно') : choose('Background', 'Фоновое окно')} · {choose('Window', 'Окно')}: {row.windowId} · {choose('Process', 'Процесс')}: {row.processId}</span>
        <code>{row.windowEpoch}</code>
        <div><Button size="sm" disabled={locked || !scope || !enabled || !supported || attached || closed} onClick={() => send({ action: 'selectDesktopWindow', scope, expectedSelection: selection, explicitUserAction: true })}>{attached ? choose('Attached', 'Прикреплено') : choose('Select and attach this exact window', 'Выбрать и прикрепить это точное окно')}</Button></div>
      </li>;
    })}</ul> : <p className="agent-desktop-tools__muted">{choose('The cached window list is empty. Use List window metadata to refresh it. No screenshot is read on this screen.', 'Сохранённый список окон пуст. Обновите его кнопкой «Получить список окон». Снимки экрана на этой панели не читаются.')}</p>}
    <div><Button disabled={locked || !scope || !attachment} onClick={() => send({ action: 'revokeDesktopTools', scope, explicitUserAction: true })}>{choose('Revoke this task window attachment', 'Отозвать привязку окна к задаче')}</Button></div>
    {bound ? <Notice>{choose('Use desktop/observe for a bounded JPEG of this exact window. After each input or AX property read, approve a fresh observation before another input. Use desktop/readProperties to identify an application element, then desktop/verifyProperty to re-read and compare its actual value, title, enabled or focused state. Missing values remain unknown; an input receipt never proves the application accepted the result.', 'Используйте desktop/observe для ограниченного JPEG этого точного окна. После ввода или чтения AX подтвердите свежее наблюдение перед следующим вводом. desktop/readProperties показывает элементы приложения, а desktop/verifyProperty заново читает и сравнивает фактическое значение, заголовок, доступность или фокус элемента. Отсутствующие свойства имеют неизвестный исход; квитанция ввода не подтверждает принятие результата приложением.')}</Notice> : null}
    <Notice>{choose('Screenshots, AX reads and input start only after you approve the model’s exact retained pending tool call in the approval panel. An input receipt proves only that input was dispatched; the application result needs separate observation and verification. Unknown effects are retained without automatic replay.', 'Снимки, чтение AX и ввод начинаются только после подтверждения точного сохранённого запроса инструмента от модели в панели подтверждений. Квитанция ввода подтверждает только отправку события; результат в приложении требует отдельного наблюдения и проверки. Неизвестный исход сохраняется без автоматического повтора.')}</Notice>
  </Panel>;
}
