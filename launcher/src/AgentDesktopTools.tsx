import { Badge, Button, Notice, Panel } from './design';
import type { AgentDesktopToolsProps, MacosWindowSelection } from './agent-desktop-types';
import './surfaces/agent-desktop.css';

const sameWindow = (a: MacosWindowSelection, b: MacosWindowSelection) => a.windowId === b.windowId && a.processId === b.processId && a.windowEpoch === b.windowEpoch;

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
      <div><dt>{choose('Screen recording permission', 'Разрешение записи экрана')}</dt><dd>{permission(desktop?.permissions?.screenCaptureGranted)}</dd></div>
      <div><dt>{choose('Accessibility permission (AX)', 'Разрешение универсального доступа (AX)')}</dt><dd>{permission(desktop?.permissions?.accessibilityGranted)}</dd></div>
      <div><dt>{choose('Post-event permission — foreground pixel fallback', 'Разрешение отправки событий — ввод по пикселям активного окна')}</dt><dd>{permission(desktop?.permissions?.postEventGranted)}</dd></div>
    </dl>
    <p className="agent-desktop-tools__muted">{choose('Permission values are cached until you inspect them. These controls never request OS permission or activate a window automatically. AX supports selected accessible background windows; pixel fallback is restricted to the selected foreground window.', 'Разрешения показаны из последней явной проверки. Эти кнопки не запрашивают системные разрешения и не активируют окна автоматически. AX поддерживает выбранные доступные фоновые окна; ввод по пикселям ограничен выбранным активным окном.')}</p>
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
