# Bounded image history and offline local tools — 2026-10-18

Эта партия продолжает source `.9` после `c535519`. Установленная `.8` не менялась.
Пользователь 12:11 UTC выбрал первую поставку всего согласованного набора на macOS,
затем Windows/Linux. Порядок и оставшиеся критерии всех 36 ID находятся в
`docs/design/full-adoption-program.md`.

## Изображения длинной задачи

Прежняя проекция учитывала все изображения канонической истории как обязательные,
поэтому третий screenshot блокировал следующий модельный запрос. Теперь новая
проекция исключает из запроса байты самых старых распознанных host tool images.
Их function output, receipt, SHA-256, размеры и явная отметка об omission остаются.
Исходные outcomes и ранее сохранённые canonical records не переписываются.

Лимиты не увеличены: два изображения, 160 KiB PNG/JPEG bytes после base64 decode и 512 KiB
serialized continuation. Новая партия, human images и изображения с неизвестным
происхождением обязательны; при переполнении запрос явно не отправляется.
Диагностический base64 остаётся текстом. Индексы оставшихся изображений пересчитываются.

Независимый review нашёл provenance gap: raw provider output мог имитировать
`function_call_output` host. Исправление запрещает такой output и сообщения с ролью,
отличной от assistant. Уже полученный/ACKed ответ становится `awaiting_input` без
continuation; он не назван `not_sent`. Старый tainted `source.output` отвергается до
нового fetch. Историческое omission разрешено только для распознанного host output
в `source.input`, с подходящими call/turn и совпадающей image identity.
Повторный scoped review подтвердил закрытие находки.

Проверка `tests/agent-mode-tool-images.test.ts`: **2 tests / 156 assertions**,
172 ms, pinned Bun 1.4.0. Связанный production provider/parser flow выполняет
четыре synthetic observe outcomes и terminal report, пять fake fetch requests.
Третий и четвёртый screenshot продолжают ту же turn с явными omission notices.
Проверены immutable originals, call/turn/receipt, оба byte budgets, обязательные
images, legacy host format и подложный provider envelope/non-assistant message.
Реальная модель, сеть и новый native capture в этой проверке не использовались.

## Локальные инструменты без Web transport

`src/server.ts` разделяет local tools admission и Web model admission. Локальному
host достаточно `admission.accepting && !launcherDetached`. Agent model offers
по-прежнему требуют прежних broker/tunnel/Web условий. Pending call, generation,
grant и ToolJournal проверки сохранены.

Новые desktop permission/list/enable/select действия закрываются при drain/detach.
Status, disable, revoke и close сохраняют возможность очистки. Detach отказывает,
пока есть активный Agent turn или tool owner; принятая операция не теряется.

В `tests/agent-tools-offline-admission.test.ts` пройдены два focused сценария:

| Сценарий | Проверенный результат |
| --- | --- |
| Изолированный Full-mode HTTP, MCP off, Web/tunnel false | Inventory/discovery доступны без native resource или model request. Model step отклонён. Drain блокирует новые scope/desktop действия; status/disable/revoke разрешены. **1 case / 26 assertions**. |
| Настоящий held MCP SDK owner при Web false | Одобренный tool записал private counter 1; только active tool count блокировал detach 409. Release дал terminal receipt, idle detach 200; discovery закрыт до attach. Inert Native HTTP работал, duplicate approval сохранил counter 1. **1 focused case, 937 ms**. |

Второй сценарий работает в отдельном background Bun с явным DIRECT, заданным до
импорта. Его pending model call подготовлен synthetic execution port, поэтому
это не Web provider proof. Счётчик и active owner реальные, серверные counters не
инъецировались. SDK PID reaped, private home удалён. Первый cold-run timeout
случился после owned cleanup; fixture теперь явно выходит только после finalizer
и проверки завершения SDK, без изменения приложения.

## Общая проверка и границы

Root project TypeScript прошёл после финального provenance fix. CLI development
bundle: **245 modules**, запуск `--version`: `6.1.32-nekodex.9`. Architecture map
обновлён и проверен; whitespace check прошёл. Renderer в этой партии не менялся,
его passing result переиспользован. Полные repository/package suites вручную не
запускались; GUI, native helper и реальный провайдер повторно не запускались.

Эта партия не доказывает завершение полного macOS набора. Real-provider Automatic
Goal, private Native worker, непустая каноническая история, remote authentication/
authority, resources/OAuth и итоговая доставка имеют отдельные оставшиеся критерии.
