import { Badge } from './design';
import type { AgentDesktopStatus } from './agent-desktop-types';
import type { AgentPendingToolCall } from './agent-mode-types';
import type { ToolOutcome } from './agent-tools-types';

type Choose = (en: string, ru: string) => string;
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const windowKeys = ['windowId', 'processId', 'windowEpoch'] as const;
const sameWindow = (a: Record<string, unknown>, b: Record<string, unknown>) => windowKeys.every(key => typeof a[key] === 'string' && a[key] === b[key]);

/** Read calls may select any attached window. Input still requires its current
 * window; exact screenshot/frame/focus validation belongs to the backend. */
export function desktopCallAttached(desktop: AgentDesktopStatus | null | undefined, task: { id: string; generation: number } | undefined, call: AgentPendingToolCall | undefined): boolean {
  if (!desktop?.enabled || !task || !call) return false;
  const read = ['desktop/observe', 'desktop/readProperties', 'desktop/verifyProperty'].includes(call.tool);
  const input = ['desktop/click', 'desktop/type'].includes(call.tool);
  if (!read && !input) return false;
  const selection = record(read ? call.arguments.selection : call.arguments.binding);
  if (!selection || !desktop.bindings.some(row => row.taskId === task.id && row.generation === task.generation && sameWindow(selection, row.selection))) return false;
  return read || !!desktop.selected && sameWindow(selection, desktop.selected);
}

export function toolOutcomeLabel(state: ToolOutcome['state'], choose: Choose): string {
  return state === 'completed' ? choose('Completed receipt', 'Квитанция выполнения')
    : state === 'outcome_unknown' ? choose('Outcome unknown', 'Исход неизвестен')
      : choose('Failed', 'Ошибка выполнения');
}

/** Review projection of saved arguments, never an invocation or a permission
 * decision. Unknown/custom servers keep their effects unspecified. */
export function agentToolsCallSummary(call: AgentPendingToolCall, choose: Choose, customServer = false) {
  const args = call.arguments;
  const binding = record(args.selection) ?? record(args.binding);
  let action = call.tool;
  let effect = choose('This tool may read, change or transmit data according to its server implementation. Review its boundary and exact arguments before approving.', 'Инструмент может читать, изменять или передавать данные согласно реализации сервера. До подтверждения проверьте границы сервера и точные аргументы.');
  let readOnly = false;
  if (!customServer) {
    switch (call.tool) {
      case 'desktop/observe':
        action = choose('Read window image', 'Прочитать изображение окна'); readOnly = true;
        effect = choose('The selected window image is shared with this task’s model and saved tool results.', 'Изображение выбранного окна передаётся модели этой задачи и сохраняется в результатах инструмента.'); break;
      case 'desktop/readProperties': case 'desktop/verifyProperty':
        action = choose('Read window properties', 'Прочитать свойства окна'); readOnly = true;
        effect = choose('Window properties and visible content are shared with this task’s model and saved tool results.', 'Свойства окна и видимое содержимое передаются модели этой задачи и сохраняются в результатах инструмента.'); break;
      case 'browser/observe':
        action = choose('Read browser page', 'Прочитать страницу браузера'); readOnly = true;
        effect = args.includeImage === true
          ? choose('Page text, controls and an image are shared with this task’s model and saved tool results.', 'Текст страницы, элементы управления и изображение передаются модели этой задачи и сохраняются в результатах инструмента.')
          : choose('Page text and controls are shared with this task’s model and saved tool results.', 'Текст страницы и элементы управления передаются модели этой задачи и сохраняются в результатах инструмента.'); break;
      case 'skill-resource/read':
        action = choose('Read skill resource', 'Прочитать ресурс skill'); readOnly = true;
        effect = choose('The requested resource content is shared with this task’s model and saved tool results.', 'Содержимое запрошенного ресурса передаётся модели этой задачи и сохраняется в результатах инструмента.'); break;
      case 'remote/list': case 'remote/read':
        action = call.tool === 'remote/read' ? choose('Read remote file', 'Прочитать удалённый файл') : choose('List remote directory', 'Просмотреть удалённый каталог'); readOnly = true;
        effect = choose('The requested remote content is shared with this task’s model and saved tool results.', 'Запрошенное удалённое содержимое передаётся модели этой задачи и сохраняется в результатах инструмента.'); break;
      case 'remote/command':
        action = choose('Run remote command', 'Выполнить удалённую команду');
        effect = choose('The command runs with the SSH user’s permissions. The working directory is not a sandbox; the command may change or transmit data.', 'Команда выполняется с правами пользователя SSH. Рабочий каталог не является sandbox: команда может изменять или передавать данные.'); break;
      case 'skill-script/run':
        action = choose('Run skill script', 'Выполнить скрипт skill');
        effect = choose('The selected script runs in its reviewed environment and workspace grant. Execution results return to this task’s model.', 'Выбранный скрипт выполняется в проверенной среде с разрешением на рабочий каталог. Результаты исполнения возвращаются модели этой задачи.'); break;
      case 'vm-shell/run':
        action = choose('Run VM script', 'Выполнить скрипт в VM');
        effect = choose('The script runs in the disposable offline VM with the named input files. Output candidates require a separate reviewed export before publication to the host.', 'Скрипт выполняется в одноразовой VM без сети с указанными входными файлами. Для записи выходных файлов на хост нужен отдельный проверенный экспорт.'); break;
      case 'vm-shell/export':
        action = choose('Publish reviewed VM output', 'Записать проверенный результат VM');
        effect = choose('This publishes the output bound to the exact saved review into its reviewed host destination. Inspect that review in Python and VM before approval.', 'Результат из точной сохранённой проверки будет записан в выбранное место на хосте. Перед подтверждением проверьте эти сведения в разделе Python и VM.'); break;
      case 'vm-network/request':
        action = choose('Send host network request', 'Отправить сетевой запрос с хоста');
        effect = choose('The host sends this HTTP request to the exact URL under the selected grant. Its method and body may change remote data; the response returns to this task’s model.', 'Хост отправит HTTP-запрос на точный URL по выбранному разрешению. Метод и тело запроса могут изменить удалённые данные; ответ возвращается модели этой задачи.'); break;
      case 'desktop/click': case 'browser/click':
        action = choose('Click selected target', 'Нажать выбранный элемент');
        effect = choose('A click can change the application, navigate or submit data. Review the exact target and current observation.', 'Нажатие может изменить приложение, открыть страницу или отправить данные. Проверьте точную цель и текущее наблюдение.'); break;
      case 'desktop/type': case 'browser/type':
        action = choose('Enter text', 'Ввести текст');
        effect = choose('The exact text below will be entered into the selected target. Input may change application or page data.', 'Указанный ниже текст будет введён в выбранный элемент. Ввод может изменить данные приложения или страницы.'); break;
    }
  }
  const targets: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => { if (typeof value === 'string' && value) targets.push({ label, value }); };
  if (binding) {
    add(choose('Window', 'Окно'), binding.windowId);
    add(choose('Process', 'Процесс'), binding.processId);
    add(choose('Tab', 'Вкладка'), binding.tabId);
    add(choose('Document', 'Документ'), binding.documentId);
    add(choose('Host', 'Хост'), binding.hostname);
    add(choose('User', 'Пользователь'), binding.username);
    add(choose('Root', 'Корневой каталог'), binding.root);
  }
  for (const [key, label] of [
    ['path', choose('Path', 'Путь')], ['relativePath', choose('Resource path', 'Путь ресурса')],
    ['url', 'URL'], ['cwd', choose('Working directory', 'Рабочий каталог')],
    ['command', choose('Command', 'Команда')], ['script', choose('Script', 'Скрипт')],
    ['method', choose('HTTP method', 'Метод HTTP')], ['reviewId', choose('Saved review', 'Сохранённая проверка')], ['ref', choose('Element', 'Элемент')],
    ['text', choose('Exact input text', 'Точный вводимый текст')],
  ]) add(label!, args[key!]);
  for (const key of ['argv', 'inputPaths', 'outputPaths']) {
    if (Array.isArray(args[key])) targets.push({ label: key === 'argv' ? choose('Exact arguments', 'Точные аргументы') : key === 'inputPaths' ? choose('Input paths', 'Входные пути') : choose('Output paths', 'Выходные пути'), value: JSON.stringify(args[key], null, 2) });
  }
  if (typeof args.x === 'number' && typeof args.y === 'number') targets.push({ label: choose('Image coordinates', 'Координаты изображения'), value: `${args.x}, ${args.y}` });
  return { action, effect, readOnly, targets };
}

export function AgentToolsCallSummary({ call, choose, customServer = false }: { call: AgentPendingToolCall; choose: Choose; customServer?: boolean }) {
  const summary = agentToolsCallSummary(call, choose, customServer);
  return <div className="agent-tools-call-review">
    <div className="agent-tools-call-review__heading"><h3>{summary.action}</h3><Badge tone={summary.readOnly ? 'success' : 'warning'}>{summary.readOnly ? choose('Read · shared with model', 'Чтение · передача модели') : choose('Review effects', 'Проверьте последствия')}</Badge></div>
    <code>{call.tool}</code>
    <dl className="agent-tools-call-targets">{summary.targets.length ? summary.targets.map((target, index) => <div key={index}><dt>{target.label}</dt><dd><pre tabIndex={0}>{target.value}</pre></dd></div>) : <div><dt>{choose('Target', 'Объект')}</dt><dd>{choose('Defined by the saved arguments below.', 'Указан в сохранённых аргументах ниже.')}</dd></div>}</dl>
    <div><strong>{choose('Effects', 'Последствия')}</strong><p>{summary.effect}</p></div>
    <p className="agent-tools-muted">{choose('Approval covers only this exact saved call in this task generation. It does not approve later calls or extend access.', 'Подтверждение относится только к этому сохранённому вызову и поколению задачи. Оно не разрешает последующие вызовы и не расширяет доступ.')}</p>
    <details><summary>{choose('Exact request and call identity', 'Точный запрос и идентификатор вызова')}</summary><pre tabIndex={0}>{JSON.stringify(call, null, 2)}</pre></details>
  </div>;
}
