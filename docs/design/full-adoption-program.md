# Полная программа развития NEKODEX

Обновлено: 21 октября 2026 года (раздел «Статус 21 октября 2026 года» в конце).
Рабочая ветка: `codex/full-adoption-20261018`; 20 октября влита в `main` (`296addd`).
Это программа реализации всего набора возможностей из
[36 строк предыдущей оценки](../reviews/2026-10-18-deferred-features-next.md),
включая прежде отложенные области. Она заменяет прежнюю очередь «только
клиентские функции» более широкой программой, но не переписывает исторические
результаты и не объявляет запланированные возможности готовыми.

## Цель и границы продукта

NEKODEX развивается одновременно как клиент существующих исполнителей и как
самостоятельная рабочая среда с явным **Agent mode**. Для конкретной задачи
выбирается один исполнитель: поддерживаемый клиент либо NEKODEX Agent mode.
Клиентская интеграция показывает и использует возможности клиента; самостоятельный
режим получает собственные workspace, tools и durable execution contracts.
Два scheduler не управляют одним run. Переключение режима требует завершения или
согласованной передачи текущего владельца и его исходов.

Старое решение «не переносить готовую реализацию CoS» сохраняет смысл только как
ограничение способа реализации. Оно больше не исключает саму область:
remote worktrees получают отдельный проект; browser/desktop automation — provider
contracts; MCP/skills — клиентскую интеграцию и standalone host; action API — один
outbox; usage — отдельные источники и честные estimates. Неподдержанные методы и
ОС показываются как unsupported/unavailable, а не заменяются похожим действием.

## Подтверждённый порядок платформ и приёмка

18 октября 2026,12:11 UTC пользователь явно выбрал: **«Весь набор сначала на
macOS; затем Windows/Linux»**. Это порядок реализации всего согласованного
набора из 44 ID: N01–N08 и 36 расширений P/DW. Это не сокращение цели до
готового macOS поднабора. Этап1 доводит
все области на macOS, включая native/real-provider/Automatic Goal, remote/auth
и skill resources; этап2 сохраняет Windows/Linux adapters, packaging и parity.
Функциональные F0–F5 ниже — связанные batches внутри этих платформенных этапов.
Пока capability unsupported, она остаётся честным открытым пунктом, а не пропадает
из macOS объёма. Выбор платформы не является evidence установленной `.9`, release
или разрешением на broad suites; focused development verification сохраняется.

| Область / все ID | Этап1: уже подтверждено на macOS | Этап1: что ещё требуется до приёмки всей области | Этап2: Windows/Linux |
| --- | --- | --- | --- |
| Credentials P01–P02 | D01 scoped Keychain/CLI/headless и installed `.8` receipt | Сохранять exact scope/restart/rotation для новых routes; не выдавать новую source версию за installed migration | Protected backend/private ACL и поддержанные noninteractive migration routes |
| Workspace P03–P10, DW8–DW8a | Local editor/Git/base/snapshot/PTY; реальные SSH/SFTP/worktrees и Native→remote Goal; remote Git status/diff/conflict, Stage/Unstage/merge Commit и concurrent-save защита,24/24 независимых свойств | Реальные сетевые обрывы и долгий remote lifecycle, итоговая установка; local scopes не расширяются автоматически | Platform paths/SSH/PTY/packaging/ownership и то же сохранение пользовательской работы |
| Browser/desktop P11–P14 | Chrome MV3 fixture; native capture/type/AXPress на owned fixture; bounded image projection source | Real provider/model integration, task-bound browser flow, доверенный application-outcome observer; ChatGPT companion send/Firefox и заявленные native routes остаются открыты; generic CG fallback пока не verified | Native helpers/providers/permissions и browser compatibility по каждой ОС |
| MCP/skills/execution P15–P18 | Official install и Seatbelt; реальные Native Manual/Goal с MCP write/read и file-SHA; managed text/UTF-8/PNG/JPEG/JS/MJS packages | Auth/OAuth и остальные executable/binary resources; distribution rules сохраняются. QuickJS условен до конкретного composition gap | Installer/runtime/private ACL/OS sandbox/skills resource adapters и lifecycle |
| Long work/history DW1–DW7, DW9–DW11 | Requirements/claims, history/search; реальные модели, файловый Goal, Loop, owned context/fork и explicit Close/Resume с recall после полного restart | Длинные semantic Goals, recurring business outcome, полный transcript, внешний client reuse/exclusive handoff и attachments parity | Поддержанные client/protocol/process/event/persistence adapters и те же outcome boundaries |
| Local API/usage P19–P22 | Scoped API/action owner, metadata-only usage и honest unknown/overlap/estimate UI | Реальный named consumer, реальные разрешённые log/pricing sources; request/receipt reconciliation, actual bill/estimate разграничение | Platform source/parser/privacy и API integration contracts |
| Platform reliability P23–P24 | Действующие owners/целевые проверки, local offline tools+held SDK detach evidence | Закончить текущие TS/CLI gates и substantive findings; сохранить single owner/drain/cleanup и отдельные source/development/install/release receipts | Нужные target build/sign/package integrity и focused flow checks, не автоматический полный audit |

## Зафиксированное состояние

Сверено 19 октября 2026, 03:03 UTC. Исходники: `6.1.32-nekodex.9`,
ветка `codex/full-adoption-20261018`, [PR #98](https://github.com/Froraut/NEKODEX/pull/98).
Предыдущая опубликованная партия — `a785e1a`; её [четыре CI jobs](https://github.com/Froraut/NEKODEX/actions/runs/39187327997)
успешны. Текущая партия фиксирует полученные после неё исправления и реальные
результаты. Установлено `6.1.32-nekodex.8`; новая установка, merge и release не выполнены.

- **D01 / P01–P02 macOS завершены:** Keychain, Electron/CLI/headless, два действующих
  ключа, защищённый архив и миграция установленной `.8` подтверждены
  [квитанцией D01](../reviews/2026-10-18-d01-implementation.md).
  Эти результаты не подменяются новым Native OAuth и не доказывают Windows/Linux.
- **N01–N08:** клиентская партия сохранена в [PR #96](https://github.com/Froraut/NEKODEX/pull/96).
  Она не считается отсутствующей; source, merge и installed delivery учитываются раздельно.
- **Workspace:** development UI подтвердил picker, дерево/редактор/save/conflict,
  Git diff/base, local worktree create/Open, snapshots/selective restore с before-image
  и PTY input/close. Remote owner, receipts, safe SSH aliases и Agent attachment
  реализованы. На реальном SSH-хосте проверены чтение/запись/команда и
  worktree create/Open/archive; временные remote данные затем удалены.
  [Квитанция](../reviews/2026-10-18-real-remote-workspace.md).
- **Реальный Native:** официальный вход сохранён в изолированном development profile.
  Qualified inventory личного `promax` вернул десять моделей. GPT-6.1-Sol и GPT-6-Astra
  в двух разных задачах вернули `NEKODEX_NATIVE_OK` и `NEKODEX_ASTRA_HISTORY_OK`.
  Один account-server обслуживал два отдельных thread/turn, max1 worker в каждой задаче.
  Canonical receipts сохранены; обе задачи остаются `review_required`, денежный расход неизвестен.
- **Native history:** до offer Astra через UI включены global recording и согласие
  точной task generation. Поиск нашёл одну partial assistant/agent запись с реальным
  итогом. Затем оба согласия отключены, одна SQLite запись сохранена. Полный transcript,
  reasoning и tool payloads этим не охвачены.
  [Реальные модели и история](../reviews/2026-10-18-native-real-models.md);
  [Pro-family](../reviews/2026-10-18-native-pro-family.md).
- **Native transport:** pinned public wrapper, durable preclaim, main validation,
  early receipt и read-only same-owner wait интегрированы. Fixed-schema requests
  возвращаются к Bun ToolJournal; Native tools пусты. Typed images ограничены
  двумя cumulative attachments / 160 KiB. Реальные text responses подтверждены;
  Manual и Goal с MCP-инструментами подтверждены; real vision требует отдельного результата.
  [Protocol](agent-native-protocol.md), [bridge](agent-native-bridge.md),
  [build](../development/owned-native-worker-build.md),
  [images](../reviews/2026-10-18-owned-native-images.md).
- **MCP:** официальная frozen filesystem 1.0.0 установка сохранена отдельно.
  Исправлен общий JSON Schema 2020-12/draft-07 validator. Реальный процесс сообщил
  14 supported tools; одобренные write_file/read_file создали и прочитали точные
  50 байт, SHA проверен независимо. Следующая реальная Native-проверка дала
  Manual и Goal по три хода, по два подтверждённых MCP-вызова и отдельное
  file-SHA/QA verified_complete. Сервер остановлен; runtime сохранён отключённым.
  [MCP evidence](../reviews/2026-10-18-official-mcp-runtime.md).
- **Skills:** immutable text/UTF-8, PNG/JPEG и restricted JS/MJS packages имеют
  import/attach/revoke, digest/quota/revalidation и отдельные grants/approval.
  Реальный macOS sandbox/script и UI fixtures проверены. Python v4 прошёл реальный
  Native Goal/CSV/SHA; PDF v5 — два Native offers, одно одобренное чтение и точный
  итог59.70 с marker только после approval. Shell/прочие binary/network resources
  остаются открыты. [PDF evidence](../reviews/2026-10-19-pdf-skill-resources.md).
  [Script/SSH evidence](../reviews/2026-10-18-restricted-skill-scripts-and-ssh-aliases.md).
- **Длительная работа:** correction/coverage, property drift/review, pre-turn snapshot,
  durable mailbox, bounded Loop и Goal owner имеют development/fixture evidence.
  Реальные Native ответы, история, Manual и Goal с MCP/file-SHA подтверждены.
  Реальный GPT-6.1-Sol Loop выполнил два цикла по одному новому mailbox item;
  duplicate не создал третьего dispatch при ещё доступном лимите. Pause дал gen3
  и снял run consent. Это scheduling proof, не business completion; externalWatchers:false.
  Owned persistent Native create/continue/fork/fork-follow-up проверены реальной
  моделью: три предложения, canonical follow-ups без повторения context marker.
  Новый v2 context прошёл явные Close/Resume и полный restart/Resume с recall:
  один Native thread, три bindings, две server generations; Resume не отправлял
  model offer. Legacy v1 без доказанной identity остаётся unavailable.
  Длинные semantic Goals, внешний client reuse/exclusive handoff и attachments parity открыты.
  [Реальный Loop](../reviews/2026-10-18-real-native-loop.md).
  [Persistent Native](../reviews/2026-10-18-real-persistent-native-conversations.md).
  [Явный Resume](../reviews/2026-10-18-real-native-resume.md).
- **Browser/desktop:** Chrome MV3 и owned macOS fixture capture/type/fresh-click
  имеют receipts. Real-model сценарий, ChatGPT send, Firefox и generic CG fallback
  остаются открыты.
- **Cleanup:** Native account-server/tasks и временные core/GUI закрыты. Финальный
  core-first shutdown дал exit0, новых model dispatch не было. Ранний неверный
  порядок manual cleanup сохранён в private evidence. После отдельного перезапуска
  ChatGPT пользователь подтвердил исчезновение зависания компьютера; причина всех
  retained MCP cohorts не объявляется доказанной.

Неизменённые passing проверки не повторяются. Новая source/copy партия прошла
оба TypeScript targets и renderer build (198 modules). Это не приёмка установленной
`.9`, release или всей macOS программы.

## Очередь связанных результатов

| Этап | Связанный результат | Содержание и выход |
| --- | --- | --- |
| F0 | Свести уже выполненное и новые основы | Содержательное завершение N01–N08/D01 source review; единые ownership, capability и opt-in contracts. Интегрировать основы в main/IPC/UI, не задерживая весь продукт до реализации каждой строки. |
| F1 | Рабочая среда и контекст задачи | DW1–DW2, DW5–DW7, P07–P08: план/работники, разрешённая история/поиск/поддержанный fork и локальный workspace с редактором/Git. История не является искусственной предпосылкой для открытия локального проекта. |
| F2 | Прежде отложенная работа с проектами | P03–P06, P09–P10, DW8–DW8a: SSH/SFTP, remote execution, local/remote worktrees, restore, PTY, ручные и затем настоящие per-turn checkpoints. Remote mutation следует за read-only SSH; auto checkpoint следует за реальным hook. |
| F3 | Самостоятельное исполнение | DW3–DW4, DW9–DW11, P15–P17, P19–P20: подключённый executor, MCP/skills и sandbox, evidence review, Goal/Loop, read-only API и один durable action outbox. Ручной helper и read-only API могут выйти раньше полного Agent mode. |
| F4 | Браузерные и desktop providers | P11–P14: companion transport и browser/desktop tools, общий observation-bound action contract; подключение существующего клиента раньше отдельного native provider, где оно удовлетворяет сценарию. |
| F5 | Обзор расхода и условная composition | P21–P22: cross-client usage, отдельные estimates и comparison views. P18 добавляется при подтверждённом composition gap, а не как обязательный новый interpreter для всех. |
| Сквозной | Надёжность существующей платформы | P01–P02, P23–P24: расширение protected credentials по ОС при готовом backend, текущие compaction/updater/accounts, пропорциональный CI и delivery. |

Этапы задают зависимости и полезные пакеты, а не запрет независимой работы.
В пределах этапа сначала доводится связанный пользовательский сценарий, затем
проверяется его основной результат и существенная ошибка. Не требуется отдельный
релиз после каждого модуля или ожидание идеальной реализации всех будущих функций.

## Полная таблица реализации: исходные клиентские функции

Эти восемь пунктов уже реализованы в source-партии N и не возвращаются в очередь
как отсутствующие. Их [отдельная проверка](../reviews/2026-10-18-selective-cos-adoption.md)
сохраняет границы DEV/fixtures. Общая приёмка новой установленной `.9` остаётся
отдельным этапом для всей программы.

| ID | Возможность | Что готово | Что проверено | Что осталось |
| --- | --- | --- | --- | --- |
| N01 | Единый отчёт поддержки | Bounded safe report из существующих owners, сохранение через guarded IPC | Приватный файл, redaction/границы, stale/unavailable и отсутствие скрытых probes | Приёмка отчёта в итоговой установленной версии |
| N02 | Центр задач с приоритетом проблем | Фильтры очереди и записанных задач, точный переход к причине | Attention/recent ordering и DEV переходы/фильтры | Общая installed acceptance |
| N03 | Подробности задачи и квитанции | Send/acceptance/unknown/cancel и capabilities без повторной отправки | Совместимость журнала, uncertainty/restart, DEV detail/cancel/focus | Общая installed acceptance; новые providers по собственным contracts |
| N04 | Непрерывность задачи | Связи compaction/checkpoint/rebind по существующему владельцу | Exact-parent/одноразовые tokens, реальный локальный lifecycle transport | Проверка итоговой поставки; metadata не обещает full transcript |
| N05 | Native request и связи workers | Canonical current-turn identity и parent/worker associations | Локальные SQLite/native fixtures; unsupported остаётся unavailable | Поддержанные client/live worker сценарии и installed acceptance |
| N06 | Происхождение tools/skills | Раздельные inventory/selection/success, bounded metadata | Privacy/schema limits, content/path exclusion и digest semantics | Приёмка с итоговыми выбранными providers; digest не подпись издателя |
| N07 | Поиск настроек | Локализация, клавиатура, exact destination/focus | Шесть языков, DEV disclosure/keyboard/draft preservation | Общая installed acceptance |
| N08 | Иллюстрированная помощь подключения | Account/mode-bound помощь и исходные schematic SVG | DEV темы/диалог/focus, отсутствие записи readiness/ключей | Общая installed acceptance и реальная connector route отдельно |

## Полная таблица реализации: платформа

«Осталось» — реальная работа, не повторное разрешение пользователя. Критерии
задают итог сценария; они не означают запуск полной suite или обязательную
реализацию всех комбинаций платформ в первом результате.

| ID | Возможность | Польза | Текущая реализация фактически | Осталось реализовать | Зависимости | Приёмка результата | Этап |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | Точный контракт tunnel credentials | Один совместимый способ передать ключ Electron, CLI и detached child | SDK 0.0.16 `env:` selector и detached delivery подтверждены в D01; source-вопрос закрыт | Сохранить контракт при новых OS/routes и обновлениях SDK; affected-peer rotation | Существующий D01 owner; конкретно изменившийся SDK/route | Selector остаётся без raw key; новый process получает exact scoped secret; живой старый process не считается обновлённым от смены env | Сквозной, готово для подтверждённой macOS route |
| P02 | Общий protected credential provider | Защита ключей без конкурирующих файлов и владельцев | macOS Keychain, Electron/Bun/headless и installed migration подтверждены; другие ОС явно legacy | Поддержанные Windows/Linux protected adapters и migration UI при готовом noninteractive backend | P01; OS credential facility; существующая account mutation lease | Scoped prepare/commit/discard, locked/unavailable сохраняет reference; restart читает vault; config/profile/logs без raw key; legacy не скрыт | Сквозной; macOS выполнен, Windows/Linux — этап2 |
| P03 | SSH/SFTP дерево и preview | Удалённый проект становится полноценным workspace | Реальный SSH alias, существующий отдельный ключ и known_hosts, подключение из UI, SFTP-дерево/preview проверены; ограниченные безопасные параметры config и их pinning работают. | Более широкие SSH-конфигурации, восстановление после настоящего сетевого обрыва и приёмка установленной версии; нет общей совместимости с любым config. | Workspace registry и capability contract; системный SSH/SFTP | Host-key mismatch не принимается автоматически; root канонизирован; потеря соединения видна и не возвращает пустой успешный каталог | F2, первый remote результат |
| P04 | Удалённые команды и запись файлов | Работа Agent mode в выбранной remote среде | Реальные SFTP save/read-back/команда и Native→remote Goal проверены: один Run,4 offers,3 отдельных approvals,3 auto continuations; CSV251bytes/93.24/independent SHA. Signed intents и точные bindings сохранены; attachment/Native/SSH закрыты, собственный fixture удалён. [Evidence](../reviews/2026-10-19-real-native-remote-agent.md). | Живые сетевые uncertain-outcome/reconciliation сценарии и installed acceptance; командный cwd не OS sandbox. Task честно review_required без generic remote business observer. | P03; P17; единый P20 outbox для agent actions | Обрыв после send/write даёт unknown и reconciliation; нет слепого retry; результат, ошибка и partial outcome различимы; чужой host/root недоступен | F2 после P03; agent wiring F3 |
| P05 | Управляемые локальные worktrees | Изоляция параллельной работы и безопасное возвращение к ней | DEV UI create `codex/dev-ui-branch` с full OID и Open exact owned worktree→hello file tree наблюдены; lifecycle/archive guards в source | Только новые archive/lifecycle transitions при их изменении; client-owned worktrees остаются у клиента | Workspace registry; DW3 для собственного worker; client capability для клиентского режима | Exact marker/repo/root/refs; restart не создаёт новый worktree; dirty/untracked/ignored и чужая ownership защищают от удаления | F2 |
| P06 | Управляемые remote worktrees | Изолированные remote workers и повторное использование remote checkout | Реальный SSH Git worktree создан из закреплённого HEAD, открыт с исходным alias, прочитан и архивирован с сохранением папки/recovery ref. Начальная гонка list и потеря alias при Open исправлены. | Длительный remote worker lifecycle/reconnect и installed acceptance. Временные данные QA удалены отдельно после проверки; архивные квитанции сохранены. | P03–P05; P04 outcome reconciliation | Crash/reconnect сохраняет exact remote owner; uncertain Git mutation не повторяется; чужие refs/dirty data не удаляются; unsupported server показан явно | F2 после remote execution и local lifecycle |
| P07 | Git Review рабочего дерева/веток | Оценка изменений в собственной рабочей среде | Local branch/base/diff/full OIDs сохранены. Remote status/bases/staged/worktree/conflict и отдельные Stage/Unstage/Commit реализованы: real SSH/UI24/24, полный индекс2entries, resolved merge с2parents, independent tree/ref,3signed local pairs/remote ledgers. [Контракт](remote-git-review.md), [приёмка](../reviews/2026-10-19-remote-git-review.md). | Реальный сетевой uncertain-outcome/reconnect и installed acceptance; local mutation parity отдельно. Backend/facade потеря ACK/restart проверены без replay. | Явный workspace; общий per-host/remote common-dir owner; v2 signed registry | Exact captured HEAD/base/index/files; Preview и отдельный Apply; stale/unknown не replay; unrelated index/worktree сохранены | F1 local review; F2 remote |
| P08 | Редактор файлов | Исправления и review без ухода из NEKODEX | Local editor/save/conflict и remote SFTP сохранены. Real remote conflict resolution: concurrent external edit -> отказ Save/exact draft retained -> явная новая baseline -> save/read-back -> Stage/merge Commit;24/24 independent properties. | Реальный сетевой обрыв и итоговая installed acceptance; passing local/remote save evidence переиспользовать. | Local workspace authority; P04 remote; P07 typed index boundary | Поздняя external edit сохраняет draft и блокирует stale overwrite; binary/large/remote limits видимы; simultaneous final-rename race отдельно раскрыт | F1 local; F2 remote |
| P09 | Выборочное Git/file restore | Вернуть конкретную правку, сохранив человеческую работу | Actual DEV selective restore после нового main вернул alpha и сохранил beta recovery before-image; прежний targetFile defect закрыт | Сохранять scope/revision checks и проверить только новые substantive изменения; unchanged restore evidence переиспользовать | DW8 snapshot owner; P07; P08 save authority | Новый concurrent edit блокирует stale restore; исходные bytes доступны; остальные файлы не меняются; повтор не применяет destructive действие второй раз | F2 вместе с DW8 |
| P10 | Native terminal docks | Человеческий shell в контексте workspace | Main/IPC/xterm связаны с real node-pty; DEV keyboard echo `NEKODEX_PTY_UI_OK` и закрытие наблюдены | Native PTY ABI/packaging и поведение Windows/Linux на этапе2; remote terminal по своему contract | Workspace identity; native PTY development proof; P03/P04 для remote | Input/resize в exact PTY; ограниченный output; close ждёт точный exit и сохраняет посторонние shells; human terminal не становится agent tool автоматически | F2 |
| P11 | Chrome/Firefox companion transport | Альтернативный ChatGPT transport там, где нужен внешний browser | Artifact copy/bundled resolver подтверждён 1/8; actual MV3 Chrome pair/select/observe/type/click/revoke 1/17, app listener enable/disable; send:false | ChatGPT send и Firefox не реализованы; headless popup document не доказывает видимый toolbar popup; distribution отдельно | Подтверждённый transport gap; existing turn registry; P14 | Один sender/settlement owner; disconnect/version mismatch не создаёт второй send; permissions ограничены; tab/account mismatch отклонён | F4, конкретный browser сначала |
| P12 | Browser automation provider | Веб-действия для standalone Agent mode и клиентской интеграции | Standalone browser builtin host/leaf/attachment/admin UI подключены к единому tool journal; actual Chromium/MV3 composition fixture1/49,5canonical requests, duplicate/restart без второго эффекта | Root actual DEV browser attachment/approval flow; real model/account отдельно; execution receipt не application business evidence; ChatGPT send unsupported | P14; P17; DW3/P20 для собственного executor; P11 только если выбран extension путь | Inventory и execution различимы; exact page/frame bound; unsupported action недоступен; late/partial result не приводит к replay | F4 |
| P13 | Desktop automation macOS/Windows | Computer Use в самостоятельной среде | Actual owned-background-fixture capture/JPEG→literal AX type+Cuaexact и отдельный fresh1120×624→approved click280,290→AXPress/CuaCounter1→canonical final3/3review_required подтверждены | Real provider/account, Windows/installed delivery отдельно; generic CG pixel fallback не упражнялся, execution/application fixture outcome не general verified task | P14/P17; OS facility; DW3/P20; отдельная поддержка каждой ОС | Реальная capture→input→fresh observation в exact window/process; stale input отклонён; permission unavailable виден; успех одной ОС не объявляет поддержку другой | F4, по платформам |
| P14 | Input связан с наблюдением | Защита от действий в старой вкладке/чужом окне | Actual native capture/type/freshclick и pendingmetadata fixes сохранены; bounded old-host-tool-pixel projection source реализована, connected provider+parser2/156 с4observe/5FAKErequests, source.input-only provenance fix reviewed  Явный waitForForeground входит в сохранённые args и approval fingerprint; helper ждёт ручной возврат без активации, сохраняет original image/frame/focus и получает private baseline только после matching preflight. Actual UI approve→pending→cancel и native permission preflight прошли; [границы](../reviews/2026-10-19-desktop-foreground-handoff.md).| Положительный реальный CG-клик через новый handoff, отдельные AX read/verifyProperty и installed acceptance. Подготовлен собственный mouse-only fixture; первый exact observe ждёт отдельного подтверждения пользователя. Receipt ввода не доказывает результат приложения. | Реальный consumer P11–P13; один action owner | Refs/coordinates другого или устаревшего наблюдения отклоняются до input; partial batch не называется rollback; новая observation не даёт новых разрешений | F4, до первого provider input |
| P15 | MCP/plugin discovery, install и runtime | Инструменты собственного Agent mode с понятным источником | Official frozen filesystem 1.0.0 runtime сохранён; реальные 14 схем и macOS sandbox. Ручная Native-задача и Goal выполнили write/read через отдельные подтверждения, file-SHA и QA verified_complete; установка/учётные данные разделены. | OAuth/секреты, расширение поддержанного каталога и итоговая installed acceptance; общий P15 ещё не объявлен завершённым. | DW3; P17/P20; credential owner; official distribution policy | Advertised tool не равен execution proof; exact server/process/account; uninstall/stop не теряет active operation; не восстановлены исключённые overlays; unsupported install явен | F3 |
| P16 | Skill discovery/import/update/routing | Явно выбранные инструкции для собственного composer | Immutable text/UTF-8, PNG/JPEG, JS/MJS, Python v4 и PDF v5 с прежними real Native proofs сохранены. Добавлены explicit offline pure-wheel Review/Prepare→task-generation Attach→per-call approval; actual dateutil2.9.0.post0+six1.17.0 environment31files/479554B. Real Native Goal:1Run/2offers/1GUIapproval/1auto_step,CSV182B,17independent+32canonical checks, main observer/r1/QA verified_complete без manual Step. [Evidence](../reviews/2026-10-19-python-environments.md).  PEP508 markers/extras/exact URLs and Linux native-wheel validation are implemented. Actual selected in-tree PEP517 Review/Prepare/Attach→second-VM import returned102 with exact marker and physically stopped owners. [PEP517 proof](../reviews/2026-10-19-pep517-environment-acceptance.md).| Installed GUI/task binding and signed production use; additional distributions/backends/data schemes, arbitrary binary/network resources and full PDF OCR/visual interpretation. Update remains separate from attach. Full P16 remains open. | DW3/P15; разрешённые roots; официальный plugin источник | Выбранный skill соответствует canonical identity/digest; scan только разрешённых roots; metadata не даёт файловых прав; update сохраняет нужные local adaptations | F3 |
| P17 | Command sandbox и filesystem policy | Настоящие ограничения собственного tool host | MCP/JS/MJS/Python/PDF macOS containment сохранён. Environment data read-only, не executable-mapped; shared runtime brand/full dispatch checks, overlap refusal до run staging, Darwin lock/signed pending/exact reconcile без replay. Store:retained passive+4mac/50; provider3PASS; kernel:affected import1/13+retained cancel/reap. Actual environment-backed Native CSV verified отдельно; readiness warm-before-advertise2/108 сохраняет account/freshness/pins.  Product ToolJournal/UI/export and actual C/CPython VM builds have separate accepted evidence; actual PEP517 derived native environment import now also passed. [PEP517 proof](../reviews/2026-10-19-pep517-environment-acceptance.md). Реальный host-broker HTTPS GET200/577B, exact duplicate без нового transport effect, durable readback/revoke/close проверены [отдельно](../reviews/2026-10-19-host-network-acceptance.md); это synthetic QA owner, без VM и guest route.| Windows/Linux host sandbox; installed signed runtime/VM use, live network and recovery cases. Guest remains offline with no NIC/host shares; separately approved host network broker does not grant guest sockets. Existing global-metadata/system-library/Seatbelt boundaries remain explicit. Full P17 remains open. | DW3; workspace registry; platform-specific sandbox facility | Denied действие не исполняется; symlink/root escape закрыт; native exec не назван изолированным без OS proof; unavailable sandbox блокирует соответствующую route | F3; необходимый контракт для F2 mutations |
| P18 | QuickJS/WASM composition | Меньше round trips у клиента без подходящей composition | Gateway/native composition существуют; конкретный дополнительный interpreter не реализован | При измеримом gap — один bounded interpreter и allowlisted tool callback; без собственной FS/network authority | Конкретный consumer/сравнение; P17/P20 для callback; поддержанный runtime | CPU/memory/call/output limits реально останавливают JS; callback перепроверяет authority; timeout не отменяет уже accepted external operation | F5, условно по gap |
| P19 | Поддержанный локальный read-only API | Внешний monitor/integration получает правдивый status | Реальный bundled CLI local-api прочитал status/Agent metadata/history coverage; absent generic source дал503, read key не получил admin/history authority; disable отозвал ключ. Прямой loopback transport исключает proxy env. | Итоговая installed acceptance и дополнительные consumers по конкретной потребности; unknown/unopened sources не запускать ради чтения | Existing passive owners; отделение от P20 | Host/origin/auth checks; unavailable/stale сохраняются; reads не repair/start/send; stalled reads ограничены; секреты и raw transcript не выходят | F3; возможно раньше executor |
| P20 | Action API и automatic sender | Один управляемый вход действий UI, Goal и внешней интеграции | Named CLI explicit Pause на реальном Agent owner вернул stable action ID; подтверждённый repeat дал duplicate receipt без второго перехода, zero offers. Synthetic transport/409/204/205 проверяют unknown без resend; 8tests92asserts. | Более широкие provider actions и installed acceptance; ambiguous operation сначала reconcile у owner, новое действие не автоматизировать | DW3/DW4; exact client/provider capabilities; P19 отдельный read contract | Duplicate request возвращает прежний receipt; unknown acceptance не пересылается; auth не даёт лишнего scope; cancel/stop/restart сохраняют outcomes; нет второго sender внутри status API | F3 |
| P21 | Cross-client usage dashboard | Обзор разных локальных клиентов без потери происхождения | Реальный UI/native picker импортировал один Codex0.163.0 rollout:3records,15487input(4864cached внутри),152output; совпало с Native receipts. Repeat не увеличил totals; may-overlap исключён из external aggregate, source paused, metadata private. | Дополнительные реальные клиентские форматы и installed acceptance; полнота всех аккаунтов не заявлена | Supported parser contracts; explicit log access; existing usage store projection | Нет chat content; observedAt/coverage/unknown видимы; rotated log не удваивает числа; bridge и client totals не складываются дважды | F5 |
| P22 | Cost estimates и сравнение экономии | Понятная оценка альтернативной стоимости | Pricing catalog/estimated-api-equivalent views подключены; реальные15639tokens без exact pricing дали amount:null/unpriced15639 и source исключён из aggregate. | Real selected catalog/consumer; actual bill/savings не заявлять; overlapping/unknown sources не суммировать | P21; actual provider usage и versioned pricing там, где доступны | Estimated context × calls подписано estimate, не bill; unknown не ноль; alternative comparison не называется фактической экономией; пересечения исключены либо показаны отдельно | F5 |
| P23 | Compaction, updater, accounts и routing | Сохранение контекста, обновлений и account isolation при расширении | Owners сохранены; localtools offline/heldMCP, реальные Native shutdown/Goal continuation, явный Close/Resume и full restart проверены. Исправлены offscreen bounds после resize и регистрация поверхности после смены документа; actual Electron/queue checks прошли. Явный Native owner recovery реализован по [контракту](native-owner-recovery.md): transaction/UI/macOS observer проверены; actual main pins допущены, но архивирование безопасно блокируют действующие production CLI. | Положительное архивирование с actual main pins при отсутствии конфликтующих CLI; финальная installed macOS acceptance. Легаси-маркеры консервативно блокируются любым тем же official CLI, без force/kill. | Архитектура текущих compaction/update/account modules; новые routes по scope | Observability без replay authority; checkpoint публикуется после durable write; update signature/commit/rollback сохранены; чужой account/runtime не заимствуется | Сквозной |
| P24 | Пропорциональный CI и delivery | Быстрое развитие с доказанным нужным результатом | Существующие focused checks/CI и architecture map; чужой full audit не переносится | Checks новых изменённых contracts и нужных release targets; архитектурные docs/map вместе с изменением; один integrated verification owner | Связанный законченный batch; development proof перед release | Неизменённые passing checks переиспользованы; failure до fault boundary не считается rollback proof; build/source/merge/install/live результат разделены; broad suite не запускается по умолчанию | Сквозной |

## Полная таблица реализации: длительная работа и история

| ID | Возможность | Польза | Текущая реализация фактически | Осталось реализовать | Зависимости | Приёмка результата | Этап |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DW1 | План и checklist покрытия | Видно, какая часть исходного запроса выполнена и чем подтверждена | Real ledger1/36 + actual UI requirement consent rev1→step/action/user-confirmed1/1→correctionrev2 counts0/1, history retained; propertyverification unavailable | Native machine property verification здесь не заявляется; добавлять конкретные observers по реальной потребности, personal confirmation не machine proof | N03–N06; supported native events; отдельная content policy | Lookalike tool/prompt не становится plan; completed модели не verified; correction инвалидирует старое coverage; source/build/release свойства различимы | F1 |
| DW2 | Дерево workers, status и reuse | Возврат к контекстному исполнителю без создания лишнего | Owned persistent Native create/continue и явные Close/Resume проверены. После полного app restart public Resume восстановил тот же Native thread: три bindings/две server generations, recall marker без повторения во входах; no auto-send. | Reuse/continue внешнего клиента и итоговая installed acceptance; legacy v1 без history identity и чужие threads не возобновляются. | DW1 identity; exact thread/family; supported app-server/client contract | Две семьи с одинаковым name не смешиваются; tab close не завершает worker; restart не запускает; disconnected status unknown; follow-up revalidates identity | F1 |
| DW3 | Persistent Agent workers/mailboxes | Самостоятельная параллельная работа и reusable sleeping workers | Durable runtime/claims/receipts/Native bridge; Native task capacity до2 с legacy1, точное освобождение terminal subscription до fan-in; реальные модели, Manual/Goal с MCP, двухцикловый mailbox Loop и отдельные persistent Native conversations create/continue/fork подтверждены.  Real task ba56fe67 subsequently completed four Native offers: two roots with 6236ms overlapping acknowledgements, fan-in and substantive revision2 correction. A separate discovery race was fixed (2cases/26assertions). See native-semantic-goal review. | Controlled real parallel Goal/correction accepted; sustained multicycle business outcome, interrupted real-offer recovery and installed acceptance remain. Agent workers remain ephemeral by default; persistent conversations are a separate explicit mode. | P17/P20; workspace/P05 по сценарию; один top-level task owner | Crash до/после accept/ACK не теряет и не дублирует инструкцию; late result сохраняется; unknown send не replay; concurrency соблюдена; at-least-once не назван exactly-once эффектом | F3 |
| DW4 | Staged task-plan executor | Длинная задача движется по содержательным этапам | Этапы/dependencies/correction и один владелец; UI задаёт два независимых корня и общий зависимый этап, final не публикуется до exact unload; real Manual/Goal прошли по3 Native offers с2 MCP исходами и файловым результатом. В real Loop второй содержательный mailbox item заменил instruction текущего цикла, выполнен без replay первого.  Real task ba56fe67 subsequently completed four Native offers: two roots with 6236ms overlapping acknowledgements, fan-in and substantive revision2 correction. A separate discovery race was fixed (2cases/26assertions). See native-semantic-goal review.  Actual Loopde24a923 subsequently passed GUI Pause/admission refresh/correction/Run with preserved U and three real offers; current-packet correction loss fixed (2cases/24assertions). | Sustained tasks, interrupted active-offer recovery and installed acceptance remain. Controlled GUI correction and semantic context carryover accepted; no personal human verification or operational business completion claimed. | DW3/P20; исходные requirements с первой инструкции | Duplicate finish не запускает следующий этап дважды; correction важнее auto-step; restart не переигрывает uncertain dispatch; unchanged passing check не повторяется | F3 |
| DW5 | Opt-in transcript и Markdown export | Переносимый результат и восстановление контекста | Selected-text/canonical RPC→SQLite1/43/native17 и actual empty-page consent/revoke UI. Owned final-summary source связан с provider/main receipts/oneSQLite/HTTP/IPC/UI: defaultOFF, global+task-generation future consent+risk ack, pre-offer lease, actual IDs/time/source/digest, persistent all-source task-generation revoke; backend1/44+P1 1/12, actualHTTP1/24 | Actual owned-history UI, real GPT-6-Astra final с provenance, поиск и отключение согласия проверены; full supported transcript/background subscription остаются отдельно. Explicit canonical refresh не background capture; unknown-secret risk не устранён known-pattern filter | Native/client event adapter; content opt-in отдельно от metadata ledger | Stream/edit/reload не дублируют; authored human/automatic различены; partial history явна; quota не удаляет активную историю молча; отменённый save не saved | F1 |
| DW6 | Локальный поиск истории | Найти exact сохранённое сообщение без полного сканирования | FTS/query/exact revision UI подключены; DEV selected synthetic answer и real Native final найдены; exact partial запись и сохранение после отключения проверены | Сохранять incremental edit/delete/retention ownership; поиск не обещает несохранённый transcript | DW5 storage/retention owner | Indexed/total/partial видны; edit/delete обновляют результаты; exact message переход; raw tool/credentials вне индекса; несохранённая история не обещается | F1 вместе с history |
| DW7 | Fork истории через клиент | Продолжить отдельную линию от выбранной точки | Реальный owned fork и fork-follow-up сохранили контекст. Отдельный v2 thread прошёл Close/Resume и full restart/Resume с recall; Resume сам не отправляет сообщение, каждое Send явно. | Attachments parity и кооперативный fork/handoff внешнего клиента; проверенные own-created text contexts не дают authority на чужую историю. | DW5 context; supported fork method; P20 для action receipt | Исходная ветка сохранена; duplicate action не создаёт второй fork; exact point/partial seed видны; replay всего prompt не маскируется под fork | F1; standalone branch F3 |
| DW8 | Ручные code snapshots | Сохранить рабочее состояние и вернуть выбранные файлы | Actual DEV snapshot alpha→beta→restore alpha с beta before-image и managed-worktree Open завершены | Новые archive/lifecycle UI изменения проверять отдельно; passing snapshot/restore/Open переиспользовать | Явный workspace owner; P07/P09; history link полезен, но не обязательный блокер | Dirty/untracked сохранены; ignored/binary/submodule scope объявлен; exact root/path/hash; concurrent edit вызывает conflict; failed test не запускает auto rollback | F2, первый checkpoint результат |
| DW8a | Автоматические per-turn checkpoints | Действительно восстановимое состояние до agent writes | Actual Manual DEV task подписал exact grant и pre-turn snapshot 6-byte hello; Pause gen2 и revoke выполнены; immutable receipt store подключён | Расширения snapshot-only scope не обещать; native-client generic pre-write hook и весь machine filesystem не охвачены | DW8; supported exact boundary hook; P17 execution owner | Пропущенный hook даёт unavailable; человеческие concurrent edits сохранены; post-turn diff не назван pre-turn snapshot или полным rollback | F2 после DW8; собственный hook F3 |
| DW9 | Ручной Goal helper | Найти оставшуюся работу по требованиям и наблюдённым исходам | Actual Manual UI: SHA passed/Review → external drift → Verify409; restore+new observation → current Review → verified_complete; immutable facts сохранены | Semantic independent helper/provider отдельно; выбранное file property не сертификат всего deliverable; unchanged SHA drift/recovery не повторять | DW1/DW5; evidence adapter; provider contract; отправка через существующего owner | Missing/failed/unknown не done; incomplete input виден; correction инвалидирует review; recommendation не самосертификат; тот же revision без новых facts не проверяется снова | F3, до автоматического Goal |
| DW10 | Автоматический Goal для конечного результата | Доведение разрешённой задачи без ручного повторения follow-up | Явный Goal Run, процессное exact-scope разрешение и один durable auto_step сохранены; прежние MCP/Python/PDF/SSH Goals подтверждены отдельно. Новый selected-environment Goal:1Run/2Nativeoffers/1GUIapproval/1auto_step, dateutil+six,CSV182B/SHA,17independent+32canonical checks, main observer/r1/Review+QA Verify→verified_complete без manual Step. Первый отдельный task NOT_SENT/0offers остановлен, не replay; generic receipt не доказывает exact failure code. [Evidence](../reviews/2026-10-19-python-environments.md). | Более длинные Goals/semantic review и installed acceptance. Процессное разрешение не восстанавливается после перезапуска; требуется новое явное Run. QA approval не личное human approval. | DW9; DW3/P20 для Agent mode либо supported client follow-up; существующие approvals | Goal/Loop/Off не оживляют старую generation; user input/approval/active workers первичны; unknown send не replay; завершение по наблюдённому coverage; unknown spend не объявлен нулём | F3 после ручного helper |
| DW11 | Непрерывный Loop | Явно заказанная повторяющаяся работа | Реальный GPT-6.1-Sol Loop: cycle1 → новый содержательный mailbox item → auto cycle2; два canonical finals, duplicate сохранил2 dispatches/1packet при maxTurns3. UI Pause дал gen3 и снял loopRun; externalWatchers:false.  Meaningful service-risk Loopde24a923 used M then new mailboxU: two cycles, correct changing risk; GUI correction after restart retained U in canonical Native input and produced decision-status output, three offers total within bound4. Final GUI Pause and exact cleanup accepted. В source .12 добавлен selected local-file metadata source; targeted checks и controlled DEV UI приняты отдельно (checkpoint ниже). | Generic network/external watchers и восстановление retained stale-owner lock остаются unsupported. Indefinite recurring reliability и installed acceptance остаются открыты. Controlled synthetic semantic review is not operational remediation or verified_complete. | DW3/DW10; explicit recurring instruction; P20 | Нет пустого Continue; unchanged state ставит на паузу с причиной; stop не теряет late results; approval/unknown не перескакиваются; расход/параллельность ограничены | F3 после конечного Goal |

Таблицы содержат **8 строк N01–N08, 24 строки P01–P24 и 12 строк DW1–DW11
с отдельной DW8a, всего 44**. P09 — интерфейс выборочного restore, DW8 — владелец snapshot;
DW8a — автоматическая связь с реальной execution boundary. Это связанные части,
а не три независимых механизма записи. Аналогично P20 обслуживает все actions,
а DW3/DW4/DW10/DW11 не получают каждый свой sender.

## Интеграция и определение готового пользовательского результата

Работа продолжается связанными пакетами: например, root picker → дерево →
preview/edit → conflict/save → Git diff; или opt-in → canonical capture → search
→ exact message → export/fork. Нельзя считать результат завершённым по одному
service class или кнопке. Для затронутого сценария готовность означает:

1. Пользователь проходит основной путь через подключённую поверхность приложения;
   важные loading/empty/error/busy/permission состояния имеют понятное действие.
   Недоступная capability не имитируется и не вызывает неподдержанный метод.
2. Есть один owner состояния и live resource; exact workspace/account/thread/turn
   остаются привязаны к операции. Restart, cancellation и uncertain outcome
   сохраняют данные и receipt; повтор не становится новым отправителем.
3. Получено наблюдение нужной границы: fixture — для contract, development UI —
   для взаимодействия, реальный provider — для provider результата. Модельное
   completed остаётся claim; `verified` ссылается на source event, subject revision
   и проверенное свойство. Build не доказывает установленный app или business result.
4. Закончены связанные изменения и исправлены существенные findings; выполнен
   один focused pass основного сценария и существенной ошибки. Уже прошедшие
   неизменённые проверки используются повторно. Новая ошибка получает targeted
   follow-up, без автоматического full suite/audit или повторения всей программы.
5. При изменении ownership/entry points/IPC/persistence обновлены соответствующие
   [архитектура](../../ARCHITECTURE.md) и [extension guide](../development/extending-nekodex.md),
   а source/module-map — по правилам репозитория. Документ сам по себе не требует
   сборки, установки, изменения аккаунтов или запуска архитектурного генератора.

Минимальная development проверка изменённого поведения предшествует packaging,
signing, installed replacement и release. Source commit/PR может сохранять
промежуточный reviewable результат. Установка, migration, процесс текущей версии
и live capabilities фиксируются отдельно, только после фактического результата.

## Текущий checkpoint программы

### Source batch .12 — 19 октября 2026 года

Текущая связанная партия исходников — `6.1.32-nekodex.12`; это **ещё не
установленная версия** и не release acceptance. Исторический baseline ниже
сохранён отдельно; все 44 ID остаются в программе.

- **DW11 / selected local metadata source:** main/IPC/preload/UI и owned-core
  enqueue интегрированы. Источник по умолчанию выключен, работает только с явно
  выбранным файлом ранее разрешённого локального проекта и действующим explicit
  Loop Run; передаёт ограниченные metadata/SHA, без содержимого файла. Targeted
  проверки сохранены. Root принял actual controlled DEV UI: один event доставлен,
  естественный переход cycle1 → cycle2 сохранён, Pause снял источник; выполнены
  два synthetic offers, внешних provider calls не было. Это проверка выбранного
  локального источника, а не generic network watcher или бесконечной надёжности.
  При retained owner lock после unclean exit watcher явно unavailable;
  восстановление прежнего physical owner/unfinished enqueue не реализовано.
- **OAuth MCP:** reviewed binding, transport, core/main lifecycle и UI
  интегрированы и имеют controlled targeted checks. Реальный provider остаётся
  unconfigured; actual OAuth authorization, discovery и tool effect этим не
  подтверждены. *Статус на 21 октября 2026 года: реальные Linear authorization,
  discovery и один одобренный tool call приняты в установленной `.13` — см.
  «Статус 21 октября 2026 года».*
- **Связанные исправления:** Native dropdown refresh, copy/отступы, повтор
  shutdown после отказа и обработка schema unions входят в эту source-партию.
  Их сохранённые focused результаты не подменяют итоговую installed-проверку.

### Сохранённый baseline .9/.8

Порядок платформ остаётся прежним: **весь macOS набор, затем Windows/Linux**.
N01–N08 source и D01 installed-migration сохранены. Текущая исходная версия `.9`
имеет настоящие Native text/model/history и official MCP runtime результаты,
описанные выше; установленная версия пока `.8`. Все оставшиеся строки программы
сохраняются в объёме работы.

Selected Python environment/GUI/readiness партия прошла локальные и реальные
проверки; её точный опубликованный head и CI фиксируются в draft PR #98 и таблице
статусов задачи отдельно от development evidence. Native физически закрыт,
разрешения тестовой задачи отозваны, активных инструментов/скриптов нет. Небольшой
workspace с принятым CSV оставлен для повторной проверки. Установленная `.8`
не менялась; релиз и итоговая installed acceptance остаются отдельным этапом.

| Порядок | ID | Следующий проверяемый результат |
| --- | --- | --- |
| 1 | P16–P17 | Retain pure-wheel Native Goal, real product VM/export/C-CPython and [actual PEP517 environment build→attachment→import](../reviews/2026-10-19-pep517-environment-acceptance.md). Next verify the installed signed VM/task flow and remaining network/recovery boundaries; do not replay the unchanged accepted builds. Other distributions, general resources and Windows/Linux remain in scope. |
| 2 | DW3–DW4, DW9–DW11 | После проверенных Native/MCP/Python/PDF/SSH Goals и двух циклов Loop — длинные смысловые этапы, несколько workers, semantic review и независимое прикладное outcome evidence. |
| 3 | DW2, DW7 | После проверенных owned continue/fork и restart Resume — attachments parity и explicit exclusive handoff внешнего клиента. Legacy v1 без identity и чужие threads автоматически не принимаются. |
| 4 | P03–P08 | После real SSH/SFTP/worktrees, Native→remote Goal и полного remote Git Review24/24 — реальный сетевой обрыв/unknown recovery и долгие операции. Пройденные сценарии не повторять без изменений. |
| 5 | P11–P16 | Real-model browser/desktop/vision, trusted application outcome, ChatGPT send/Firefox, remaining skill resource types и auth/OAuth. |
| 6 | P19–P22 | Сохранить проверенный actual CLI/API consumer и metadata-only real usage import; добавить прикладные consumers и разрешённые pricing sources с честным разделением usage/estimate/bill. |
| 7 | P23–P24 | Связанный финальный macOS acceptance и только после него необходимая packaging/installation. Затем Windows/Linux adapters и parity. |

Сейчас один root владеет интеграцией и запуском development target. Вспомогательные
read-only проверки не запускают свои GUI, серверы или модельные задачи. Каждая
новая проверка использует сохранённый профиль и текущего owner; история и credentials
не копируются между инсталляциями.

### Новая source-партия поверх установленной .12 — 19 октября 2026 года

Установленная `6.1.32-nekodex.12` и её исходный commit
`4ea88cccb901811e6054c228faac6058ee9f772c` остаются отдельным delivery baseline.
Эта source-партия продолжает указанный baseline:
связанные source reviews и focused checks приняты, root выполнил указанные ниже
DEV GUI сценарии. Их сборка/установка как новой версии и real-provider acceptance
не заявлены. Этот checkpoint дополняет прежние состояния, не переписывая их.

- **DW11 / явное восстановление selected-file owner:** реализованы Review и
  отдельное подтверждённое Recover при доказанном отсутствии прежнего JS PID.
  Проверенные lock/registry архивируются с сохранением идентичности; источники
  остаются OFF, `pending` становится `unknown`, повторной enqueue нет. Живой,
  reused или непроверенный PID и изменённые metadata приводят к отказу.
  Прерванная recovery-транзакция сохраняет gate и точный recovery ID/receipt,
  обнаруживаемые после restart для read-only inspection; автоматического
  продолжения нет. Root принял actual DEV GUI восстановление отсутствующего
  child owner `31377`: receipt `8b87ee39-cb1a-4042-bcb4-20fe2cd537db` —
  `completed`, новый source owner получен, выбранный источник выключен.
  [GUI receipt observation](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/source-next-20261019/dev-acceptance/loop-recovery-after-ax.txt).
  Recovery не создаёт Run/Enable; последующее чтение требует отдельного Enable
  и текущего действующего explicit Run.
- **DW11 / зарегистрированный внешний producer:** root прошёл actual DEV GUI
  Run → Review/Register/Copy, затем передал credential через no-echo native PTY
  и piped stdin настоящему CLI. Реальные source HTTP/runtime/SQLite приняли
  ровно одно событие при `eventBound:1`; сохранились один packet и естественный
  переход cycle1 → cycle2. GUI Revoke/Pause завершили сценарий, CLI вышел с 0,
  terminal закрыт, credential не печатался. Модель была controlled: два synthetic
  offers, **ноль external provider calls**. Это конечный зарегистрированный
  ingress с Run/bound/receipt, не generic network discovery/watcher и не
  доказательство indefinite recurring business outcome.
  [Acceptance receipt](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/source-next-20261019/dev-acceptance/external-acceptance.json).
- **DW2/DW7 / owned canonical text/history:** новый explicit text mode,
  canonical human/assistant text, private current-principal/worker claims,
  отдельные recording consents, sticky revoke и pre-offer first-capture fences
  реализованы и имеют focused source/controlled evidence. Найденный revoke
  до thread ACK закрыт; полный исторический transcript, external exclusive
  handoff и реальный provider результат этим не доказаны. Actual real-provider
  проверка сейчас **заблокирована**: прежний Native lock PID отсутствует, но два
  действующих production tunnel-client app-server делают process census
  неоднозначным. Эти процессы и retained state сохранены; новый real-provider
  model turn и capture не получены.
  [Physical-owner observation](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/source-next-20261019/dev-acceptance/native-recovery-process-proof.json).
  *Статус на 21 октября 2026 года: real-provider проверка выполнена в установленной
  `.13` — canonical first pair, fork точного хода и recall 81; полный transcript и
  external handoff по-прежнему не заявлены. См. «Статус 21 октября 2026 года».*
- **P03–P08 / реальные remote mutation faults:** на unchanged source `4ea88cc`
  подтверждены три границы: exclusive SFTP temp WRITE до ACK, final atomic
  rename до ACK и managed Git worktree create с живыми remote children перед
  TCP loss. Production service использовал настоящий OpenSSH/SFTP/Python/Git
  через изолированный loopback sshd, без transport/runner mocks. `unknown`
  пережил restart, новые mutations отказывались без resend; реальные reconnect
  reads, независимые filesystem/Git observations и отдельная проверка physical
  exit предшествовали явной reconciliation. Это source-service real-network
  evidence, не installed GUI или внешний remote account acceptance; долгие
  lifecycle и остальные fault boundaries остаются отдельными.
  [Scope and provenance](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/local-app12-final/remote-mutation-faults/README.md),
  [combined receipt](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/local-app12-final/remote-mutation-faults/receipt.json).

Таким образом, прежнее ограничение DW11 «stale-owner recovery unsupported»
снято для явно проверенного отсутствующего JS owner; registered external ingress
также имеет отдельное DEV acceptance. Generic watchers, произвольное продолжение
прерванной recovery, бесконечная надёжность, полный transcript/внешний handoff и
новая installed/real-provider acceptance не объявляются завершёнными. Все 44 ID
и оставшийся объём программы сохранены.


**P15 / подготовка реального OAuth-провайдера.** По поручению пользователя
выбран официальный Linear MCP read-only endpoint и только scope `read`.
Один public Dynamic Client Registration запрос завершён HTTP201; отдельный
публичный client ID и exact loopback redirect сохранены в локальном файле
регистрации. NEKODEX теперь проверяет и сохраняет `loopback-exact`, связывает
listener с зарегистрированными host/port/path и отказывает при занятом порте
без fallback. Broker независимо проверяет URI; прежний variable-port mode
сохранён. Три focused actual-loopback/occupied-port/persistence cases и
независимый review приняты; core/renderer TypeScript прошли. Это регистрация
публичного клиента, а не вход в Linear, account grant, refresh/revoke или
выполненный MCP tool. Импорт в текущий аккаунт и реальный OAuth callback ещё
требуют admitted Native authority и отдельного пользовательского consent.
*Статус на 21 октября 2026 года: в установленной `.13` выполнены Read consent,
защищённый callback, discovery и один одобренный вызов; см. «Статус 21 октября
2026 года».*
[Official Linear MCP](https://linear.app/docs/mcp),
[Public setup receipt](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/source-next-20261019/oauth-linear/configuration-readiness.json).

DEV core31382 и main31387 после этой приёмки штатно закрыты, без force signals;
исходные config/launcher-state восстановлены byte-for-byte, source owner lock
снят. Действующие production процессы сохранены.
[Cleanup receipt](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/source-next-20261019/dev-acceptance/cleanup-restoration.json).


### Browser session presentation — 19 октября 2026 года

Успешный текущий session probe теперь снимает прежнюю ошибку проверки входа
при завершении известной login/session operation. Auth identity и owners не
меняются; ошибки навигации, сторонних операций и недоступная проверка сохраняются.
Это устраняет противоречие между зелёным подтверждением входа и красными
индикаторами браузера. Focused `BrowserHost.runAuthenticationProbe` case и
независимый review прошли; actual DEV после загрузки исправления сохранил вход,
показал зелёную вкладку ChatGPT и убрал красную отметку sidebar. Этот UI result
не подтверждает общий model/connector readiness или новую installed поставку.

Дополнительные finite acceptance receipts закрывают actual DEV local Git
Stage/Unstage/full-index Commit с сохранением раздельных worktree/untracked bytes,
real SSH full-index commit ACK loss без resend и GUI import поддержанных
Claude/Gemini fixtures с отдельным пользовательским synthetic pricing catalog.
Данные и ставки этих usage fixtures синтетические; исторические расходы аккаунта
и фактический счёт ими не подтверждаются.


P16 scoped readiness теперь использует тот же native scope parser, что и picker:
несовместимая API-задача получает недоступность до выбора файлов с понятной
EN/RU причиной. Общий Agent-mode API и UUID VM-контракт не менялись. Один
реальный HTTP status regression принят; ранее выполненный UUID GUI
picker/build/attach/revoke переиспользован без нового VM запуска.

### Статус 21 октября 2026 года

Сверено 21 октября 2026 года по `main`, ветке `fix/codex-hook-and-recovery-20261021`
и сохранённым evidence. Записи выше не переписаны; где они расходятся с этим
статусом, действует этот статус. Все 44 ID сохранены, ALL44/macOS не завершён.

- **Merge:** стек [#96](https://github.com/Froraut/NEKODEX/pull/96),
  [#97](https://github.com/Froraut/NEKODEX/pull/97), [#98](https://github.com/Froraut/NEKODEX/pull/98),
  [#100](https://github.com/Froraut/NEKODEX/pull/100) и [#101](https://github.com/Froraut/NEKODEX/pull/101)
  влит в `main` 20 октября (`296addd`); затем [#103](https://github.com/Froraut/NEKODEX/pull/103),
  [#104](https://github.com/Froraut/NEKODEX/pull/104) и [#105](https://github.com/Froraut/NEKODEX/pull/105)
  (`3b1d081`). CI обоих merge commits успешен.
- **Установка и release:** локальные сборки `6.1.32-nekodex.14`…`.20` установлены
  последовательно: `.14` — 20 октября в 13:34 UTC, текущая `.20` (эта ветка,
  `5a45350`) — 20 октября около 23:00 UTC (21 октября по Минску). Публичных release
  после `v6.1.28-nekodex.1` не было: DMG/ZIP и notarization не выполнялись.
- **Установленная `.13`** (результаты в теле [PR #98](https://github.com/Froraut/NEKODEX/pull/98)):
  официальный Native вход и catalog из десяти моделей; реальная baseline 4014;
  canonical first pair и fork точного хода с recall 81, после чего consents
  отозваны и global recording OFF; PNG-only vision совпал с независимым withheld
  ответом; named Goal interruption освободил точного owner без replay.
  [Acceptance](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-login-20261020/acceptance.json).
- **P15 / OAuth MCP:** Linear Read consent, защищённый callback и authenticated
  discovery завершены. После отдельного human approval выполнен ровно один
  `search_documentation`; один MANUAL Step продолжил тот же worker
  (review_required 2/2, pending 0). Затем Refresh → connected, Revoke → revoked,
  MCP OFF/servers=[].
  [Lifecycle](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-login-20261020/linear-oauth-lifecycle.json).
- **P16 / P17:** в установленной `.13` принят native-package VM consumer: одна
  offline build, attachment и human-approved `vm-shell/run` с импортом C-extension.
  20 октября около 00:59 UTC приняты typed image read через `skill-resource/read`
  (PNG 5909 B, итог совпал с withheld oracle) и public GET `https://example.com`
  через `vm-network/request` (HTTP 200, 577 B): оба `independent-final-acceptance.json`
  имеют `passed: true`. Затем обе задачи остановлены, network grant и managed skill
  version отозваны.
  [P16 image](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-login-20261020/p16-native-consumer/skill-resource-image/independent-final-acceptance.json),
  [P17 GET](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-login-20261020/p17-native-network-consumer/independent-final-acceptance.json).

Остаётся открытым:

- **P11:** реальная отправка в ChatGPT; Firefox load/pair/lifecycle (официальный
  Firefox 158 с отдельным QA-профилем остановлен на экране Terms, temporary add-on
  не загружен); подписанная distribution.
- **P12–P13:** real-model/real-app acceptance browser и desktop.
- **DW9:** семантическая проверка Goal.
- **DW2, DW5, DW7:** внешний client reuse/exclusive handoff и полный transcript не
  заявлены.
- **P23:** положительное архивирование owner recovery.
- **P24:** packaging, notarization, публикация.
- **Этап 2:** Windows/Linux.
- **P18:** QuickJS/WASM — только при измеренном composition gap.

Границы, явно названные unsupported в таблицах и связанных контрактах, принятыми
приёмками не расширяются.
