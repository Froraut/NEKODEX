# Расширенная реализация NEKODEX — 18 октября 2026

Источник: `codex/full-adoption-20261018`, baseline
`4e6c0575d6b0afb0c213e8f0e94965020af4c364`.
Source identity: `6.1.32-nekodex.9`. Это development/source результат;
установленная D01 версия остаётся `6.1.32-nekodex.8`.

Полная таблица из 36 областей, зависимостей, ограничений и следующих изменений:
[full-adoption-program.md](../design/full-adoption-program.md).

## Что подключено

В main/preload/App и существующие lazy runtime owners подключены:

- Явно выбранные локальные папки, дерево/preview, editor/drafts/conflict/save,
  Git diff, управляемые worktrees, ручные snapshots/selective restore и human PTY.
- SSH/SFTP, remote editing, явно подтверждаемые команды и remote worktrees
  с durable started/completed/unknown receipts и reconciliation.
- Отдельная opt-in политика plan content, canonical current-turn `update_plan`,
  private storage и Task Center projection, не выдающая claimed status за verified;
  явно введённые требования/исправления с CAS, связями с планом и отдельно
  обозначенными наблюдениями действий и подтверждениями пользователя.
- Selected-text history, immutable revisions, FTS и Markdown export; supported
  native Codex metadata/read/fork с durable uncertain fork journal. Native history
  recorder сохраняет одну canonical page после явного обновления выбранного чата,
  отдельного content consent и acknowledgement ограничений secret filter.
- Agent mode: tasks, stages, corrections, workers/mailboxes, finite dispatch,
  approved MCP continuation, Goal и mailbox-driven Loop через одного sender.
- Signed pre-turn workspace snapshot grants и выбранные file-property observers
  с exact scope, immutable evidence, supersession и synchronous pre-Verify check.
- MCP/skills host, pinned official filesystem installer, disabled-by-default
  configuration и opt-in reviewed macOS MCP Seatbelt boundary; managed immutable
  local skill text versions с отдельными import/update/attach/revoke actions.
- MV3 Chrome companion artifact/pairing/observation-bound actions, scoped local
  control API и metadata-only cross-client usage с отдельными estimates.

Эта интеграция не делает все расширения каждой области реализованными.
Оставшиеся capabilities перечислены ниже и в полной программе.

## Наблюдённые connected DEV flows

Проверки выполнялись в отдельном временном profile, со своими файлами и inert
Responses adapter. Внешняя модель, реальные аккаунты и installed `.8` не
использовались для новых Agent UI результатов.

| Сценарий | Фактическое наблюдение |
| --- | --- |
| Workspace/editor/Git | Native picker выбрал только fixture project; сохранение `alpha → beta`; Git показал точный diff и полный HEAD. |
| Snapshot/restore | Manual snapshot сохранил `alpha`; selective restore вернул её после edit; `beta` сохранена как recovery before-image. Найденный missing `targetFile` после extraction исправлен и проверен на этом flow. |
| Managed worktree | UI создал `codex/dev-ui-branch` от captured HEAD; Open выбрал exact owned checkout и показал его файл. Archive/lifecycle guards имеют отдельные focused checks. |
| Human terminal | Реальный xterm keyboard input получил `NEKODEX_PTY_UI_OK`; PTY закрыт. Отдельно фактический Electron native ABI check подтвердил stdin/stdout/resize/exit/reap на этом macOS arm64. |
| History | Opt-in selected synthetic text/code сохранён; FTS нашёл exact revision; native save записал Markdown с code и partial marker; disable сохранил историю. |
| Native Codex | Реальный CLI 0.163 на отдельном пустом profile вернул пустой список с явным connection scope. Isolated fork имеет отдельную fixture evidence; пользовательская история не читалась. |
| Agent snapshot | Manual stage получил signed pre-turn grant и 6-byte preimage; один inert response; ноль evidence не разрешили completion; Pause сменил generation, grant отозван. |
| File outcome | Задача `a00ecd0a-dbeb-4965-bc19-63d41f40f8ac`: `alpha` SHA passed → Review → внешняя `beta` → Verify отказал HTTP 409 → восстановленная `alpha` и новое observation → актуальный Review → `verified_complete`. Старые два facts остались immutable; покрытие выбрало новый fact. |
| Mailbox Loop | Задача `b21a1d4d-9f60-4372-a5eb-0104fbd99b92`, maxTurns 2: заданный этап → `waiting_for_mailbox_work`; новый содержательный пакет запустил второй цикл; exact duplicate key не добавил третий run; Pause отозвал Run consent. Итог не объявлялся business completion. |
| AgentTools panel | Показаны pinned official package/SRI, отдельные prepare/install/review/enable/connect, disabled host и точный sandbox scope. Реальная official installation проверена отдельно по JSON receipt. |
| Companion | DEV UI включил/выключил настоящий lazy loopback listener; без pairing/tab grant. Отдельная actual MV3 fixture прошла activeTab/pair/select/observe/type/click/revoke через настоящий popup document. Видимый toolbar popup этим не доказан. |
| Usage/API/remote | Usage picker импортировал synthetic metadata 100/20 без sentinel/CWD; unknown price и overlap не стали нулевой ценой/общей суммой. Local API показан default-off, без clipboard token. Remote profile fixture сохранён disconnected; реального SSH соединения не было. |

После stale-file отказа исправлена потеря причины в transport: только Agent mode
может запросить bounded allowlisted error receipt; UI теперь объясняет необходимость
нового наблюдения. Focused regression проходит через actual control prototype и IPC
registrar; приватные произвольные backend messages и oversized bodies отфильтрованы.
Полный UI flow выше был выполнен до этого narrow presentation fix.

## Проверки и review

Один coverage plan распределял изменённые contracts по owners. Успешные
неизменённые проверки переиспользовались; full repository suite не запускалась.
Основные evidence groups:

- Pinned Bun 1.4.0: source и launcher TypeScript checks прошли; version check
  согласовал `.9`; финальный renderer build прошёл (186 modules); development CLI
  bundle прошёл (237 modules) и фактически вернул `6.1.32-nekodex.9` по `--version`.
- Agent core: 16 focused cases / 176 assertions, включая actual SDK child,
  local Responses/restart/known-output continuation и finite Loop. Composed
  before-Verify fixture: 1 case / 27 assertions; workspace observer: 4 / 44;
  IPC: 7 / 42. Narrow safe error receipt regression: 1 / 5.
- Concurrent/repeated server shutdown: actual initialized server/store stopped
  without double finalization; durable task survived reopen (1 / 6).
- Workspace, real Git/SFTP/Python, terminal, history, native fork, plan routing,
  companion, usage и local API имеют focused checks в своих `tests/*` owners.
  Они не подменяют platform/provider observations, указанные выше.
- Official filesystem `1.0.0` installer: 104 dependency packages, 4 691 tree
  entries, frozen install без lifecycle scripts, сохранён disabled, MCP PID null.
  [Фактическая квитанция](2026-10-18-agent-tools-official-install.json).
- Independent installer review исправил два substantive findings: authority
  home overlap в data/code grants и недолговечный archive destination intent.
  Corrected focused checks: 12 cases / 105 assertions; reviewer подтвердил source fix.
- Реальный macOS Seatbelt kernel boundary запретил outside-file/network access;
  fork inheritance доказана при живом parent. Actual SDK fixture выполнила
  разрешённый synthetic tool через sandbox. Deprecated API и global metadata/
  system-library/sysctl grants раскрыты; post-parent cleanup не заявлен.
- Architecture/module map обновлены и проверены; whitespace check чистый.

Development GUI, Vite и fixture core закрыты штатными owned shutdown routes;
соответствующие PID и listeners проверены как завершённые. Новые installer,
notarization, release assets, merge и replacement установленного приложения
не выполнялись этой source-партией.

## Следующая связанная партия: требования, canonical history, Git base и skills

После source commit `137399d` / [draft PR #98](https://github.com/Froraut/NEKODEX/pull/98)
добавлены четыре расширения. Четыре CI jobs baseline commit прошли; эта квитанция
не переносит их результат автоматически на последующие source bytes.

| Область | Новая connected DEV evidence |
| --- | --- |
| P07 | Native picker выбрал свой fixture repository. HEAD diff показал `head → working`; выбор `older-base` показал `base → working`, с точными разными base OIDs и прежним HEAD. Выбор не делал fetch/checkout. |
| DW1 | Задача `e54cf9dd965234ead3fe98e82d3ea24f`: собственный текст и отдельное согласие → revision 1 → связь с plan step/ledger action и manual user-confirmed → counts 1/1. Correction revision 2 сбросила оба counts до 0/1, сохранив две редакции требований и историю подтверждения. Property verification остаётся явно unavailable. Это synthetic native ledger fixture. |
| DW5 | Global opt-in плюс два per-thread acknowledgement для своего inert thread → consent → actual Codex 0.163.0 canonical endpoint вернул пустую страницу. UI сообщил, что текст не сохранён и исходная переписка не доказана пустой. Revoke заблокировал refresh, затем global recording выключен. Непустой actual transcript этим не доказан. |
| P16 | Native picker выбрал только `user-skills/demo/SKILL.md`; discover/review показали 187 bytes, SHA-256 и точный текст. Import создал immutable version без attachment; отдельное действие прикрепило её к `managed-skill-dev-task`, generation 1. Revoke сохранил bytes и заблокировал attachment; затем fixture attachment снят. Модель и MCP не запускались. |

Native checklist хранит исходные требования и corrections отдельно от metadata
ledger. Backend согласует текущую plan revision до CAS mutation; plan/correction
исключают старые связи из текущего покрытия. История ограничена, но не удаляется
автоматически. Model completion, observed action, user-confirmed и verified
property имеют разные значения; resolver последнего для native tasks не выдуман.

Canonical recorder использует тот же main-owned client, exact thread metadata и
один supported `thread/items/list` page. Private record/lease API не доступен
generic renderer proxy. Durable global recording epoch и per-thread revision
отклоняют позднее чтение после revoke/re-enable или global off/on. Известные
credential/generated-instruction patterns исключают весь item без сохранения
его тела или content hash; неизвестные секреты всё ещё возможны, что требует
отдельного acknowledgement. Сохранённый corpus всегда partial, authorship unknown.
Фонового watcher и model turn нет. Explicit empty-text edits создают новую revision,
убирают старый текст из latest FTS и сохраняют прежнюю immutable revision.

Managed skill review закрепляет canonical source identity и UTF-8 content pins;
commit перепроверяет их. Update создаёт отдельную версию без автоматического
attachment. Неизвестный import outcome не повторяет copy/rename; опубликованный
marked target восстанавливает receipt наблюдением. До нового intent атомарно
проверяются 512 actions, 256 versions, 64 MiB conservative text reservation и
64 task-generation attachments; combined selection ограничен 16 items / 128 KiB.
Exact retry возвращается до quota checks. Official/vendor plugin ancestry,
resources, scripts и registry changes не входят в этот text-import contract.

Проверки новой партии: P07 actual Git 1 case / 23 assertions; DW1 real ledger/private
store 1 / 36; native canonical producer 1 / 17; connected canonical RPC → recorder
→ guarded IPC → actual SQLite 1 / 43; managed skills с двумя affected existing
cases 5 / 69. Полные root и renderer project TypeScript checks 09:55 UTC переиспользованы;
после них изменялся только localized label. Renderer build прошёл (188 modules),
development CLI bundle (240 modules) фактически вернул `.9`, architecture map
обновлён и проверен. Unchanged feature suites не повторялись.

Первый новый DEV fixture запуск имел ошибочный `browserHost`; исправленная
конфигурация прошла существующий ownership preflight до следующего запуска.
Отложенный quit после исправления завершился exit 0. CUA binding/input восстановлены
без перезапуска control service или изменения OS permissions; точная папка затем
выбрана через настоящий native picker. Это fixture/control observations, не
новые application-source findings. Оба новых GUI/core runs закрыты с exit 0,
проверены завершённые PID и освобождённые listeners.

## Оставшиеся реализации и границы

Следующие содержательные изменения: поддержанный native continue/reuse с
cooperative exclusive-owner handoff; trusted property verifier native requirements;
Agent remote authority; skill resources/update distribution и OAuth; standalone
browser consumer, ChatGPT companion send, реальный desktop provider. Generic
external watcher отсутствует; mailbox Loop имеет конкретный работающий source
contract. Canonical capture подключён в scope explicit selected-thread refresh;
реальный непустой transcript и фоновое subscription capture не заявлены.

Реальные Web/SSH/provider connected outcomes требуют выбранной среды и остаются
отдельными наблюдениями. Windows/Linux protected credentials/private ACL, PTY ABI
и sandbox не доказаны macOS результатом. QuickJS остаётся условным: текущий
конкретный composition gap для него не установлен.

D01 установленной версии завершён отдельно:
[D01 implementation/migration receipt](2026-10-18-d01-implementation.md).
Два активных ключа находятся в Keychain; неактивный legacy key архивирован
защищённо. Реальный ChatGPT post-migration connector/tool turn не заявлен.
