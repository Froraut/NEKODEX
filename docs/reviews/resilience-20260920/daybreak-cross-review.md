# Daybreak Blue counter-review

Completed through official app-server with gpt-5.6-sol and cyberAccessProgram=daybreakBlue.

# Daybreak Blue — контр-ревью

## 1. Подтверждено — updater фиксирует обновление до доказательства работоспособности настроенного runtime

**Исправленная серьёзность: P1 / High — release blocker.**

`proveUpdateReadiness()` проверяет только запуск candidate runtime с `--version` и сразу создаёт `ready.json` ([update-readiness.cjs](/Users/alex/Dev/nekodex/launcher/electron/update-readiness.cjs:36)). Вызов происходит после загрузки renderer, но до асинхронных `upgradeManagedRuntime()`, `startIfConfigured()` и `connectBridgeRoute()` ([main.cjs](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1587), [main.cjs](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1681)). Затем `waitForReadiness()` принимает этот version-only маркер, а `runTransaction()` вызывает `commit()` и удаляет предыдущий пакет ([update-worker.cjs](/Users/alex/Dev/nekodex/launcher/electron/update-worker.cjs:284), [update-worker.cjs](/Users/alex/Dev/nekodex/launcher/electron/update-worker.cjs:323)).

Следовательно, кандидат может правильно сообщить версию и открыть окно, но затем не выполнить runtime migration, не поднять локальный сервис либо не восстановить bridge route — уже после необратимого commit.

Одновременно подтверждается связанная неполнота rollback: `ensurePackagedRuntime()` изменяет durable `coreHome/versions`, а `upgradeManagedRuntime()` может менять launcher-owned runtime/config/route state, тогда как `rollback()` восстанавливает только `transaction.operations`, то есть пакет приложения ([runtime-install.cjs](/Users/alex/Dev/nekodex/launcher/electron/runtime-install.cjs:218), [runtime.cjs](/Users/alex/Dev/nekodex/launcher/electron/runtime.cjs:1466), [update-worker.cjs](/Users/alex/Dev/nekodex/launcher/electron/update-worker.cjs:194)).

**Минимальный согласованный fix:** не вводить сразу большой generation framework. Сначала:

1. Перенести `proveUpdateReadiness()` за успешное завершение `upgradeManagedRuntime()`, `startIfConfigured()` и `connectBridgeRoute()`.
2. До запуска кандидата сохранить только launcher-owned runtime/config/route файлы, которые реально меняет `upgradeManagedRuntime()`, вместе с hash/generation.
3. При неготовности восстановить пакет и эти конкретные файлы с compare-and-swap проверкой; не включать браузерные профили, разговоры, логи и session data.
4. Только затем удалять `.previous-*`.

Live model request, внешний ChatGPT login, token injection и копирование `auth.json` в readiness gate не нужны.

## 2. Подтверждено, но ниже — невозможность остановить кандидата оставляет rollback незавершённым

**Исправленная серьёзность: P2 / Important, не P1.**

В error path `runTransaction()` сначала ожидает `stopReplacement()`, и только затем вызывает `rollback()` и перезапускает старое приложение ([update-worker.cjs](/Users/alex/Dev/nekodex/launcher/electron/update-worker.cjs:323)). `stopReplacement()` намеренно бросает исключение, если после разрешённого запуска не удаётся подтвердить Windows child identity или POSIX process-group ownership ([update-worker.cjs](/Users/alex/Dev/nekodex/launcher/electron/update-worker.cjs:239)). Это действительно прерывает автоматическое восстановление, хотя previous package остаётся сохранённым.

Это primarily availability/recovery defect, а не нарушение trust boundary: fail-closed поведение правильно избегает убийства неподтверждённого процесса.

**Минимальный fix:** перед остановкой записывать durable phase `rollback-pending-stop`; при неоднозначной identity сохранять journal и recovery registration, не выполнять cleanup и не считать транзакцию законченной. При следующем recovery повторять identity check и rollback. Кооперативный shutdown handshake можно добавить позже, но он не должен быть обязательным условием первого исправления.

Связанные утверждения `code-14` о подмене `.next-*` и crafted sibling journal **не подтверждают отдельный P1/P2 trust boundary для обычной user-owned установки**: процесс, способный писать в parent установленного приложения, обычно уже способен напрямую заменить приложение; это same-user/local-file tampering. Невалидированный journal в `prepareTransaction()` всё же заслуживает defensive hardening — closed-schema/path validation до `rollback()`/`cleanup()` — но корректная серьёзность здесь **P3 / Low, defense in depth**, если не существует отдельного privileged helper или shared writable layout.

## 3. Кодовая гонка login cancellation подтверждена, но это unshipped draft, поэтому не текущий P1

**Исправленная серьёзность: P2 / Important draft-integration blocker; текущий shipped impact — none established.**

`createCodexLoginController()` запускает `app-server` с реальным общим `codexHome` ([codex-login.cjs](/Users/alex/Dev/nekodex/launcher/electron/codex-login.cjs:147), [codex-login.cjs](/Users/alex/Dev/nekodex/launcher/electron/codex-login.cjs:363)). В `handleMessage()` успешный `account/login/completed` переводит flow в `completed` без проверки `current.phase === "waiting"` и без повторного сравнения `selectedAccountId()` с `current.accountId` ([codex-login.cjs](/Users/alex/Dev/nekodex/launcher/electron/codex-login.cjs:265)). Поэтому success, пришедший во время `cancel()`, может победить фазу `cancelling`; смена выбранного аккаунта после показа device code также не проверяется при completion ([codex-login.cjs](/Users/alex/Dev/nekodex/launcher/electron/codex-login.cjs:441)).

Однако `codex-login.cjs` и `account-quotas.cjs` сейчас отображаются как **untracked**, а прочитанный review прямо говорит, что они ещё не подключены к callers. Поэтому это не доказанная уязвимость опубликованного приложения и не текущий P1.

**Минимальный fix перед интеграцией:** сохранять monotonic flow generation и принимать success только если одновременно:

- `flow === current`;
- `current.phase === "waiting"`;
- `selectedAccountId() === current.accountId`;
- cancellation ещё не зафиксирована.

При cancel/selection change сначала сделать flow terminal и прекратить owned child, чтобы поздний notification игнорировался. Private per-flow `CODEX_HOME` с последующим переносом credentials не является безопасным «минимальным» решением без официального атомарного credential-store API: это фактически приводит к копированию auth artifacts, чего здесь делать не следует. Если официальный сервис записывает shared credentials до notification, UI-контроллер не может гарантировать откат уже завершённой авторизации; интерфейс должен честно сообщать такую race-компоновку и требовать явного повторного подтверждения фактической CLI identity.

Ревью выполнено только чтением указанных материалов и их точных source references; тесты, сборки, сеть, аккаунты, credentials и сервисы не использовались.


