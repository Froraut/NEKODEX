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
набора из36 ID, а не сокращение цели до готового macOS поднабора. Этап1 доводит
все области на macOS, включая native/real-provider/Automatic Goal, remote/auth
и skill resources; этап2 сохраняет Windows/Linux adapters, packaging и parity.
Функциональные F0–F5 ниже — связанные batches внутри этих платформенных этапов.
Пока capability unsupported, она остаётся честным открытым пунктом, а не пропадает
из macOS объёма. Выбор платформы не является evidence установленной `.9`, release
или разрешением на broad suites; focused development verification сохраняется.

| Область / все ID | Этап1: уже подтверждено на macOS | Этап1: что ещё требуется до приёмки всей области | Этап2: Windows/Linux |
| --- | --- | --- | --- |
| Credentials P01–P02 | D01 scoped Keychain/CLI/headless и installed `.8` receipt | Сохранять exact scope/restart/rotation для новых routes; не выдавать новую source версию за installed migration | Protected backend/private ACL и поддержанные noninteractive migration routes |
| Workspace P03–P10, DW8–DW8a | Local editor/Git/base selector/worktree/Open/snapshot/restore/PTY и exact pre-turn scope | Реальная SSH authentication/host/root, remote commands/worktree lifecycle, явная Agent remote authority и заявленные auth flows; current local scopes не расширяются автоматически | Platform paths/SSH/PTY/packaging/ownership и то же сохранение пользовательской работы |
| Browser/desktop P11–P14 | Chrome MV3 fixture; native capture/type/AXPress на owned fixture; bounded image projection source | Real provider/model integration, task-bound browser flow, доверенный application-outcome observer; ChatGPT companion send/Firefox и заявленные native routes остаются открыты; generic CG fallback пока не verified | Native helpers/providers/permissions и browser compatibility по каждой ОС |
| MCP/skills/execution P15–P18 | Official frozen install/retained disabled review, MCP SDK host/Seatbelt, managed text versions, selected UTF-8 resource packages и actual UI | Real enabled requested tools, supported auth/OAuth, executable/binary skill resources и заявленный native executor contract; official/excluded distribution rules сохраняются. QuickJS остаётся условным до конкретного composition gap, а не фиктивной обязательной зависимостью | Installer/runtime/private ACL/OS sandbox/skills resource adapters и lifecycle |
| Long work/history DW1–DW7, DW9–DW11 | Explicit requirements/claims/user-confirmed, selected-text export/search, canonical empty consent/revoke, owned final-summary consent/lease/SQLite source+fixtures, durable Agent/MCP/bounded Loop fixtures/UI | Native integration source выполнена, но official admission/models[] пусты: auth/own-profile inventory/account-server source уже связан → реальный qualified account/model → Automatic Goal/outcome; canonical nonempty native text, supported client reuse/fork/exclusive handoff и semantic review остаются; localfake не production proof | Поддержанные client/protocol/process/event/persistence adapters и те же outcome boundaries |
| Local API/usage P19–P22 | Scoped API/action owner, metadata-only usage и honest unknown/overlap/estimate UI | Реальный named consumer, реальные разрешённые log/pricing sources; request/receipt reconciliation, actual bill/estimate разграничение | Platform source/parser/privacy и API integration contracts |
| Platform reliability P23–P24 | Действующие owners/целевые проверки, local offline tools+held SDK detach evidence | Закончить текущие TS/CLI gates и substantive findings; сохранить single owner/drain/cleanup и отдельные source/development/install/release receipts | Нужные target build/sign/package integrity и focused flow checks, не автоматический полный audit |

## Зафиксированное состояние

- **N01–N08** реализованы в исходниках [PR #96](https://github.com/Froraut/NEKODEX/pull/96).
  По текущему checkpoint PR не merged; исходный код, merge, выпуск и установленная
  версия — разные результаты. Эти функции не возвращаются в backlog как отсутствующие.
- **D01 / P01–P02 для macOS** имеют source, development и installed-migration
  evidence в [квитанции D01](../reviews/2026-10-18-d01-implementation.md):
  версия `6.1.32-nekodex.8`, два account/mode ключа в Keychain, архив неактивного
  ключа, exact selector/process proof и отдельный Native response. Квитанция
  не утверждает новый успешный ChatGPT connector/tool turn; проверка браузерной
  сессии тогда была unavailable из-за Cloudflare. Windows/Linux protected backend
  и публичный release этим не доказаны. Более ранний незавершённый checkpoint
  не отменяет эту последующую квитанцию доставки.
- **Опубликованный source baseline:** [PR #98](https://github.com/Froraut/NEKODEX/pull/98),
  commit `137399d`, source `6.1.32-nekodex.9`; все четыре CI jobs этого baseline
  завершились успешно. Установленная версия остаётся `6.1.32-nekodex.8`.
  Следующие DW1/P07/DW5/P16 изменения — новая исходная партия после baseline;
  его CI не является проверкой новых bytes и не означает installed update.
- **Последний опубликованный baseline:** `e75d073`, четыре CI jobs точного source
  [завершились успешно](https://github.com/Froraut/NEKODEX/actions/runs/39153769800).
  Source версия остаётся `6.1.32-nekodex.9`, установленная D01 — `.8`.
  Owned final-summary history входит в этот baseline. Новая typed-image партия
  идёт после него; прежний CI не проверяет её bytes и не доказывает real model.
- **Owned Native integration теперь реализована в source:** Rust DEV wrapper на
  public Codex app-server entrypoint собран и прошёл local fake-wire proof. Это
  отдельный passive/build artifact, не доступный официальный account provider.
  Bun имеет explicit `owned-native` provider/router и durable preclaim; main bridge
  проверяет claim/exact scope/fixed schema, публикует early prepared receipt и
  наблюдает тот же owner через read-only event-window wait. Task-generation change
  fencing/retirement не допускает чужой binding, retry или второго sender.
- UI различает provider identity/admission, Native ограничен maxConcurrent1,
  finite `native-offers` и maxSpend=null; input: bounded typed images в новой source партии. Native не принимает Web continuation; pixels идут отдельно от text. JSON tool
  request идёт через существующий ToolJournal с exact approval, не Native tools.
  Auth owner/UI, own-profile inventory и qualified account execution теперь
  связаны в source: explicit Inspect models → original catalog → первые два
  nonhidden actual models → live descriptor/resolveAdmission. Один account
  process/AuthManager/sender допускает два isolated task threads, сохраняя
  текущий max1 внутри каждого Native task. Ни одного actual account/model пока
  не admitted; fixture `official-openai` refusal остаётся отдельным контрактом.
  Реальный DEV login дошёл до official browser/passkey; human step не завершён,
  CLI завершился неуспешно. Новый login требует явного fresh epoch; profile сохранён.
  Нет доказательства saved auth, real inventory/startup policy или model delivery.
- Native development evidence: actual root HTTP1/20, core1/95, Node bridge1/83;
  оба project TS и renderer прошли. Это fixtures/local wire без настоящего model
  account. Peer P2 cleanup findings исправлены с focused receipts; inventory1/185,
  pool1/92, rootIPC1/16+1/9 и оба TS17:30 прошли. Renderer194, CLI634/exact9
  и map717 завершены; source641f277 опубликован с exact4CI. Это baseline до
  новой history партии. Её оба TS18:16, renderer195/18:17, CLI635/exact9 и
  map write/paths прошли; history source e75d073 опубликован с exact4CI. Подробные contracts:
  [protocol](agent-native-protocol.md), [main bridge](agent-native-bridge.md),
  [Rust wrapper build/proof](../development/owned-native-worker-build.md).
- **Owned Native final-summary history — опубликованная source партия:** отдельный
  default-off `owned-native-final-summary-v1` в существующем SQLite/FTS owner.
  Global recording + exact future task-generation consent + unknown-risk ack,
  pre-offer lease, trusted admitted source и actual Native IDs/time/digest;
  только validated `final.summary`, без raw JSON/host input/tool content.
  Каждый explicit revoke сохраняется task-generation-wide для всех sources,
  включая доступный текущий source; возврат alternate source не
  восстанавливает согласие; unavailable status не обещает enabled:false.
  Revoke-only IPC работает при drain. Synthetic backend1/44+1/12, actual private
  NodeHTTP/BunHistory1/24, boundaryHTTP1/14, IPC1/5 и providerfailure1/5 прошли.
  Оба TS18:16, renderer195/18:17, CLI635/exact9 и map write/paths прошли;
  source e75d073/exact4CI подтверждены. Real Native history/UI не заявляются;
  новый image source/CI отдельно.
  [Contract](owned-native-final-history.md),
  [evidence](../reviews/2026-10-18-owned-native-final-history.md).
- **Owned Native typed images — новая source партия:** matching approved tool
  result → typed envelope.images → full durable claim → fixed high data URLs;
  original ModelInfo+picker image capability, PNG/JPEG structure/CRC и exact
  canonical typed echo. Cumulative2attachments/160KiB на binding включает unknown.
  Leaf3/38, Bunprojection1/22; actual current wrapper once exit0/653ms,
  1child/2localfake requests (text→2images), third refused before send, cleanup done.
  Root wholeRuntime/ToolJournal/privateHTTP/mainbridge1/40 прошёл с fakeleaf;
  rendererTS18:29 и rootTS18:30 passed; qualifiedpool1/95(70ms) passed,
  peer review no material findings; renderer195/CLI638exact9/finalmap+paths
  PASS18:32. Новый image source commit/CI пока pending;
  no realaccount/model/UI, longer vision loops/fileupload correlation не proved.
  [Contract](owned-native-images.md), [evidence](../reviews/2026-10-18-owned-native-images.md).
- **Browser/desktop source партия опубликована в `6f6b171`:** после source commit
  `09383bb` добавлены P12 standalone browser tools через существующий host/journal,
  P13/P14 macOS helper/provider/controller/admin UI, canonical tool images и
  append-only late reconciliation. Все четыре CI jobs точного `6f6b171` прошли:
  macOS, Ubuntu, Windows, actionlint. Source остаётся `.9`, installed — `.8`.
  Реальный Chromium/MV3 composition fixture прошёл 1 / 49: observe→type→observe→click,
  пять counted canonical model requests, duplicate без второго эффекта и restart
  с retained receipt без rebind/replay. Это inert model adapter, не аккаунтный model
  turn и не actual DEV UI новой browser attachment поверхности.
- **P16 selected text resources реализованы следующим source batch:** явный `SKILL.md`
  плюс до16 UTF-8 справочных/шаблонных файлов под `references/` или `assets/`;
 32 KiB каждый,128 KiB весь пакет. Version/review/package digest связывают все bytes,
  quotas учитывают aggregate; retained tree проверяется перед доставкой. Peer P2 по
  fsync промежуточных каталогов исправлен и reviewed. Resource+legacy4/97 прошли;
  после fix focused nested-resource1/54, неизменившиеся legacy переиспользованы.
  Root connected HTTP/composer1/19 доставил exact packet одномуFAKE provider offer.
  Actual Russian DEV UI: native picker → full180+84byte preview/hash/package digest →
  import-unattached → explicit task/gen1 attach → revoke-retain → detach; zero model
  offers/dispatches/toolcalls. Оба project TS и renderer192-module build прошли;
  private GUI/core exit0, exactPIDs/port closed, temp profile removed. Это ещё не
  account-model execution и не исполнение script/binary ресурсов.
- **Новые bounded image/admission contracts:** request-only projection теперь
  явно исключает старые pixels только распознанных host tool outputs, сохраняя в
  том же function output omission notice/hash/call/turn/attachment indices. Original
  receipts и canonical continuation не переписываются. Human/new/unrecognized
  images обязательны: сохраняются либо request даёт not_sent до fetch. Historical
  omission разрешена только для `source.input`; provider `source.output` не может
  подложить host provenance. Forged function_call_output/non-assistant message после
  fetch ACK даёт awaiting_input без continuation; legacy tainted output блокирует
  новый fetch с not_sent. Найденный P2 provenance gap исправлен и reviewed. Лимиты
  прежние:2images/160 KiB и512 KiB canonical payload. Production provider+parser
  connected fixture: четыре observe → terminal, пять FAKE requests,2cases/156asserts;
  новых native captures, real UI/model в этом результате нет.
- Local tools admission теперь `admission.accepting && !launcherDetached`, отдельно
  от Web/tunnel; Agent model gate не ослаблен. Desktop inspect/list/enable(true)
  подчинены local admission, disable/revoke/cleanup доступны при drain. Actual
  isolated-server HTTP при Web=false без synthetic readiness и MCP off подтвердил
  passive inventory, blocked model step, drain refusal/cleanup (1 / 26). Detach
  учитывает active Agent turns/tools; actual held MCP SDK fixture прошёл937ms:
  Web=false, approved counter1, только active_agent_tools удерживает detach409;
  explicit release → terminal receipt → idle detach200; discovery закрыт до attach,
  inert Native HTTP остаётся200. Duplicate approval сохранил counter1, exact SDK
  PID reaped/home очищен. Pending model call подготовлен synthetic execution port,
  не настоящим model turn; исправленный fixture exit после owned cleanup не был
  продуктовым дефектом.
  Provenance P2 review finding исправлен; root project TypeScript, CLI build
  (245 modules), фактический `--version` `.9` и architecture map прошли 12:12–12:17 UTC.
  Renderer не изменён, его passing evidence переиспользуется. CI отдельного кода
  и установленная поставка остаются отдельными доказательствами.
- **Actual native DEV capture/type/click подтверждены на owned fixture:** у CLI-started
  fixture `NSRunningApplication.launchDate` оказался nil при существующем CG window;
  owner переведён на kernel process-start identity. Root UI перечислил и привязал
  exact fixture, inspected permissions все true; desktop discovery работал при
  выключенном MCP. Первый actual JPEG —70027 bytes; AX literal type completed и
  поле через CUA содержало точный ожидаемый текст; второй JPEG —78916 bytes.
  Первый click тогда не вызывался: 128 KiB history projection исключила целый latest
  dispatch с pending call. HTTP/UI теперь имеют отдельные compact `pendingToolCalls`
  и coverage независимо от истории (1 / 19 HTTP, 1 / 4 UI); лимиты и retained
  original images не расширены, outcomes не replay. Original task paused на4/6,
  generation2; helper и owned GUI/core завершились exit0, fake child отсутствует.
  Новый task с maxTurns3 отдельно подтвердил fresh observation `504555ac…`
  (1120×624) → exact approved click (280,290), receipt completed/
  `ax-press-dispatched`; CUA показал Counter1 и прежний literal text без повторного
  typing. Третий synthetic model offer получил canonical click result, задача стала
  `review_required`3/3, pending metadata пусты; `verified_complete` не заявлен.
  Доказан coordinate→AX hit-test/AXPress; generic CG pixel fallback не исполнялся.
  Старые два JPEG retained; большой two-image flow не переигрывался после fix —
  его compact pending projection подтверждена HTTP/UI regression, actual click —
  отдельным connected flow.
- DEV использовал private fake supervisor с one-shot readiness, поскольку GUI DEV
  намеренно подавляет этот автоматический путь. Это не actual Web/tunnel readiness;
  product source gate не изменён. Новые native поля и ввод доказывают fixture OS
  outcome, не real model/account turn и не произвольный business result. Windows
  provider отсутствует; browser/desktop execution receipts по-прежнему fail-closed
  для business evidence до отдельного trusted application observer.
- Core image projection (1 / 21) и reconciliation (1 / 44) имеют focused fixtures:
  tool images остаются canonical tool results, до двух PNG/JPEG и суммарно160 KiB
  с учётом истории; malformed/over-budget даёт not_sent до model fetch. Late receipt
  добавляет immutable reconciliation fact, сохраняя old unknown; old generation
  не оживляет задачу/worker, committed generation change отзывает binding.
- **Новая source партия и четыре actual DEV UI flow завершены:** P07
  native-picker project показал HEAD→working и older-base→working diff с полными
  HEAD/base OIDs без смены main. DW1 explicit requirement+consent сохранил revision1;
  plan-step/trusted-action association и personal confirmation показали 1/1;
  correction revision2 сбросила оба current counts до 0/1, сохранив две requirement
  revisions и одну historical coverage. Property verification явно unavailable.
- **DW5 DEV UI:** global opt-in → exact thread с двумя acknowledgements → scoped
  consent → actual Codex 0.163.0 `thread/items/list` EMPTY; UI явно сообщил, что
  canonical text не сохранён и пустой ответ не доказывает пустоту разговора.
  Revoke выключил refresh, затем global recording выключен. Nonempty text proof
  этим не получен. Connected RPC→SQLite fixture: 1 / 43, native producer:17 assertions.
- **P16 DEV UI:** native picker выбрал собственный `user-skills/demo/SKILL.md`,
  discovery показал SHA, review — 187 bytes; immutable version `2ddf3f622d4dc60f…`
  импортирована без attachment. Explicit attach к task/generation1 выполнен отдельно;
  revoke показал retained bytes и запретил новый attach, затем выполнен detach.
  Ни model/MCP execution, ни external calls этот flow не выполнял.
- P07 actual Git boundary (1 / 23), DW1 real ledger (1 / 36) и P16 5 focused cases /
  69 assertions переиспользованы; обе полные project TS проверки от 09:55 остаются
  passing, renderer build —188 modules, architecture update/check прошли у root.
  Эта партия опубликована в `09383bb`; её development результаты отделены от
  более раннего baseline CI и установленного приложения.
- **DW5 actual native boundary:** официальный Codex 0.163.0 подтвердил
  `thread/read` + `thread/items/list`, но inert injected history вернул пустую
  canonical page. `--canonical-only` честно завершает этот исход кодом 2
  `unavailable-from-injected-history`: реальные text/message IDs/turn IDs/timestamps
  не доказаны. UI этого empty thread может доказать consent/empty/revoke, но не
  canonical text capture; нет fallback к rollout/raw Responses или model start.
- **Новые функции подключены в исходниках main/preload/App и lazy admin owners
  `src/server.ts`.** Есть plan content, локальный editor/Git, worktrees,
  snapshots/restore, xterm/PTY, SSH/SFTP/remote commands и remote worktrees,
  selected-text history/search/export, native Codex metadata/fork journal,
  Agent mode с MCP pending continuations и signed pre-turn snapshot grants,
  AgentTools/skills, Chrome companion pairing, local control API и external usage.
  «Подключено» означает source composition; отдельные строки ниже сохраняют
  неподдержанные возможности и недостающие наблюдения.
- **Наблюдения интеграционного владельца в изолированном DEV profile:** native
  picker выбрал локальный проект; manual snapshot сохранил `alpha`; editor записал
  `beta`; Git diff показал `alpha → beta`; реальный xterm keyboard input вывел
  `NEKODEX_PTY_UI_OK`, после чего PTY закрыт. History opt-in сохранил выбранный
  synthetic text/code, FTS нашёл точную revision, экспорт в реальный файл сохранил
  partial marker и code; отключение записи сохранило данные. Codex CLI 0.163 на
  отдельном пустом profile вернул пустой список с явным connection scope.
- **Workspace и Agent DEV UI:** после нового main реальный selective restore
  вернул `alpha`, сохранив before-image `beta`; прежний `targetFile` defect закрыт.
  UI создал `codex/dev-ui-branch` с полным commit OID; actual Open выбрал exact
  owned managed-worktree root и показал его `hello` в file tree. Новые lifecycle/
  retained-archive guards имеют targeted source checks; отдельный archive UI
  outcome этим не заявлен. Manual Agent task подписал
  pre-turn grant для 6-byte `hello`, получил inert response, оставил sleeping worker;
  Review с нулём evidence остался blocked, Pause сменил generation на 2, grant
  отозван. Это DEV provider fixture, не работа реального Web аккаунта.
- **Agent/MCP evidence:** server fixture подтвердил approval, duplicate без второго
  эффекта и restart→known-output continuation: один эффект, два model requests.
  Mailbox Loop core выполнил два цикла с generation/dedup/pause (16 cases / 176
  assertions). Actual bounded Loop UI на inert adapter прошёл: maxTurns2, initial
  stage settled1/2 → waiting_for_mailbox_work без empty Continue → substantive
  packet `dev-mailbox-item-1` settled2/2; exact duplicate key сохранил 2 runs/2 turns;
  Pause generation3 убрал Run consent. Это не external model/business outcome. Generic external
  watcher не реализован. Selected-file observer и synchronous pre-Verify
  revalidation прошли actual Manual UI: alpha SHA → passed → Review; внешняя beta
  → Verify 409 refused; восстановленная alpha + новая observation → Review с
  актуальным фактом → `verified_complete`. Два прежних immutable facts сохранены;
  supersession меняет active coverage, а не переписывает историю. Доказан выбранный
  file-SHA outcome, не произвольный бизнес-результат и не automatic Goal.
- **P15 install receipt:** реально подготовлен и frozen-installed официальный
  `@modelcontextprotocol/server-filesystem@1.0.0`: 104 dependency packages, 4691
  tree entries; lifecycle scripts запрещены. Review сохранён disabled, host/server
  выключены, MCP PID отсутствует. [JSON-квитанция](../reviews/2026-10-18-agent-tools-official-install.json)
  доказывает installation, не запуск MCP. Full graph Bun lock v1/v2, launch-time
  tree pins и exact pre-intent archive/reconciliation имеют focused evidence;
  independent review исправил data/code authority overlap и archive target.
- **P17 macOS boundary:** реальный custom Seatbelt kernel boundary запретил
  outside-file/network доступ; C fork наследовал ограничения при живом parent;
  Bun с private HOME и actual SDK MCP host выполнили разрешённый read/counter.
  Глобальная metadata visibility, system-library reads, sysctls и deprecated Apple
  interface явно раскрыты. Arbitrary native executor, cleanup после выхода parent
  и Windows/Linux parity этим не доказаны.
- **Companion и usage:** bundled MV3 artifact copy/resolver подтверждён отдельно
  (1 case / 8 assertions); реальная Chrome MV3 extension прошла activeTab,
  pair/select/observe/type/click/revoke (1 / 17) через headless popup document,
  не видимый toolbar popup. DEV app включил/выключил настоящий listener, default
  off, без tab grant. Usage UI прочитал synthetic metadata 100/20 tokens,
  исключил sentinel/CWD, unknown-source aggregate и цену оставил unknown.
  Remote UI сохранил fake profile без соединения: реальная SSH authentication
  не проверена; real local SFTP/Python/Git protocol fixtures остаются отдельными.
- Новая программа не установлена на основании этих source/DEV результатов.
  Порядок платформ явно подтверждён пользователем: весь набор сначала macOS,
  затем Windows/Linux; завершённой одновременной parity пока нет. Windows/Linux credentials/private
  ACL/native PTY, remote OAuth, generic native executor, ChatGPT companion send
  и поддержка других native desktop providers — отдельные gaps. QuickJS условен по
  подтверждённому composition gap; сейчас такой gap не установлен.

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

## Полная таблица реализации: платформа

«Осталось» — реальная работа, не повторное разрешение пользователя. Критерии
задают итог сценария; они не означают запуск полной suite или обязательную
реализацию всех комбинаций платформ в первом результате.

| ID | Возможность | Польза | Текущая реализация фактически | Осталось реализовать | Зависимости | Приёмка результата | Этап |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | Точный контракт tunnel credentials | Один совместимый способ передать ключ Electron, CLI и detached child | SDK 0.0.16 `env:` selector и detached delivery подтверждены в D01; source-вопрос закрыт | Сохранить контракт при новых OS/routes и обновлениях SDK; affected-peer rotation | Существующий D01 owner; конкретно изменившийся SDK/route | Selector остаётся без raw key; новый process получает exact scoped secret; живой старый process не считается обновлённым от смены env | Сквозной, готово для подтверждённой macOS route |
| P02 | Общий protected credential provider | Защита ключей без конкурирующих файлов и владельцев | macOS Keychain, Electron/Bun/headless и installed migration подтверждены; другие ОС явно legacy | Поддержанные Windows/Linux protected adapters и migration UI при готовом noninteractive backend | P01; OS credential facility; существующая account mutation lease | Scoped prepare/commit/discard, locked/unavailable сохраняет reference; restart читает vault; config/profile/logs без raw key; legacy не скрыт | Сквозной; macOS выполнен, Windows/Linux — этап2 |
| P03 | SSH/SFTP дерево и preview | Удалённый проект становится полноценным workspace | SSH/SFTP owner/UI/preload подключены; UI сохранил fake profile без connect; local real SFTP protocol fixture есть | Реальная SSH authentication/выбранный host/root и reconnect ещё не проверены; не выдавать fake profile за подключение | Workspace registry и capability contract; системный SSH/SFTP | Host-key mismatch не принимается автоматически; root канонизирован; потеря соединения видна и не возвращает пустой успешный каталог | F2, первый remote результат |
| P04 | Удалённые команды и запись файлов | Работа Agent mode в выбранной remote среде | Remote file save/drafts, explicit command approval и signed durable started/completed/unknown receipts подключены | Реальный remote mutation/reconciliation flow; Agent mode не получает remote authority автоматически | P03; P17; единый P20 outbox для agent actions | Обрыв после send/write даёт unknown и reconciliation; нет слепого retry; результат, ошибка и partial outcome различимы; чужой host/root недоступен | F2 после P03; agent wiring F3 |
| P05 | Управляемые локальные worktrees | Изоляция параллельной работы и безопасное возвращение к ней | DEV UI create `codex/dev-ui-branch` с full OID и Open exact owned worktree→hello file tree наблюдены; lifecycle/archive guards в source | Только новые archive/lifecycle transitions при их изменении; client-owned worktrees остаются у клиента | Workspace registry; DW3 для собственного worker; client capability для клиентского режима | Exact marker/repo/root/refs; restart не создаёт новый worktree; dirty/untracked/ignored и чужая ownership защищают от удаления | F2 |
| P06 | Управляемые remote worktrees | Изолированные remote workers и повторное использование remote checkout | `remote-worktrees.cjs`: inspect→prepare→one-use create/archive, ownership и receipts; 7 preload methods подключены | Реальный SSH remote Git lifecycle/reconnect; server environment/required helpers должны быть доступны | P03–P05; P04 outcome reconciliation | Crash/reconnect сохраняет exact remote owner; uncertain Git mutation не повторяется; чужие refs/dirty data не удаляются; unsupported server показан явно | F2 после remote execution и local lifecycle |
| P07 | Git Review рабочего дерева/веток | Оценка изменений в собственной рабочей среде | Branch/base source+actual Git1/23 и actual DEV native-picker HEAD/older-base diff/full OIDs/main unchanged подтверждены | Real remote UI по выбранной среде; unchanged local selector/diff не повторять, выбор base не fetch/checkout | Явный local workspace; remote adapter отдельно P03/P06 | Открытый diff привязан к exact HEAD/base OID; смена состояния даёт stale; просмотр не делает fetch/checkout/commit | F1; remote расширение F2 |
| P08 | Редактор файлов | Исправления и review без ухода из NEKODEX | Local editor/drafts/save/conflict UI подключён; DEV native picker и save `alpha → beta` наблюдены; remote edit route тоже в source | Реальное remote edit/conflict evidence и targeted новые edge cases; local passing flow переиспользовать | Local workspace authority; P04 для remote, без переноса прав из prompt | Поздняя external edit сохраняет draft и блокирует stale overwrite; staging/flush/rename не обнуляет оригинал; binary/large/remote limits видимы | F1 local; F2 remote |
| P09 | Выборочное Git/file restore | Вернуть конкретную правку, сохранив человеческую работу | Actual DEV selective restore после нового main вернул alpha и сохранил beta recovery before-image; прежний targetFile defect закрыт | Сохранять scope/revision checks и проверить только новые substantive изменения; unchanged restore evidence переиспользовать | DW8 snapshot owner; P07; P08 save authority | Новый concurrent edit блокирует stale restore; исходные bytes доступны; остальные файлы не меняются; повтор не применяет destructive действие второй раз | F2 вместе с DW8 |
| P10 | Native terminal docks | Человеческий shell в контексте workspace | Main/IPC/xterm связаны с real node-pty; DEV keyboard echo `NEKODEX_PTY_UI_OK` и закрытие наблюдены | Native PTY ABI/packaging и поведение Windows/Linux на этапе2; remote terminal по своему contract | Workspace identity; native PTY development proof; P03/P04 для remote | Input/resize в exact PTY; ограниченный output; close ждёт точный exit и сохраняет посторонние shells; human terminal не становится agent tool автоматически | F2 |
| P11 | Chrome/Firefox companion transport | Альтернативный ChatGPT transport там, где нужен внешний browser | Artifact copy/bundled resolver подтверждён 1/8; actual MV3 Chrome pair/select/observe/type/click/revoke 1/17, app listener enable/disable; send:false | ChatGPT send и Firefox не реализованы; headless popup document не доказывает видимый toolbar popup; distribution отдельно | Подтверждённый transport gap; existing turn registry; P14 | Один sender/settlement owner; disconnect/version mismatch не создаёт второй send; permissions ограничены; tab/account mismatch отклонён | F4, конкретный browser сначала |
| P12 | Browser automation provider | Веб-действия для standalone Agent mode и клиентской интеграции | Standalone browser builtin host/leaf/attachment/admin UI подключены к единому tool journal; actual Chromium/MV3 composition fixture1/49,5canonical requests, duplicate/restart без второго эффекта | Root actual DEV browser attachment/approval flow; real model/account отдельно; execution receipt не application business evidence; ChatGPT send unsupported | P14; P17; DW3/P20 для собственного executor; P11 только если выбран extension путь | Inventory и execution различимы; exact page/frame bound; unsupported action недоступен; late/partial result не приводит к replay | F4 |
| P13 | Desktop automation macOS/Windows | Computer Use в самостоятельной среде | Actual owned-background-fixture capture/JPEG→literal AX type+Cuaexact и отдельный fresh1120×624→approved click280,290→AXPress/CuaCounter1→canonical final3/3review_required подтверждены | Real provider/account, Windows/installed delivery отдельно; generic CG pixel fallback не упражнялся, execution/application fixture outcome не general verified task | P14/P17; OS facility; DW3/P20; отдельная поддержка каждой ОС | Реальная capture→input→fresh observation в exact window/process; stale input отклонён; permission unavailable виден; успех одной ОС не объявляет поддержку другой | F4, по платформам |
| P14 | Input связан с наблюдением | Защита от действий в старой вкладке/чужом окне | Actual native capture/type/freshclick и pendingmetadata fixes сохранены; bounded old-host-tool-pixel projection source реализована, connected provider+parser2/156 с4observe/5FAKErequests, source.input-only provenance fix reviewed | Новая bounded Native images source+leaf3/38+Bun1/22+actualwrapper2fake requests готовы; root integrated mainHTTP1/40 passed(fakeleaf), обаTS+renderer195/CLI638exact9/finalmap paths PASS, no realmodel/UI; mandatory human/new/unrecognized images remain or fail, caps unchanged | Реальный consumer P11–P13; один action owner | Refs/coordinates другого или устаревшего наблюдения отклоняются до input; partial batch не называется rollback; новая observation не даёт новых разрешений | F4, до первого provider input |
| P15 | MCP/plugin discovery, install и runtime | Инструменты собственного Agent mode с понятным источником | Managed official npm installer + MCP host/UI подключены; filesystem 1.0.0 реально frozen-installed:104 packages/4691 entries, review disabled/MCP PID null; fullgraph/tree/archive fixes проверены | Отдельные enable/connect и real requested tool proof; OAuth пока unsupported; catalog расширять явно, не называть install успешным запуском MCP | DW3; P17/P20; credential owner; official distribution policy | Advertised tool не равен execution proof; exact server/process/account; uninstall/stop не теряет active operation; не восстановлены исключённые overlays; unsupported install явен | F3 |
| P16 | Skill discovery/import/update/routing | Явно выбранные инструкции для собственного composer | Immutable local text + до16 явно выбранных UTF-8 reference/template файлов; package digest/quota/revalidation; actual264-byte package UI import/attach/revoke/detach; HTTP/composer1case19asserts → одинFAKE offer | Official/vendor imports, executable/binary/network resources/OAuth и physical cleanup unsupported; real model composition отдельно, update не auto-attach | DW3/P15; разрешённые roots; официальный plugin источник | Выбранный skill соответствует canonical identity/digest; scan только разрешённых roots; metadata не даёт файловых прав; update сохраняет нужные local adaptations | F3 |
| P17 | Command sandbox и filesystem policy | Настоящие ограничения собственного tool host | Custom macOS Seatbelt для MCP реально kernel-blocked outside FS/network; C fork inheritance при живом parent, Bun private HOME/SDK read+counter подтверждены; native-policy arbitrary executor unsupported | Win/Linux sandbox; post-parent lifecycle proof; раскрытые metadata/systemlib/sysctl grants и deprecated interface учитывать; native command executor не заявлять | DW3; workspace registry; platform-specific sandbox facility | Denied действие не исполняется; symlink/root escape закрыт; native exec не назван изолированным без OS proof; unavailable sandbox блокирует соответствующую route | F3; необходимый контракт для F2 mutations |
| P18 | QuickJS/WASM composition | Меньше round trips у клиента без подходящей composition | Gateway/native composition существуют; конкретный дополнительный interpreter не реализован | При измеримом gap — один bounded interpreter и allowlisted tool callback; без собственной FS/network authority | Конкретный consumer/сравнение; P17/P20 для callback; поддержанный runtime | CPU/memory/call/output limits реально останавливают JS; callback перепроверяет authority; timeout не отменяет уже accepted external operation | F5, условно по gap |
| P19 | Поддержанный локальный read-only API | Внешний monitor/integration получает правдивый status | Versioned local-control-api routes/policy, separate credential, passive bounded sources и UI подключены | Наблюдение реального named consumer; unknown/unopened sources не запускать ради чтения; history content только отдельным scope | Existing passive owners; отделение от P20 | Host/origin/auth checks; unavailable/stale сохраняются; reads не repair/start/send; stalled reads ограничены; секреты и raw transcript не выходят | F3; возможно раньше executor |
| P20 | Action API и automatic sender | Один управляемый вход действий UI, Goal и внешней интеграции | Scoped Agent actions используют существующий Agent owner/store.command и durable dispatch; API не создаёт второго sender | Реальная external integration и reconciliation evidence; action scope/current generation mandatory, read-only default сохранить | DW3/DW4; exact client/provider capabilities; P19 отдельный read contract | Duplicate request возвращает прежний receipt; unknown acceptance не пересылается; auth не даёт лишнего scope; cancel/stop/restart сохраняют outcomes; нет второго sender внутри status API | F3 |
| P21 | Cross-client usage dashboard | Обзор разных локальных клиентов без потери происхождения | Opt-in import/UI реализованы; DEV synthetic metadata 100/20 tokens прочитаны без sentinel/CWD, unknown-source вне aggregate | Реальные выбранные client logs/parser-version scope; fixture tokens не доказательство аккаунтного provider usage | Supported parser contracts; explicit log access; existing usage store projection | Нет chat content; observedAt/coverage/unknown видимы; rotated log не удваивает числа; bridge и client totals не складываются дважды | F5 |
| P22 | Cost estimates и сравнение экономии | Понятная оценка альтернативной стоимости | Pricing catalog/estimated-api-equivalent views подключены; DEV unknown price и excluded unknown-source показаны честно | Real selected catalog/consumer; actual bill/savings не заявлять; overlapping/unknown sources не суммировать | P21; actual provider usage и versioned pricing там, где доступны | Estimated context × calls подписано estimate, не bill; unknown не ноль; alternative comparison не называется фактической экономией; пересечения исключены либо показаны отдельно | F5 |
| P23 | Compaction, updater, accounts и routing | Сохранение контекста, обновлений и account isolation при расширении | Существующие owners сохранены; localtools offlineHTTP1/26 + real heldMCP SDK: counter1/activeTool-only detach409→release→idle200, NativeHTTP200; duplicate без второго эффекта | ОбаTS, renderer195/CLI638exact9/finalmap+paths прошли18:32; новый image commit/CI pending; synthetic setup не realmodel | Архитектура текущих compaction/update/account modules; новые routes по scope | Observability без replay authority; checkpoint публикуется после durable write; update signature/commit/rollback сохранены; чужой account/runtime не заимствуется | Сквозной |
| P24 | Пропорциональный CI и delivery | Быстрое развитие с доказанным нужным результатом | Существующие focused checks/CI и architecture map; чужой full audit не переносится | Checks новых изменённых contracts и нужных release targets; архитектурные docs/map вместе с изменением; один integrated verification owner | Связанный законченный batch; development proof перед release | Неизменённые passing checks переиспользованы; failure до fault boundary не считается rollback proof; build/source/merge/install/live результат разделены; broad suite не запускается по умолчанию | Сквозной |

## Полная таблица реализации: длительная работа и история

| ID | Возможность | Польза | Текущая реализация фактически | Осталось реализовать | Зависимости | Приёмка результата | Этап |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DW1 | План и checklist покрытия | Видно, какая часть исходного запроса выполнена и чем подтверждена | Real ledger1/36 + actual UI requirement consent rev1→step/action/user-confirmed1/1→correctionrev2 counts0/1, history retained; propertyverification unavailable | Native machine property verification здесь не заявляется; добавлять конкретные observers по реальной потребности, personal confirmation не machine proof | N03–N06; supported native events; отдельная content policy | Lookalike tool/prompt не становится plan; completed модели не verified; correction инвалидирует старое coverage; source/build/release свойства различимы | F1 |
| DW2 | Дерево workers, status и reuse | Возврат к контекстному исполнителю без создания лишнего | NativeThreadsSurface, metadata projection и supported app-server read/fork wired; CLI 0.163 DEV empty-profile list/scope наблюдены | Fresh worker reuse/continue лишь при поддержанной capability; отдельная connection не доказывает общий live status | DW1 identity; exact thread/family; supported app-server/client contract | Две семьи с одинаковым name не смешиваются; tab close не завершает worker; restart не запускает; disconnected status unknown; follow-up revalidates identity | F1 |
| DW3 | Persistent Agent workers/mailboxes | Самостоятельная параллельная работа и reusable sleeping workers | Durable Agent runtime + explicit owned-native router/preclaim/main bridge/early receipt/read-only same-owner wait/invalidation интегрированы; Rustpublicwrapper actualbuild/localfake proof; HTTP1/20/core1/95/node1/83 | Qualified auth/inventory/admission/account pool уже wired source; fake pool1/92, inventory1/185, cleanup findings fixed. Actual auth/account/models/startup policy и real model task ещё не proved; max1 внутри task, pool2 across tasks; typed images2/160KiB cumulative в новой source партии | P17/P20; workspace/P05 по сценарию; один top-level task owner | Crash до/после accept/ACK не теряет и не дублирует инструкцию; late result сохраняется; unknown send не replay; concurrency соблюдена; at-least-once не назван exactly-once эффектом | F3 |
| DW4 | Staged task-plan executor | Длинная задача движется по содержательным этапам | Stages/dependencies/correction/control единым owner; Web и owned-native provider routes/continuations строго разделены, Native fixed-schema JSON requests идут в existing ToolJournal | Реальный admitted Native/Web multi-stage outcome и generation/retirement UI; source bridge integration уже есть, production model admission пока отсутствует | DW3/P20; исходные requirements с первой инструкции | Duplicate finish не запускает следующий этап дважды; correction важнее auto-step; restart не переигрывает uncertain dispatch; unchanged passing check не повторяется | F3 |
| DW5 | Opt-in transcript и Markdown export | Переносимый результат и восстановление контекста | Selected-text/canonical RPC→SQLite1/43/native17 и actual empty-page consent/revoke UI. Owned final-summary source связан с provider/main receipts/oneSQLite/HTTP/IPC/UI: defaultOFF, global+task-generation future consent+risk ack, pre-offer lease, actual IDs/time/source/digest, persistent all-source task-generation revoke; backend1/44+P1 1/12, actualHTTP1/24 | Actual owned-history UI и real account/model final с provenance; full supported transcript/background subscription отдельно. Explicit canonical refresh не background capture; unknown-secret risk не устранён known-pattern filter | Native/client event adapter; content opt-in отдельно от metadata ledger | Stream/edit/reload не дублируют; authored human/automatic различены; partial history явна; quota не удаляет активную историю молча; отменённый save не saved | F1 |
| DW6 | Локальный поиск истории | Найти exact сохранённое сообщение без полного сканирования | FTS/query/exact revision UI подключены; DEV selected synthetic answer найден и открыт | Сохранять incremental edit/delete/retention ownership; поиск не обещает несохранённый transcript | DW5 storage/retention owner | Indexed/total/partial видны; edit/delete обновляют результаты; exact message переход; raw tool/credentials вне индекса; несохранённая история не обещается | F1 вместе с history |
| DW7 | Fork истории через клиент | Продолжить отдельную линию от выбранной точки | Native user-click fork route/UI и private durable fork journal с uncertain reconciliation подключены | Реальный supported fork результата; DEV empty list не доказывает live fork или attachments parity | DW5 context; supported fork method; P20 для action receipt | Исходная ветка сохранена; duplicate action не создаёт второй fork; exact point/partial seed видны; replay всего prompt не маскируется под fork | F1; standalone branch F3 |
| DW8 | Ручные code snapshots | Сохранить рабочее состояние и вернуть выбранные файлы | Actual DEV snapshot alpha→beta→restore alpha с beta before-image и managed-worktree Open завершены | Новые archive/lifecycle UI изменения проверять отдельно; passing snapshot/restore/Open переиспользовать | Явный workspace owner; P07/P09; history link полезен, но не обязательный блокер | Dirty/untracked сохранены; ignored/binary/submodule scope объявлен; exact root/path/hash; concurrent edit вызывает conflict; failed test не запускает auto rollback | F2, первый checkpoint результат |
| DW8a | Автоматические per-turn checkpoints | Действительно восстановимое состояние до agent writes | Actual Manual DEV task подписал exact grant и pre-turn snapshot 6-byte hello; Pause gen2 и revoke выполнены; immutable receipt store подключён | Расширения snapshot-only scope не обещать; native-client generic pre-write hook и весь machine filesystem не охвачены | DW8; supported exact boundary hook; P17 execution owner | Пропущенный hook даёт unavailable; человеческие concurrent edits сохранены; post-turn diff не назван pre-turn snapshot или полным rollback | F2 после DW8; собственный hook F3 |
| DW9 | Ручной Goal helper | Найти оставшуюся работу по требованиям и наблюдённым исходам | Actual Manual UI: SHA passed/Review → external drift → Verify409; restore+new observation → current Review → verified_complete; immutable facts сохранены | Semantic independent helper/provider отдельно; выбранное file property не сертификат всего deliverable; unchanged SHA drift/recovery не повторять | DW1/DW5; evidence adapter; provider contract; отправка через существующего owner | Missing/failed/unknown не done; incomplete input виден; correction инвалидирует review; recommendation не самосертификат; тот же revision без новых facts не проверяется снова | F3, до автоматического Goal |
| DW10 | Автоматический Goal для конечного результата | Доведение разрешённой задачи без ручного повторения follow-up | Goal/runtime/UI/one outbox и explicit Web/owned-native provider identity реализованы; Manual evidence flows подтверждены, Native source max1/no money quote, bounded typed images в новой партии | Automatic Goal с настоящим admitted provider/outcome ещё не доказан; source auth/inventory/pool/admission есть, но actual Native login/models/startup-policy proof отсутствует, Manual/localfake не закрывает этот scope | DW9; DW3/P20 для Agent mode либо supported client follow-up; существующие approvals | Goal/Loop/Off не оживляют старую generation; user input/approval/active workers первичны; unknown send не replay; завершение по наблюдённому coverage; unknown spend не объявлен нулём | F3 после ручного helper |
| DW11 | Непрерывный Loop | Явно заказанная повторяющаяся работа | Mailbox Loop core16/176 и actual bounded fake-adapter UI:2 turns/2 runs, waiting mailbox, substantive packet, duplicate без третьего run, Pause gen3/consent removed; externalWatchers:false | Configured real provider и отдельно запрошенные recurring inputs; generic continuous watcher не реализован, fake-adapter UI не business proof | DW3/DW10; explicit recurring instruction; P20 | Нет пустого Continue; unchanged state ставит на паузу с причиной; stop не теряет late results; approval/unknown не перескакиваются; расход/параллельность ограничены | F3 после конечного Goal |

Таблица содержит **24 строки P01–P24 и 12 строк DW1–DW11 с отдельной DW8a,
всего 36**. P09 — интерфейс выборочного restore, DW8 — владелец snapshot;
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

D01 macOS installed receipt и N01–N08 source остаются отдельным baseline.
Новые owners подключены в source; canonical DEV подтвердил picker/editor/Git,
manual snapshot/selective restore с recovery before-image, worktree create/Open,
xterm input/close, selected history/search/export, native empty-profile list,
Manual Agent signed pre-turn/result/sleeping worker/blocked Review/Pause/revoke
и selected SHA drift→Verify refusal→new observation→verified_complete,
listener enable/disable и metadata-only usage. MCP continuation, two-cycle mailbox
Loop core/UI и SDK sandbox effect имеют свои fixture boundaries; actual extension flow
проверен через headless popup document. Official installer receipt оставил server
и host disabled, PID null. Это не установленный новый release и не real Web result.

Bounded mailbox Loop UI завершён на fake adapter: начальный stage, ожидание без
пустого Continue, substantive packet, exact duplicate без нового run и Pause с
отзывом Run consent. Новая source партия requirements/branch-base/canonical-recorder/managed-skills
завершила четыре root DEV UI flow; canonical actual nonempty text пока не доказан. Следующее
implementation направление — official Native account/server/model admission и
реальный provider Automatic Goal; Native bridge/router/preclaim source уже есть.
Далее — explicit client execution handoff и оставшиеся capability gaps; разрешить
substantive findings текущей партии и выполнить source publication. Новая browser/desktop source партия ждёт отдельного root DEV
flow: actual fixture capture/type и separate fresh observe/click/final уже
подтверждены; compact pending-call fix имеет focused HTTP/UI evidence. Root
проверил обе project TS11:34 и CLI245/renderer192 rebuild11:35 для предыдущего
native flow; новая image/admission source партия имеет отдельные focused fixtures
и ожидает своих review/TS/CLI результатов. Source publication и installed delivery
фиксируются отдельными квитанциями. Root владеет
map, source commit/PR и отдельной delivery.
Unchanged passing restore/Open/SHA flows не повторяются. Порядок платформ
подтверждён: этап1 — весь macOS набор, этап2 — Windows/Linux. Открытые macOS
native/provider/Goal/remote/auth/skill-resource пункты продолжают входить в цель;
unsupported capability и чужая платформенная parity не объявляются готовыми.

Ближайшие implementation priorities после текущей партии:

| Порядок | ID | Конкретный следующий результат |
| --- | --- | --- |
| 1 | DW3–DW5, DW9–DW10 | После source auth/inventory/pool и исправлений cleanup завершить явный fresh login, actual qualified account/model inventory/startup policy, real Native task и Automatic Goal/outcome. Pool source2 threads across tasks не снимает per-task max1. Final-summary history source/fixtures уже есть; далее actual UI consent/revoke и real account/model final с provenance. Full transcript/background subscriptions не заявляются. |
| 2 | DW2, DW7 | Supported existing-client worker continue/reuse и explicit exclusive execution handoff; owned inference Native binding не означает adoption чужих threads. Exact fork по настоящей supported capability. |
| 3 | P03–P08 | Подключить выбранную реальную SSH среду и явную Agent remote authority; branch/base source и actual local UI уже готовы. |
| 4 | DW3–DW4, DW9–DW11 | Реальный configured provider и automatic Goal; bounded mailbox Loop UI уже проверен на fake adapter. Semantic review отличать от selected-file observer; external watcher отдельно. |
| 5 | P11–P16 | Actual native capture/type/fresh click/final уже наблюдены. Bounded old-tool image-history source уже реализована с прежними caps; далее real model и trusted application outcome observer, generic CG fallback по заявленному scope. ChatGPT send/Firefox, executable/binary skill resources и auth/OAuth остаются macOS этапом1; Windows/Linux — этап2. |
| 6 | P02, P10, P17–P22 | Этап1: реальные external API/log/pricing consumers и оставшиеся macOS adapters; этап2: Windows/Linux parity. QuickJS только при установленном gap. |
