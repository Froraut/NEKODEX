# Browser, desktop tools and late receipts — 2026-10-18

Эта партия продолжает программу из `docs/design/full-adoption-program.md`.
Версия исходников — `6.1.32-nekodex.9`; установленный NEKODEX остаётся `.8`.
Реализация и DEV-проверки ниже не являются выпуском или установкой приложения.
D01 и миграция действующей установки описаны отдельно в
`2026-10-18-d01-implementation.md`.
Реализация опубликована коммитом `6f6b1715a890c614ecc2fa6f9e2f360a173b63f9`
в draft [PR #98](https://github.com/Froraut/NEKODEX/pull/98). Четыре CI jobs этого
точного кода (macOS/Ubuntu/Windows/actionlint) завершились успешно; это не
подтверждение runtime parity всех платформ или нового установленного выпуска.

## Результат в исходниках

| Область | Реализованное поведение | Граница доказательства |
| --- | --- | --- |
| P12, браузер Agent | Выбранная вкладка явно прикрепляется к task/generation. `browser/observe`, `browser/type`, `browser/click` проходят через существующие pending call, approval и ToolJournal. | Connected fixture использует настоящий Chromium и MV3, а ответы модели — из локального fixture backend. Пользовательский аккаунт и ChatGPT не использовались. |
| P13/P14, desktop macOS | Один ленивый Swift helper, отдельные явные permission/list/enable/select действия, точное окно/процесс/AX instance, screenshot-bound ввод и ограниченный JPEG. | macOS 14+. Реальный capture/input требует доступных системных разрешений и отдельной проверки через DEV UI. |
| Неизвестный результат | Ограничение ожидания сохраняет владельца принятой операции. Reconciliation читает её точную квитанцию, сохраняя исходный unknown и добавляя новый факт. | Поздний результат старого поколения сохраняется в истории и не возобновляет задачу. Повторное действие не отправляется. |
| Изображения инструментов | Канонический `function_call_output` содержит metadata и `input_image`; в UI показывается ограниченный preview без base64 JSON. | Не создаётся человеческое сообщение или дополнительное разрешение. Не более двух изображений / 160 KiB суммарно с текущей канонической историей. |
| Владение и поставка helper | CLI из исходников передаёт pin фиксированного helper собственного checkout. Упакованный CLI использует соседний helper своего runtime. | Нет executable path из renderer/model/config/environment и нет fallback упакованного приложения в исходники. Future distribution wiring не означает выполненную упаковку. |

Browser/desktop input receipts подтверждают выполнение или отправку ввода.
Они пока не поддерживаются как доверенное доказательство бизнес-результата задачи.
Соответствующее действие terminal evidence в UI отключено; результат приложения
нужно наблюдать и проверять отдельно.

## Проверки затронутых границ

Переиспользованы неизменившиеся успешные результаты владельцев модулей:

| Проверка | Результат |
| --- | --- |
| Настоящий Chromium/MV3 → task binding → approval → общий host → continuation | 1 case / 49 assertions; пять fixture model turns, один effect, restart/callback recovery; ресурсы закрыты |
| Builtin soft wait, retained owner, late receipt и отсутствие replay | 2 cases / 21 assertions |
| Затронутые MCP schema/idempotency/cancel | 3 cases / 39 assertions |
| Core reconciliation с общим журналом | 1 case / 44 assertions |
| Канонические изображения с production parser | 1 case / 21 assertions |
| Desktop controller с injected transport | 1 case / 45 assertions; без OS child/capture/input |
| Нативный provider, поздняя квитанция | Последняя затронутая проверка / 14 assertions; injected transport |
| Скомпилированный helper, passive status/list/close | 10 assertions; точные permission Boolean values и PID в этом receipt не сохранены |
| Helper relocation, fixed source layout, pin и отказ от fallback | 2 cases / 14 assertions; inert bytes никогда не исполнялись |
| Ограниченный image preview | Render smoke: один PNG, скрытые bytes, неизменный outcome, oversized image omitted |
| Pending calls независимо от большой истории | HTTP: 1 case / 19 assertions; UI: 1 case / 4 assertions. Запись более 128 KiB не скрывает текущий вызов; completed/unknown и старые поколения не восстанавливаются. |

Общие проверки root после объединения источников прошли 11:02–11:03 UTC:
root TypeScript, renderer TypeScript, renderer build (192 modules), CLI development
bundle (245 modules), запуск bundle с `--version` (`6.1.32-nekodex.9`), обновление и
проверка module map, `git diff --check`. Полные repository/package suites не запускались.
Renderer build сохраняет обычное предупреждение Vite о размере отдельных chunks.
После исправления compact pending metadata оба TypeScript checks, renderer build
(192 modules) и CLI bundle (245 modules) повторно прошли 11:34–11:35 UTC.
Повторно собранный CLI вернул точную `.9` версию; неизменившиеся проверки
остальных границ переиспользованы.

Исходный Swift helper для passive check собран и development-signed с SHA-256:
`0ffc787bf12ef87bc454fa94708fa95b26bfe72248ff7e18cfb2a10fd0784e61`.
После исправления process identity текущий helper пересобран с SHA-256:
`77e471ea50471fb7f80f444a6283cbc4c117ca87073a9068d9fa1873a6d6edd3`.
Функциональные результаты ниже относятся ко второму helper.

## Реальный провайдер

В этой партии нет новых запросов к реальной модели. Существующий production `.8`
был отдельно проверен read-only: authenticated session и ready broker/tunnel.
Это не даёт ему authority на private Agent task из DEV `.9`.
Подготовленный real-provider Goal harness остановлен до отправки запроса:
нужен корректный собственный DEV `.9` producer и профиль входа.
Чужой Native/Hermes context, cookies и credentials не заимствовались.

## DEV UI и результат приложения

Root открыл отдельный DEV профиль с собственным core и синтетическим adapter.
Явная проверка через product UI 11:11 UTC показала все три разрешения доступными:
screen capture, AX и post-event. Новые OS permissions не запрашивались и не выдавались.
Выбор task/generation и явное получение window metadata работают через UI.

Этот проход выявил реальный дефект native отбора: окна приложений, запущенных
напрямую из executable, отсутствовали в списке. Диагностика двух собственных
процессов подтвердила `NSRunningApplication.launchDate == nil` при наличии обоих
окон в `CGWindowList` on-screen/layer-0 и доступной kernel process-start metadata.
Перед изменением helper root выключил и освободил его через UI; отсутствие
native child подтверждено по процессам. Старые core и GUI завершены, offers: 0.
Process-instance identity заменён на kernel process-start seconds/microseconds;
screen-only, window/AX и focus guards сохранены. Повторный product UI проход
показал оба допустимых окна и прикрепил только точное окно инертного fixture.

Далее root проверил фактическую связанную последовательность:

1. MCP оставался выключен. Desktop schemas объявлены только для выбранных task,
   generation и window/process instance.
2. Отдельное подтверждение `desktop/observe` вернуло JPEG **70,027 bytes**,
   **1120×624**. Его preview визуально проверен в продукте.
3. Отдельно одобренный `desktop/type` получил квитанцию
   `ax-literal-text-dispatched`. Cua независимо показал точный текст
   `NEKODEX desktop DEV 20261018` в поле и label самого fixture.
4. Свежий JPEG после ввода — **78,916 bytes**. Оба изображения укладываются в
   суммарный лимит 160 KiB. Четвёртый synthetic offer сохранил click call, но
   историческая выдача 128 KiB скрыла всю большую запись dispatch. Ввод не отправлялся.
5. Дефект исправлен отдельной compact `pendingToolCalls` projection с coverage.
   Исходные изображения, канонические записи, approval и history caps сохранены.
   Большой случай проверен focused HTTP/UI fixtures; он не представлен как
   повторно исполненный большой UI-сценарий.
6. Исходная задача сохранена на pause, generation 2, **4/6 offers**, с четырьмя
   settled dispatch. После перезапуска использована отдельная click-only задача
   с новым точным attachment и новым observation. Повторного typing не было.
7. По свежему снимку root определил координаты **(280,290)**, проверил точный
   pending call в UI и отдельно подтвердил его. Квитанция —
   `completed / ax-press-dispatched`. Cua показал **Counter: 1**, прежний литерал
   не изменился. Собственный state receipt содержит sequence 3:
   запуск → одно изменение текста → одно нажатие счётчика.
8. Canonical click result доставлен в третий synthetic offer. Новая задача
   завершила этап и перешла в `review_required`, **3/3 offers**, pending metadata
   пусты. Она не объявлена `verified_complete`.

Таким образом проверены реальные capture/JPEG, background AX literal typing,
screenshot-coordinate → AX hit-test/AXPress и наблюдаемый эффект fixture.
Generic foreground CG pixel-event fallback отдельно не упражнялся.
Семь model offers в двух задачах использовали синтетический adapter;
реальных запросов к модели было ноль.

При подготовке disposable harness исправлены слишком длинный Unix socket path
(115 → 92 bytes) и отсутствовавший cwd синтетического tunnel-процесса.
Оба первых владельца завершены до повторного запуска, accepted tool effects: 0.
Это ошибки стенда, отдельно от найденного дефекта отбора native окон.
DEV GUI намеренно не публикует tunnel readiness. Однократный private synthetic
supervisor проверил собственные PID/instance/nonce/health и сообщил readiness
только своему core через существующий authenticated gate. Это не настоящий
tunnel, аккаунт или provider proof; серверный gate не ослаблялся.

После проверки desktop-доступ выключен, attachment освобождён, synthetic
readiness отозван revision 2. GUI/core/static-renderer завершены с exit 0;
fixture завершён по точному owned PID после сохранения результата (SIGTERM,
exit 143: его bound Quit shortcut не закрыл приложение). PIDs 28899, 28913,
29034, 18648, 15884 отсутствуют; порты 18946, 54677 и task-owned DevTools закрыты.
Санитизированный JSON-отчёт, оба JPEG и итоговый state receipt сохранены в
локальном workspace `reviews/evidence/full-adoption/`.
Оба SQLite-журнала с исходными synthetic task/tool records сохранены отдельно
в `retained-agent-records/` вместе с исходником инертного fixture; account
configuration и auth files туда не копировались. Три временных каталога
(DEV home/harness, renderer/CLI build, fixture bundle) удалены после проверки
завершения владельцев. Отдельный подготовленный real-provider harness сохранён.
