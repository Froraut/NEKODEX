# Coding wave 2 — exception-path correction

Baseline: 032c327eb922dbb68c1d85894b9ffff61147c36e. Sixteen fresh Sol medium workers; eleven made corrections, five made no change. Workers reported twenty localized corrections/defensive improvements, not twenty new unique bugs. Parent reconciled the recheck UI cooldown with the updater contract. Backend and renderer typecheck passed. One CI worker was asked to finish its bounded review; it reported no change and explicitly left output-format verification incomplete. All closed.

## 1. Beauvoir the 2nd

В E01 и E11 внесены **две корректирующие правки**. Изменён только [launcher-helper-client.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts); [browser-helper-main.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-helper-main.ts) оставлен без изменений.

- **E01:** при сбое канала прежний код освобождал резерв trace ID, когда helper отсоединялся от клиента, хотя процесс ещё мог работать. Теперь ID остаётся занятым до фактического выхода именно этого процесса. Это защищает повтор с тем же ID после недоставленного Abort или ошибки канала.
- **E11:** если отмена происходила до запуска отложенного callback Send activation, callback всё равно выполнялся. Теперь клиент проверяет состояние запуска до вызова callback; проверка перед отправкой ack сохранена.

Просмотрел diff, прямой вызов из `browser-worker.ts`, путь отмены, завершения и повторного запуска вручную. Тесты, сборку, приложение и сетевой трафик не запускал согласно ограничению этой волны. **Оставшийся вопрос:** старый клиент, отправляющий Send ack без идентификатора запроса, нельзя надёжно отличить от позднего ack прежнего запуска; согласованная новая пара клиент–helper использует идентификатор. Правки update-recheck IPC/UI, опубликованные ресурсы и версию `.2` не затрагивал. Коммитов и push не делал.



## 2. Curie the 2nd

Made **2 concrete corrective changes** after reviewing the wave-1 diff and direct call paths:

- **E17 — live conversation ownership:** [account-pool.cjs](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:394) now checks Manual turns before capacity eviction, and [browser-host.cjs](/Users/alex/Dev/nekodex/launcher/electron/browser-host.cjs:2044) enforces the same check before a direct host call can reuse or create a tab. Trigger: a second Manual trace uses a conversation key already held by a running turn.
- **E09 — transactional add rollback:** [account-pool.cjs](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:134) retains the saved account if readiness fails after that account has acquired a tab or has a pending acquisition. Trigger: a Manual turn starts while `addAccount()` is awaiting readiness; removing its registry entry would orphan the turn.

**E02 and E19:** I found no substantiated residual error in the reviewed paths, so made no change for those IDs. [account-registry.cjs](/Users/alex/Dev/nekodex/launcher/electron/account-registry.cjs) is unchanged. There is no scope-crossing dependency; the parent’s `main.cjs` and UI work was left untouched.

I reviewed the resulting diff manually. No tests, builds, app runs, traffic, commits, or publication were performed; runtime behavior and persistence I/O failures remain for the parent’s shared focused verification. I applied [right-size-test-runs](/Users/alex/.codex/skills/right-size-test-runs/SKILL.md) to keep verification within this manual-review scope.



## 3. Euler the 2nd

Исправил **один подтверждённый остаточный дефект E03** в [src/setup.ts](/Users/alex/Dev/nekodex/src/setup.ts). Если сохранение config завершается до замены файла, а откат tunnel останавливается из-за неопределённого состояния профиля или сервиса, код теперь отдельно пытается вернуть собственные записи tunnel-client и runtime key. Перед возвратом ключа он сверяет его с байтами, записанными setup; при чужой правке файл сохраняется. Компенсация не выполняется, пока может работать validation tunnel или затронутый tunnel service. Также отсутствие записи config больше не считается безопасным откатом, если config успел изменить другой процесс.

**E04 и E12:** новых подтверждённых дефектов в назначенных файлах не нашёл; изменений по ним — ноль. [src/tunnel.ts](/Users/alex/Dev/nekodex/src/tunnel.ts) не менял. Просмотрел diff и прямые вызовы вручную. Тесты, сборки, скрипты, запуск приложения, трафик, commit и push не выполнял; поведенческая проверка остаётся в общем бюджете родителя.

Остаются известные ограничения: гонка между сверкой runtime key и атомарной заменой, а также сохранение внешнего профиля, если неудачный `connect` мог записать его без подтверждения.



## 4. Carver the 2nd

**E13: 0 новых изменений.** Файл [thread-environment.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/thread-environment.ts:230) оставлен без правок.

Ручной просмотр diff `f58398b..032c327` и прямого вызова `environmentStore.resolve()` подтвердил: при обновлении authority и удалении по TTL новая карта попадает в память только после успешной записи. При сбое записи прежняя карта остаётся доступной, ошибка выходит вызывающему коду, а просроченная запись не возвращается как действующая authority. Сохранение происходит до создания browser session; отмена и retirement не меняют эту карту, а повтор может заново выполнить запись. Подтверждённой остаточной ошибки или регрессии в E13 я не нашёл.

**Изменённые файлы:** нет. **Конкретные корректировки:** 0. Тесты, сборку и приложение не запускал; commit/push не делал. Остающийся вопрос за пределами этой правки — согласованность при одновременной записи файла разными процессами; зависимости, требующей изменения чужих файлов, не обнаружено.



## 5. Kant the 2nd

Исправил **2 подтверждённых окна гонки** в E05 и E18. Изменены ровно [runtime-supervisor.cjs](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs) и [main.cjs](/Users/alex/Dev/nekodex/launcher/electron/main.cjs).

- **E05 — 1 коррекция.** Если отмена приходит во время предварительной проверки здоровья или восстановления старого runtime, начальный запуск теперь проверяет сигнал перед дальнейшим восстановлением, записью состояния и захватом процессов. Путь остановки сохранён: его прямой вызов восстановления работает без сигнала начального запуска.
- **E18 — 1 коррекция.** Если Quit начинается, пока отдельная startup-цепочка ждёт авторизацию или завершение запуска runtime, она прекращает дальнейшую работу. Перед подключением маршрута добавлена проверка Quit; отдельный запуск DEV-профиля также не публикует ошибку после начала остановки.

Вручную просмотрел diff, прямые вызовы и границы отмены, остановки и повторного запуска. По условию волны не запускал тесты, сборку, приложение или скрипты и не делал commit/push. Живое поведение при сбое остаётся непроверенным; целевой сценарий для проверки родителем — Quit во время предварительной проверки начального запуска с последующей ошибкой. Родительская проводка IPC `update-recheck` в `main.cjs` сохранена. Зависимостей с изменением других файлов не выявил.



## 6. Pasteur the 2nd

В E06 внесены **две конкретные коррекции** в [turn-execution.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:711). Других файлов не менял.

- **E06, clear/prune/interrupt и прямой retirement:** если у retained-сессии нет callback освобождения Launcher, успешный settlement отдельного turn больше не считается подтверждением освобождения разговора. Запись и обязательство остаются привязанными.
- **E06, смена модели:** тот же отсутствующий callback теперь останавливает отсоединение прежнего разговора. Раньше этот путь мог удалить его привязку без подтверждённого release.

Вручную проверил diff, создание runtime и прямые вызовы из `index.ts` и `server.ts`; тесты, сборку и запуск не выполнял согласно ограничению этой волны. В обычном runtime callback создаётся вместе с retained conversation. **Оставшийся предел:** если callback действительно отсутствует, освобождение не сможет завершиться до исправления источника runtime; это состояние теперь сохраняется явно. Родительский IPC/UI recheck и опубликованные assets/version `.2` не затронуты.



## 7. Nietzsche the 2nd

**E07 и E14: 0 корректирующих изменений.** Изменённых файлов нет. Ручной разбор [parser.ts](/Users/alex/Dev/nekodex/src/responses/parser.ts) и [schema.ts](/Users/alex/Dev/nekodex/src/responses/schema.ts) не выявил подтверждённой остаточной ошибки или регрессии в назначенном scope.

При результате инструмента `input_image` только с `file_id` схема отклоняет запрос до передачи содержимого адаптеру; парсер сохраняет такое же явное отклонение, если получит непроверенный блок. При `tool_search_call` и `tool_search_output` отсутствующие или пустые ID отклоняются до создания истории. Просмотрел прямой путь через `server.ts`: ошибка разбора возвращает HTTP 400 до запуска адаптера, поэтому этот отказ не создаёт браузерный ход, состояние продолжения или retry.

Остаётся ограничение проверки: поведение с реальным нативным клиентом не проверялось. Результат поиска с *непустым, но чужим* `call_id` может создать несвязанную запись в истории; не менял правило связывания без доказательства, что такой запрос допустим или встречается у клиента. Тесты, сборки, запуск приложения, трафик и публикацию не выполнял.



## 8. Hubble the 2nd

**E08: дополнительных исправлений не потребовалось.** Просмотрел путь повторного входа от `setup.ts` и CLI, проверку маркера в browser worker, отказ записи состояния и маркера, а также очистку профиля. Изменение первой волны удаляет прежний маркер до замены состояния; при отказе новой записи состояние не считается проверенным.

Сделал **одно корректирующее изменение** в [src/browser-login.ts](/Users/alex/Dev/nekodex/src/browser-login.ts:432), рядом с E08. Триггер: `launchPersistentContext()` может отклонить вызов после попытки открыть Chrome, но до возврата handle. Раньше этот путь удалял временный профиль без подтверждения закрытия процесса. Теперь при неподтверждённом закрытии профиль сохраняется, а ошибка сообщает его путь. Это также покрывает случаи, когда возвращённый контекст или выделенный Chrome остаётся открытым после попытки закрытия.

Проверка ограничилась ручным просмотром прямых путей и diff; `git diff --check` прошёл. Сбой Chrome и записи на диск в runtime не воспроизводился. Изменён только `src/browser-login.ts`; IPC/UI повторной проверки обновлений, версия и опубликованные ресурсы не затронуты. Сборок, тестов, запусков приложения, коммитов и push не было.



## 9. Avicenna the 2nd

E15 received **two concrete corrective changes** in [browser-worker.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2349):

- **Closed maintenance page:** `ensurePage()` now closes the old browser or CDP connection before replacing its handle. If closing fails, the handle remains reachable for a later `close()` attempt.
- **Managed Chrome after a turn:** when the worker has a live context but no maintenance page, `ensurePage()` creates a page in that context instead of launching another browser and overwriting the existing handle.

I reviewed the first-wave diff, E15’s wave-1 report, the worker’s acquisition and cleanup paths, and its direct maintenance callers. This was manual review only; I ran no tests, builds, app, traffic, or bulk scripts. **Remaining issue:** actual Playwright failure and overlapping acquisition behavior remain unverified; the parent’s reserved focused check should cover them. No files outside `browser-worker.ts` changed, and I made no commit or publication.



## 10. Averroes the 2nd

**E21: одна корректирующая правка** в [compaction-handoff.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/compaction-handoff.ts:478) и [index.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:1106).

Триггер: native turn отменяется после разрешения `sharedSummary`, но до продолжения `await` в адаптере. Проверки cache, добавленные в первой волне, к этому моменту уже прошли. Теперь адаптер повторно проверяет запись interruption и abort сохранённого run непосредственно перед выдачей summary. Если turn отменён, он переходит в существующий путь ошибки вместо публикации ответа.

Вручную просмотрел diff первой волны, прямые вызовы, регистрацию отмены, срок хранения cache, ожидание физического завершения owner, retirement и путь ошибки сохранения. Сборки, тесты, скрипты и трафик не запускал. Проверка в общем бюджете остаётся за родителем. Зависимость за пределами моего scope: сохранение compaction continuation в `src/server.ts` происходит после формирования завершённого ответа; поведение при сбое этой записи нужно оценивать отдельно от E21. Коммитов и изменений опубликованных assets не было.

## 11. Kuhn the 2nd

**E10: 0 корректирующих изменений.** Файлы [install-launcher.sh](/Users/alex/Dev/nekodex/scripts/install-launcher.sh) и [install-launcher.ps1](/Users/alex/Dev/nekodex/scripts/install-launcher.ps1) оставил без изменений.

Вручную сверил дифф `f58398b..032c327`, замечания для worker11 и прямые ссылки на установщики. Оба сценария по умолчанию выбирают первый релиз из ограниченного списка с точным ассетом для платформы; явно заданная версия проходит прежним путём. После выбора оба установщика скачивают ассет и `checksums.txt`, проверяют SHA-256 до установки и удаляют временные файлы при завершении. Подтверждённой остаточной ошибки или регрессии в E10 не нашёл.

**Оставшаяся граница:** автоматический поиск охватывает только десять опубликованных релизов. Установка, сетевые запросы, тесты, сборки и публикация в этой итерации не выполнялись по заданному ограничению; фактический выбор релиза остаётся для общей проверки родителем.



## 12. Descartes the 2nd

Итерацию E16 завершил на текущих данных. **Корректирующих изменений: 0. Изменённых мной файлов: нет.** В пределах назначенного scope остались без правок [focused-pr-check.ts](/Users/alex/Dev/nekodex/scripts/focused-pr-check.ts) и [ci.yml](/Users/alex/Dev/nekodex/.github/workflows/ci.yml).

Ручной просмотр diff `f58398b..032c327` подтвердил, что изменение первой волны добавляет для push-переименования исходный и новый пути в классификацию. CI вызывает этот скрипт и предоставляет историю коммитов. Подтверждённой остаточной ошибки или внесённой регрессии в просмотренном пути я не нашёл. Проверку формата вывода `git diff -z` и совпадения имён случаев с тестами не завершил; это **не установленный дефект**.

Передаю родителю E16 для общей сфокусированной проверки: push-переименование `src/responses/parser.ts` в `docs/parser.md` должно выбрать именованный parser case и указать оба пути в сводке. Тесты, сборки, приложение, трафик, commit и push не запускал.



## 13. Godel the 2nd

В E20 внесены **две корректирующие правки** в [launcher/scripts/package.cjs](/Users/alex/Dev/nekodex/launcher/scripts/package.cjs:74):

1. Если `artifacts` — символьная ссылка, скрипт теперь останавливается до копирования прежнего набора. Иначе подготовленная копия ссылки могла направить удаление старых дистрибутивов в исходную директорию.
2. Если упаковка прервалась между переименованием прежнего `artifacts` и установкой нового, следующий запуск восстанавливает прежний набор из `.artifacts-swap-*/previous` до вызова builder. При нескольких возможных наборах скрипт останавливается, не выбирая один произвольно.

Вручную просмотрел diff `f58398b..032c327`, слот 13 первой волны, прямые вызовы из `launcher/package.json` и release workflow, а также порядок проверки staging, копирования, возврата при ошибке и удаления прежнего набора. Ошибка копирования по-прежнему оставляет исходный `artifacts` целым. Сборок, тестов, запусков приложения, commit и push не было.

**Остаётся:** между двумя переименованиями `artifacts` кратко отсутствует; одновременные упаковки этим изменением не координируются. Реальное поведение при прерывании и сбое файловой системы не запускалось; сфокусированная проверка оставлена родителю в общем бюджете. Версия `.2` и опубликованные assets не менялись.



## 14. Heisenberg the 2nd

После ручного разбора **исправлений не вносил**: `src/responses/state.ts` уже хранит продолжения как дельты с глубиной не более семи ссылок и затем создаёт самодостаточное контрольное состояние. Подтверждённого остаточного дефекта в закреплённой области не нашёл.

Изменённые файлы: **0**. Конкретные корректирующие изменения: **0**; триггер для правки не подтвердился. **E ID: нет** — оптимизация истории из первой волны не закрывала E01–E21.

Проверил вручную прямые вызовы сохранения и воспроизведения, отмену и повтор запроса, загрузку старого снимка, TTL и вытеснение, а также обработку сбоя записи. Ограничение для родителя: при нормализации native delegation создаётся новое тело запроса без метки происхождения истории, поэтому этот ход сохраняется как полное контрольное состояние. История остаётся воспроизводимой, но экономия на таком ходе теряется. Проверку поведения и измерение ускорения оставляю в общем бюджете родителя; тесты, сборку и запуск не выполнял.



## 15. Cicero the 2nd

В [launcher/src/App.tsx](/Users/alex/Dev/nekodex/launcher/src/App.tsx) внесены **три конкретные коррекции**; других файлов не менял.

1. **Snapshot после `mcp-setup`.** Runtime публикует `completed` до окончательного запуска и записи состояния в main. Я запретил явному `updateSnapshot()` переиспользовать такой ранний запрос; объединение с completion-запросом сохранено для `mcp-verification`, где состояние записывается до события.
2. **Смена операции и сбой setup.** Ответ snapshot теперь теряет право обновить metadata, если за время запроса пришло новое operation-событие. После неудачного `mcp-setup`, включая сбой во время старта, запрашивается состояние после восстановления. Явный refresh повторяет чтение один раз, если общий completion-запрос завершился ошибкой.
3. **Повторная проверка обновлений.** UI начинает 60-секундный cooldown после ответа `recheckUpdate()`, как контроллер. Пока запрос выполняется, действие отключено; таймер и асинхронное обновление защищены при размонтировании. Проводку IPC и `update.cjs` сохранил.

**E ID:** ни один из E01–E21 этой работой не закрыт; первые две коррекции относятся к O02, третья — к родительской интеграции updater. Выполнил только ручной просмотр diff и прямых путей вызова. Сборку, тесты, приложение, трафик, commit и push не запускал. Остаётся проверить поведение в общем родительском бюджете; выигрыш от объединения snapshot не измерялся, а запрос по-прежнему получает полный snapshot.



## 16. Carson the 2nd

В назначенной области внесены **2 конкретных исправления**, оба в [update.cjs](/Users/alex/Dev/nekodex/launcher/electron/update.cjs:478). [preload.cjs](/Users/alex/Dev/nekodex/launcher/electron/preload.cjs:70) и [types.ts](/Users/alex/Dev/nekodex/launcher/src/types.ts:268) менять не потребовалось.

1. Если создание временного каталога для установки завершается ошибкой, попытка теперь возвращает состояние `available`, сохраняя выбранный релиз и возможность повторить установку. Раньше она могла оставить состояние `downloading`.
2. Если удаление временного каталога завершается ошибкой после неудачной подготовки или отмены установки, ошибка удаления записывается в журнал, состояние восстанавливается, а вызывающий код получает исходную ошибку подготовки или отмены. Временный каталог при таком сбое может остаться на диске.

Требуемая связь с родительскими файлами уже присутствует: `main.cjs` обрабатывает **`launcher:update-recheck`** вызовом `updateController.recheck()`; App вызывает **`api.recheckUpdate()`** и показывает действие повторной проверки. Сохранились однократная стартовая проверка, 60‑секундное окно после завершения проверки и защита состояний `available`, `downloading` и `installing`. **E01–E21 этими исправлениями не закрыты.**

Провёл ручной просмотр diff и прямых вызовов. Тесты, сборки и запуск приложения не выполнял по условиям слота. Оставшаяся зависимость для родителя: таймер ожидания в App начинается при нажатии, а окно контроллера — после завершения проверки; при долгой проверке кнопка может стать доступной раньше контроллера, который вернёт прежнее состояние.
