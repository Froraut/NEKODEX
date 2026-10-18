import { Badge, Button, Notice, Panel } from './design';
import type { AgentToolsApi, AgentToolsStatus, ToolScope } from './agent-tools-types';

/** Trusted task attachment only. All page reads/input still use the saved Agent tool-call approval. */
export function AgentBrowserTools({ api, status, scope, locked, choose, act, refresh }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; scope?: ToolScope; locked: boolean;
  choose: (en: string, ru: string) => string; act: (operation: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>;
}) {
  const browser = status?.browserTools;
  const selected = browser?.selected;
  const attachment = browser?.bindings.find(row => row.taskId === scope?.taskId && row.generation === scope?.generation);
  const bound = !!attachment && !!selected && ['sessionId', 'scopeId', 'tabId', 'windowId', 'frameId', 'documentId', 'documentEpoch'].every(key => attachment.binding[key as keyof typeof selected] === selected[key as keyof typeof selected]);
  return <Panel title={choose('Selected browser tools', 'Инструменты выбранной вкладки')}>
    <p>{choose('Pair the companion and choose the exact tab in its popup. Attach that document to this task generation separately. The model receives page content only after you approve its saved observe call; each click or type requires a fresh owned observation and another exact call approval.', 'Сначала подключите расширение и выберите нужную вкладку в его окне. Отдельно прикрепите этот документ к текущему поколению задачи. Модель получит содержимое только после подтверждения сохранённого запроса наблюдения; каждое нажатие или ввод требует свежего наблюдения и отдельного подтверждения.')}</p>
    <Badge tone={bound ? 'success' : 'neutral'}>{bound ? choose('Attached to this task generation', 'Прикреплено к этому поколению') : choose('Off for this task', 'Выключено для этой задачи')}</Badge>
    {selected ? <p>{choose('Selected tab', 'Выбранная вкладка')}: {selected.tabId} · {choose('window', 'окно')}: {selected.windowId} · {choose('document', 'документ')}: <code>{selected.documentId.slice(0, 24)}</code></p> : null}
    {!browser ? <Notice>{choose('This runtime has no browser provider. Nothing was started or selected.', 'В этом runtime браузерный provider не подключён. Вкладки не запускались и не выбирались.')}</Notice> : !browser.available ? <Notice tone="warning">{choose('Keep the paired extension popup open and select an ordinary web page. A listener or pairing alone does not grant a page to this task.', 'Держите окно подключённого расширения открытым и выберите обычную веб-страницу. Само подключение не даёт задаче доступ к странице.')}</Notice> : null}
    <div className="agent-tools-state"><Button disabled={locked || !scope || !selected || !browser?.available} onClick={() => void act(async () => { await api.request({ action: 'bindBrowserTools', scope, expectedBinding: selected, explicitUserAction: true }); await refresh(); })}>{choose('Attach this exact selected document', 'Прикрепить этот выбранный документ')}</Button><Button disabled={locked || !scope || !attachment} onClick={() => void act(async () => { await api.request({ action: 'revokeBrowserTools', scope, explicitUserAction: true }); await refresh(); })}>{choose('Revoke browser attachment', 'Отозвать доступ к вкладке')}</Button></div>
    <small>{choose('Attachment is off after runtime restart. A completed input receipt proves browser execution only; it does not prove website acceptance or send a ChatGPT/model message. Unknown effects are retained without automatic replay.', 'После перезапуска runtime доступ выключен. Квитанция нажатия подтверждает только исполнение в браузере, а не принятие действия сайтом или отправку сообщения ChatGPT. Неизвестный исход сохраняется без автоматического повтора.')}</small>
  </Panel>;
}
