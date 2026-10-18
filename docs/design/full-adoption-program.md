# Полная программа развития NEKODEX

Обновлено: 18 октября 2026 года. Рабочая ветка: `codex/full-adoption-20261018`.
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
| Workspace P03–P10, DW8–DW8a | Local editor/Git/base/snapshot/PTY; реальные SSH/SFTP read/save/command и remote worktree create/Open/archive; exact pre-turn scope | Реальный Native→remote Agent, сетевые обрывы, remote conflict/reconciliation и полный remote Git Review; local scopes не расширяются автоматически | Platform paths/SSH/PTY/packaging/ownership и то же сохранение пользовательской работы |
| Browser/desktop P11–P14 | Chrome MV3 fixture; native capture/type/AXPress на owned fixture; bounded image projection source | Real provider/model integration, task-bound browser flow, доверенный application-outcome observer; ChatGPT companion send/Firefox и заявленные native routes остаются открыты; generic CG fallback пока не verified | Native helpers/providers/permissions и browser compatibility по каждой ОС |
| MCP/skills/execution P15–P18 | Official install и Seatbelt; реальные Native Manual/Goal с MCP write/read и file-SHA; managed text/UTF-8/PNG/JPEG/JS/MJS packages | Реальный Loop, auth/OAuth и остальные executable/binary resources; distribution rules сохраняются. QuickJS условен до конкретного composition gap | Installer/runtime/private ACL/OS sandbox/skills resource adapters и lifecycle |
| Long work/history DW1–DW7, DW9–DW11 | Requirements/claims, selected-text export/search, durable fixtures; реальный Native-вход/каталог/две модели/история и ограниченный Goal с файловым verified_complete | Длинные semantic Goals, реальный Loop, полный transcript, supported client reuse/fork/exclusive handoff | Поддержанные client/protocol/process/event/persistence adapters и те же outcome boundaries |
| Local API/usage P19–P22 | Scoped API/action owner, metadata-only usage и honest unknown/overlap/estimate UI | Реальный named consumer, реальные разрешённые log/pricing sources; request/receipt reconciliation, actual bill/estimate разграничение | Platform source/parser/privacy и API integration contracts |
| Platform reliability P23–P24 | Действующие owners/целевые проверки, local offline tools+held SDK detach evidence | Закончить текущие TS/CLI gates и substantive findings; сохранить single owner/drain/cleanup и отдельные source/development/install/release receipts | Нужные target build/sign/package integrity и focused flow checks, не автоматический полный audit |

## Зафиксированное состояние

Сверено 18 октября 2026, 21:43 UTC. Исходники: `6.1.32-nekodex.9`,
ветка `codex/full-adoption-20261018`, [PR #98](https://github.com/Froraut/NEKODEX/pull/98).
Предыдущая опубликованная партия — `ebafab0`; её [четыре CI jobs](https://github.com/Froraut/NEKODEX/actions/runs/39165375018)
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
  Реальный macOS sandbox/script и UI fixtures проверены. Python/shell/PDF/другие
  binary/network resources остаются открыты.
  [Script/SSH evidence](../reviews/2026-10-18-restricted-skill-scripts-and-ssh-aliases.md).
- **Длительная работа:** correction/coverage, property drift/review, pre-turn snapshot,
  durable mailbox, bounded Loop и Goal owner имеют development/fixture evidence.
  Реальные Native ответы, история, Manual и Goal с MCP/file-SHA подтверждены.
  Длинные semantic Goals, реальный Loop и client reuse/fork/exclusive handoff
  остаются открыты.
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
| P04 | Удалённые команды и запись файлов | Работа Agent mode в выбранной remote среде | Реальные SFTP save/read-back и отдельно просмотренная команда с exit0/SHA проверены на временном репозитории. Agent remote authority/ToolJournal/signed receipts реализованы и имеют fixtures. | Реальный Native→remote Agent flow, живые сетевые uncertain-outcome/reconciliation сценарии и installed acceptance; командный cwd не OS sandbox. | P03; P17; единый P20 outbox для agent actions | Обрыв после send/write даёт unknown и reconciliation; нет слепого retry; результат, ошибка и partial outcome различимы; чужой host/root недоступен | F2 после P03; agent wiring F3 |
| P05 | Управляемые локальные worktrees | Изоляция параллельной работы и безопасное возвращение к ней | DEV UI create `codex/dev-ui-branch` с full OID и Open exact owned worktree→hello file tree наблюдены; lifecycle/archive guards в source | Только новые archive/lifecycle transitions при их изменении; client-owned worktrees остаются у клиента | Workspace registry; DW3 для собственного worker; client capability для клиентского режима | Exact marker/repo/root/refs; restart не создаёт новый worktree; dirty/untracked/ignored и чужая ownership защищают от удаления | F2 |
| P06 | Управляемые remote worktrees | Изолированные remote workers и повторное использование remote checkout | Реальный SSH Git worktree создан из закреплённого HEAD, открыт с исходным alias, прочитан и архивирован с сохранением папки/recovery ref. Начальная гонка list и потеря alias при Open исправлены. | Длительный remote worker lifecycle/reconnect и installed acceptance. Временные данные QA удалены отдельно после проверки; архивные квитанции сохранены. | P03–P05; P04 outcome reconciliation | Crash/reconnect сохраняет exact remote owner; uncertain Git mutation не повторяется; чужие refs/dirty data не удаляются; unsupported server показан явно | F2 после remote execution и local lifecycle |
| P07 | Git Review рабочего дерева/веток | Оценка изменений в собственной рабочей среде | Branch/base source+actual Git1/23 и actual DEV native-picker HEAD/older-base diff/full OIDs/main unchanged подтверждены | Real remote UI по выбранной среде; unchanged local selector/diff не повторять, выбор base не fetch/checkout | Явный local workspace; remote adapter отдельно P03/P06 | Открытый diff привязан к exact HEAD/base OID; смена состояния даёт stale; просмотр не делает fetch/checkout/commit | F1; remote расширение F2 |
| P08 | Редактор файлов | Исправления и review без ухода из NEKODEX | Local editor/save/conflict flow и реальный remote SFTP editor/save/read-back подключены и проверены. Изменение временного файла подтверждено независимой remote SHA-командой. | Реальное одновременное remote редактирование/обрыв и итоговая installed acceptance; неизменённые local checks повторять не нужно. | Local workspace authority; P04 для remote, без переноса прав из prompt | Поздняя external edit сохраняет draft и блокирует stale overwrite; staging/flush/rename не обнуляет оригинал; binary/large/remote limits видимы | F1 local; F2 remote |
| P09 | Выборочное Git/file restore | Вернуть конкретную правку, сохранив человеческую работу | Actual DEV selective restore после нового main вернул alpha и сохранил beta recovery before-image; прежний targetFile defect закрыт | Сохранять scope/revision checks и проверить только новые substantive изменения; unchanged restore evidence переиспользовать | DW8 snapshot owner; P07; P08 save authority | Новый concurrent edit блокирует stale restore; исходные bytes доступны; остальные файлы не меняются; повтор не применяет destructive действие второй раз | F2 вместе с DW8 |
| P10 | Native terminal docks | Человеческий shell в контексте workspace | Main/IPC/xterm связаны с real node-pty; DEV keyboard echo `NEKODEX_PTY_UI_OK` и закрытие наблюдены | Native PTY ABI/packaging и поведение Windows/Linux на этапе2; remote terminal по своему contract | Workspace identity; native PTY development proof; P03/P04 для remote | Input/resize в exact PTY; ограниченный output; close ждёт точный exit и сохраняет посторонние shells; human terminal не становится agent tool автоматически | F2 |
| P11 | Chrome/Firefox companion transport | Альтернативный ChatGPT transport там, где нужен внешний browser | Artifact copy/bundled resolver подтверждён 1/8; actual MV3 Chrome pair/select/observe/type/click/revoke 1/17, app listener enable/disable; send:false | ChatGPT send и Firefox не реализованы; headless popup document не доказывает видимый toolbar popup; distribution отдельно | Подтверждённый transport gap; existing turn registry; P14 | Один sender/settlement owner; disconnect/version mismatch не создаёт второй send; permissions ограничены; tab/account mismatch отклонён | F4, конкретный browser сначала |
| P12 | Browser automation provider | Веб-действия для standalone Agent mode и клиентской интеграции | Standalone browser builtin host/leaf/attachment/admin UI подключены к единому tool journal; actual Chromium/MV3 composition fixture1/49,5canonical requests, duplicate/restart без второго эффекта | Root actual DEV browser attachment/approval flow; real model/account отдельно; execution receipt не application business evidence; ChatGPT send unsupported | P14; P17; DW3/P20 для собственного executor; P11 только если выбран extension путь | Inventory и execution различимы; exact page/frame bound; unsupported action недоступен; late/partial result не приводит к replay | F4 |
| P13 | Desktop automation macOS/Windows | Computer Use в самостоятельной среде | Actual owned-background-fixture capture/JPEG→literal AX type+Cuaexact и отдельный fresh1120×624→approved click280,290→AXPress/CuaCounter1→canonical final3/3review_required подтверждены | Real provider/account, Windows/installed delivery отдельно; generic CG pixel fallback не упражнялся, execution/application fixture outcome не general verified task | P14/P17; OS facility; DW3/P20; отдельная поддержка каждой ОС | Реальная capture→input→fresh observation в exact window/process; stale input отклонён; permission unavailable виден; успех одной ОС не объявляет поддержку другой | F4, по платформам |
| P14 | Input связан с наблюдением | Защита от действий в старой вкладке/чужом окне | Actual native capture/type/freshclick и pendingmetadata fixes сохранены; bounded old-host-tool-pixel projection source реализована, connected provider+parser2/156 с4observe/5FAKErequests, source.input-only provenance fix reviewed | Реальные text Native ответы уже получены; bounded images source/fixtures сохранены. Следующий шаг — real-model vision и связанный UI/provider outcome; caps и fresh-observation проверки остаются. | Реальный consumer P11–P13; один action owner | Refs/coordinates другого или устаревшего наблюдения отклоняются до input; partial batch не называется rollback; новая observation не даёт новых разрешений | F4, до первого provider input |
| P15 | MCP/plugin discovery, install и runtime | Инструменты собственного Agent mode с понятным источником | Official frozen filesystem 1.0.0 runtime сохранён; реальные 14 схем и macOS sandbox. Ручная Native-задача и Goal выполнили write/read через отдельные подтверждения, file-SHA и QA verified_complete; установка/учётные данные разделены. | OAuth/секреты, расширение поддержанного каталога и итоговая installed acceptance; общий P15 ещё не объявлен завершённым. | DW3; P17/P20; credential owner; official distribution policy | Advertised tool не равен execution proof; exact server/process/account; uninstall/stop не теряет active operation; не восстановлены исключённые overlays; unsupported install явен | F3 |
| P16 | Skill discovery/import/update/routing | Явно выбранные инструкции для собственного composer | Immutable text/UTF-8, PNG/JPEG и restricted JS/MJS packages реализованы: exact import/attach/revoke, digest/quota и отдельные script grants/approval. Source63ab32f и ebafab0 опубликованы с успешным exact CI; macOS kernel/script и UI fixtures пройдены. | Python/shell/PDF/другие binary/network resources, поддержанные auth/OAuth и real-model skill flow; update не auto-attach. Неизменённые passing import/sandbox проверки переиспользовать. | DW3/P15; разрешённые roots; официальный plugin источник | Выбранный skill соответствует canonical identity/digest; scan только разрешённых roots; metadata не даёт файловых прав; update сохраняет нужные local adaptations | F3 |
| P17 | Command sandbox и filesystem policy | Настоящие ограничения собственного tool host | Custom macOS Seatbelt для MCP реально kernel-blocked outside FS/network; C fork inheritance при живом parent, Bun private HOME/SDK read+counter подтверждены; restrictedJS/MJS executor source+realmacOS61 added; freshinstanceownerP1/pinnedkernel3/39passed/peerP1closed/nofindings; arbitrary executor unsupported | Win/Linux sandbox; post-parent lifecycle proof; раскрытые metadata/systemlib/sysctl grants и deprecated interface учитывать; native command executor не заявлять | DW3; workspace registry; platform-specific sandbox facility | Denied действие не исполняется; symlink/root escape закрыт; native exec не назван изолированным без OS proof; unavailable sandbox блокирует соответствующую route | F3; необходимый контракт для F2 mutations |
| P18 | QuickJS/WASM composition | Меньше round trips у клиента без подходящей composition | Gateway/native composition существуют; конкретный дополнительный interpreter не реализован | При измеримом gap — один bounded interpreter и allowlisted tool callback; без собственной FS/network authority | Конкретный consumer/сравнение; P17/P20 для callback; поддержанный runtime | CPU/memory/call/output limits реально останавливают JS; callback перепроверяет authority; timeout не отменяет уже accepted external operation | F5, условно по gap |
| P19 | Поддержанный локальный read-only API | Внешний monitor/integration получает правдивый status | Versioned local-control-api routes/policy, separate credential, passive bounded sources и UI подключены | Наблюдение реального named consumer; unknown/unopened sources не запускать ради чтения; history content только отдельным scope | Existing passive owners; отделение от P20 | Host/origin/auth checks; unavailable/stale сохраняются; reads не repair/start/send; stalled reads ограничены; секреты и raw transcript не выходят | F3; возможно раньше executor |
| P20 | Action API и automatic sender | Один управляемый вход действий UI, Goal и внешней интеграции | Scoped Agent actions используют существующий Agent owner/store.command и durable dispatch; API не создаёт второго sender | Реальная external integration и reconciliation evidence; action scope/current generation mandatory, read-only default сохранить | DW3/DW4; exact client/provider capabilities; P19 отдельный read contract | Duplicate request возвращает прежний receipt; unknown acceptance не пересылается; auth не даёт лишнего scope; cancel/stop/restart сохраняют outcomes; нет второго sender внутри status API | F3 |
| P21 | Cross-client usage dashboard | Обзор разных локальных клиентов без потери происхождения | Opt-in import/UI реализованы; DEV synthetic metadata 100/20 tokens прочитаны без sentinel/CWD, unknown-source вне aggregate | Реальные выбранные client logs/parser-version scope; fixture tokens не доказательство аккаунтного provider usage | Supported parser contracts; explicit log access; existing usage store projection | Нет chat content; observedAt/coverage/unknown видимы; rotated log не удваивает числа; bridge и client totals не складываются дважды | F5 |
| P22 | Cost estimates и сравнение экономии | Понятная оценка альтернативной стоимости | Pricing catalog/estimated-api-equivalent views подключены; DEV unknown price и excluded unknown-source показаны честно | Real selected catalog/consumer; actual bill/savings не заявлять; overlapping/unknown sources не суммировать | P21; actual provider usage и versioned pricing там, где доступны | Estimated context × calls подписано estimate, не bill; unknown не ноль; alternative comparison не называется фактической экономией; пересечения исключены либо показаны отдельно | F5 |
| P23 | Compaction, updater, accounts и routing | Сохранение контекста, обновлений и account isolation при расширении | Существующие owners сохранены; localtools offlineHTTP1/26 + real heldMCP SDK: counter1/activeTool-only detach409→release→idle200, NativeHTTP200; duplicate без второго эффекта | Сохранить эти contracts при новых изменениях; source ebafab0/exact4CI успешен, реальные Native ответы/история подтверждены. Финальная installed .9 acceptance остаётся отдельным этапом. | Архитектура текущих compaction/update/account modules; новые routes по scope | Observability без replay authority; checkpoint публикуется после durable write; update signature/commit/rollback сохранены; чужой account/runtime не заимствуется | Сквозной |
| P24 | Пропорциональный CI и delivery | Быстрое развитие с доказанным нужным результатом | Существующие focused checks/CI и architecture map; чужой full audit не переносится | Checks новых изменённых contracts и нужных release targets; архитектурные docs/map вместе с изменением; один integrated verification owner | Связанный законченный batch; development proof перед release | Неизменённые passing checks переиспользованы; failure до fault boundary не считается rollback proof; build/source/merge/install/live результат разделены; broad suite не запускается по умолчанию | Сквозной |

## Полная таблица реализации: длительная работа и история

| ID | Возможность | Польза | Текущая реализация фактически | Осталось реализовать | Зависимости | Приёмка результата | Этап |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DW1 | План и checklist покрытия | Видно, какая часть исходного запроса выполнена и чем подтверждена | Real ledger1/36 + actual UI requirement consent rev1→step/action/user-confirmed1/1→correctionrev2 counts0/1, history retained; propertyverification unavailable | Native machine property verification здесь не заявляется; добавлять конкретные observers по реальной потребности, personal confirmation не machine proof | N03–N06; supported native events; отдельная content policy | Lookalike tool/prompt не становится plan; completed модели не verified; correction инвалидирует старое coverage; source/build/release свойства различимы | F1 |
| DW2 | Дерево workers, status и reuse | Возврат к контекстному исполнителю без создания лишнего | NativeThreadsSurface, metadata projection и supported app-server read/fork wired; CLI 0.163 DEV empty-profile list/scope наблюдены | Fresh worker reuse/continue лишь при поддержанной capability; отдельная connection не доказывает общий live status | DW1 identity; exact thread/family; supported app-server/client contract | Две семьи с одинаковым name не смешиваются; tab close не завершает worker; restart не запускает; disconnected status unknown; follow-up revalidates identity | F1 |
| DW3 | Persistent Agent workers/mailboxes | Самостоятельная параллельная работа и reusable sleeping workers | Durable runtime/claims/receipt/Native bridge интегрированы. Реальный личный Pro (Max), 10 моделей, GPT-6.1-Sol/GPT-6-Astra, отдельные threads и реальные Native+MCP Manual/Goal подтверждены. | Длительная multi-worker работа и real Loop; max1 внутри задачи, pool2 между задачами, cumulative typed images2/160КиБ. | P17/P20; workspace/P05 по сценарию; один top-level task owner | Crash до/после accept/ACK не теряет и не дублирует инструкцию; late result сохраняется; unknown send не replay; concurrency соблюдена; at-least-once не назван exactly-once эффектом | F3 |
| DW4 | Staged task-plan executor | Длинная задача движется по содержательным этапам | Этапы/dependencies/correction и один владелец; real Manual и Goal прошли по3 Native offers с2 отдельно одобренными MCP исходами и проверенным файловым результатом. | Более длинный план с несколькими смысловыми этапами и его correction/retirement UI; текущий реальный пример содержит один этап с tool continuations. | DW3/P20; исходные requirements с первой инструкции | Duplicate finish не запускает следующий этап дважды; correction важнее auto-step; restart не переигрывает uncertain dispatch; unchanged passing check не повторяется | F3 |
| DW5 | Opt-in transcript и Markdown export | Переносимый результат и восстановление контекста | Selected-text/canonical RPC→SQLite1/43/native17 и actual empty-page consent/revoke UI. Owned final-summary source связан с provider/main receipts/oneSQLite/HTTP/IPC/UI: defaultOFF, global+task-generation future consent+risk ack, pre-offer lease, actual IDs/time/source/digest, persistent all-source task-generation revoke; backend1/44+P1 1/12, actualHTTP1/24 | Actual owned-history UI, real GPT-6-Astra final с provenance, поиск и отключение согласия проверены; full supported transcript/background subscription остаются отдельно. Explicit canonical refresh не background capture; unknown-secret risk не устранён known-pattern filter | Native/client event adapter; content opt-in отдельно от metadata ledger | Stream/edit/reload не дублируют; authored human/automatic различены; partial history явна; quota не удаляет активную историю молча; отменённый save не saved | F1 |
| DW6 | Локальный поиск истории | Найти exact сохранённое сообщение без полного сканирования | FTS/query/exact revision UI подключены; DEV selected synthetic answer и real Native final найдены; exact partial запись и сохранение после отключения проверены | Сохранять incremental edit/delete/retention ownership; поиск не обещает несохранённый transcript | DW5 storage/retention owner | Indexed/total/partial видны; edit/delete обновляют результаты; exact message переход; raw tool/credentials вне индекса; несохранённая история не обещается | F1 вместе с history |
| DW7 | Fork истории через клиент | Продолжить отдельную линию от выбранной точки | Native user-click fork route/UI и private durable fork journal с uncertain reconciliation подключены | Реальный supported fork результата; DEV empty list не доказывает live fork или attachments parity | DW5 context; supported fork method; P20 для action receipt | Исходная ветка сохранена; duplicate action не создаёт второй fork; exact point/partial seed видны; replay всего prompt не маскируется под fork | F1; standalone branch F3 |
| DW8 | Ручные code snapshots | Сохранить рабочее состояние и вернуть выбранные файлы | Actual DEV snapshot alpha→beta→restore alpha с beta before-image и managed-worktree Open завершены | Новые archive/lifecycle UI изменения проверять отдельно; passing snapshot/restore/Open переиспользовать | Явный workspace owner; P07/P09; history link полезен, но не обязательный блокер | Dirty/untracked сохранены; ignored/binary/submodule scope объявлен; exact root/path/hash; concurrent edit вызывает conflict; failed test не запускает auto rollback | F2, первый checkpoint результат |
| DW8a | Автоматические per-turn checkpoints | Действительно восстановимое состояние до agent writes | Actual Manual DEV task подписал exact grant и pre-turn snapshot 6-byte hello; Pause gen2 и revoke выполнены; immutable receipt store подключён | Расширения snapshot-only scope не обещать; native-client generic pre-write hook и весь machine filesystem не охвачены | DW8; supported exact boundary hook; P17 execution owner | Пропущенный hook даёт unavailable; человеческие concurrent edits сохранены; post-turn diff не назван pre-turn snapshot или полным rollback | F2 после DW8; собственный hook F3 |
| DW9 | Ручной Goal helper | Найти оставшуюся работу по требованиям и наблюдённым исходам | Actual Manual UI: SHA passed/Review → external drift → Verify409; restore+new observation → current Review → verified_complete; immutable facts сохранены | Semantic independent helper/provider отдельно; выбранное file property не сертификат всего deliverable; unchanged SHA drift/recovery не повторять | DW1/DW5; evidence adapter; provider contract; отправка через существующего owner | Missing/failed/unknown не done; incomplete input виден; correction инвалидирует review; recommendation не самосертификат; тот же revision без новых facts не проверяется снова | F3, до автоматического Goal |
| DW10 | Автоматический Goal для конечного результата | Доведение разрешённой задачи без ручного повторения follow-up | Явный Goal Run, процессное exact-scope разрешение продолжения после tool result и один durable auto_step. Реальный Goal:3 предложения/2 подтверждённых инструмента, файл23байта, SHA и QA verified_complete без ручных Step. | Более длинные Goals/semantic review и installed acceptance. Процессное разрешение не восстанавливается после перезапуска; требуется новое явное Run. | DW9; DW3/P20 для Agent mode либо supported client follow-up; существующие approvals | Goal/Loop/Off не оживляют старую generation; user input/approval/active workers первичны; unknown send не replay; завершение по наблюдённому coverage; unknown spend не объявлен нулём | F3 после ручного helper |
| DW11 | Непрерывный Loop | Явно заказанная повторяющаяся работа | Mailbox Loop core16/176 и actual bounded fake-adapter UI:2 turns/2 runs, waiting mailbox, substantive packet, duplicate без третьего run, Pause gen3/consent removed; externalWatchers:false | Configured real provider и отдельно запрошенные recurring inputs; generic continuous watcher не реализован, fake-adapter UI не business proof | DW3/DW10; explicit recurring instruction; P20 | Нет пустого Continue; unchanged state ставит на паузу с причиной; stop не теряет late results; approval/unknown не перескакиваются; расход/параллельность ограничены | F3 после конечного Goal |

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

Порядок платформ остаётся прежним: **весь macOS набор, затем Windows/Linux**.
N01–N08 source и D01 installed-migration сохранены. Текущая исходная версия `.9`
имеет настоящие Native text/model/history и official MCP runtime результаты,
описанные выше; установленная версия пока `.8`. Все оставшиеся строки программы
сохраняются в объёме работы.

| Порядок | ID | Следующий проверяемый результат |
| --- | --- | --- |
| 1 | DW3–DW4, DW9–DW11 | Расширить уже проверенный ограниченный Native/MCP Goal на несколько смысловых этапов, длительные задачи и реальный Loop; сохранить отдельную проверку конечного результата. |
| 2 | DW2, DW7 | Supported client reuse/continue, настоящий fork и explicit exclusive handoff. Owned Native inference не означает adoption чужих threads. |
| 3 | P03–P08 | После проверенных реальных SSH/SFTP/UI/worktrees — Native→remote Agent, сетевые обрывы/conflict и полный remote Git Review. Пройденные локальные и удалённые сценарии повторно не запускаются без изменений. |
| 4 | DW10–DW11 | Длинный Goal и bounded Loop на реальном provider; semantic review и явно запрошенные recurring inputs. |
| 5 | P11–P16 | Real-model browser/desktop/vision, trusted application outcome, ChatGPT send/Firefox, remaining skill resource types и auth/OAuth. |
| 6 | P19–P22 | Реальный named API consumer, выбранные log/pricing sources и честное разделение usage/estimate/bill. |
| 7 | P23–P24 | Связанный финальный macOS acceptance и только после него необходимая packaging/installation. Затем Windows/Linux adapters и parity. |

Сейчас один root владеет интеграцией и запуском development target. Вспомогательные
read-only проверки не запускают свои GUI, серверы или модельные задачи. Каждая
новая проверка использует сохранённый профиль и текущего owner; история и credentials
не копируются между инсталляциями.
