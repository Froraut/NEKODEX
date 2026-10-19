import { useState } from 'react';
import { Badge, Button, Checkbox, Notice, Panel, Select, TextField } from './design';
import type { AgentToolsApi, AgentToolsStatus, ManagedInstallReceipt, ServerRecipe } from './agent-tools-types';
export function AgentToolsInstaller({ api, status, locked, choose, act, refresh, onReview }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; locked: boolean;
  choose: (en: string, ru: string) => string;
  act: (operation: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  onReview: (review: { reviewId: string; recipe: ServerRecipe; trust: string }) => void;
}) {
  const [actionId, setActionId] = useState<string>(() => crypto.randomUUID());
  const [catalogId, setCatalogId] = useState('official-filesystem');
  const selectedRecipe = status?.installCatalog?.find(row => row.id === catalogId);
  const [root, setRoot] = useState(''); const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState<ManagedInstallReceipt | null>(null);
  const inspect = async (id = actionId) => {
    const next = await api.request({ action: 'installReceipt', actionId: id }) as ManagedInstallReceipt | null;
    setReceipt(next);
    if (next) { setCatalogId(next.catalogId); setRoot(next.allowedRoot); setConsent(false); }
    await refresh();
  };
  return <Panel title={choose('Reviewed official MCP catalogue', 'Проверенный официальный каталог MCP')}>
    <p>{choose('Choose an exact reviewed package. Preparation resolves an exact dependency graph without running package scripts. Installation, file review, saving disabled, enablement and connection remain separate actions.', 'Выберите точный проверенный пакет. Подготовка закрепляет граф зависимостей без запуска package scripts. Установка, проверка файлов, сохранение выключенным, включение и подключение остаются отдельными действиями.')}</p>
    <Select label={choose('Official package', 'Официальный пакет')} value={catalogId} disabled={locked} onChange={value => { setCatalogId(value); setConsent(false); setReceipt(null); setActionId(crypto.randomUUID()); }} options={(status?.installCatalog ?? []).map(recipe => ({ value: recipe.id, label: `${recipe.label} · ${recipe.version}` }))} />
    {selectedRecipe ? <div className="agent-tools-review">
      <strong>{selectedRecipe.package}@{selectedRecipe.version}</strong><p>{selectedRecipe.capabilities}</p>
      <details><summary>{choose('Package identity and execution boundary', 'Идентичность пакета и граница исполнения')}</summary><dl>
        <dt>{choose('Publisher', 'Издатель')}</dt><dd>{selectedRecipe.publisher.organization} · {selectedRecipe.publisher.registryIdentity}</dd>
        <dt>{choose('Publisher evidence', 'Подтверждение издателя')}</dt><dd>{choose('Observed registry metadata; publisher signature/provenance has not been independently verified.', 'Наблюдаемая metadata registry; подпись и provenance издателя независимо не проверялись.')} <code>{selectedRecipe.publisher.trustedPublisherId}</code></dd>
        <dt>{choose('Runtime', 'Runtime')}</dt><dd>{selectedRecipe.runtime.family} {selectedRecipe.runtime.version} · {selectedRecipe.runtime.verification === 'filesystem-live-only' ? choose('existing filesystem runtime evidence', 'имеется прежняя runtime-проверка filesystem') : choose('this package has not been run', 'этот пакет ещё не запускался')}</dd>
        <dt>{choose('Authentication', 'Авторизация')}</dt><dd>{choose('None. These local stdio recipes do not use OAuth. Provider authentication is configured separately.', 'Не требуется. Эти локальные stdio-рецепты не используют OAuth. Авторизация провайдеров настраивается отдельно.')}</dd>
        <dt>{choose('Execution boundary', 'Граница исполнения')}</dt><dd>{status?.capabilities.mcpSandboxAvailable ? choose('macOS Seatbelt: network denied; exact directory grants are shown at configuration review.', 'macOS Seatbelt: сеть запрещена; точный доступ к каталогам показан при проверке конфигурации.') : choose('OS sandbox is unavailable here. An unrestricted server would run with your user permissions; inspect its configuration before enabling it.', 'OS sandbox здесь недоступен. Сервер без изоляции работает с правами вашего пользователя; проверьте конфигурацию перед включением.')}</dd>
        <dt>{choose('Source', 'Источник')}</dt><dd><a href={selectedRecipe.source} target="_blank" rel="noreferrer">{choose('Official source documentation', 'Официальная документация исходников')}</a></dd>
        <dt>{choose('Immutable package archive', 'Неизменяемый архив пакета')}</dt><dd><code>{selectedRecipe.sourcePin.url}</code><br /><code>{selectedRecipe.integrity}</code></dd>
        <dt>{choose('Reviewed entry SHA256', 'SHA256 проверенного entrypoint')}</dt><dd><code>{selectedRecipe.sourcePin.entrySha256}</code></dd>
      </dl></details>
      <p>{choose('Capabilities above describe the reviewed package. Actual tools and connection status appear only after a separate enabled connection; a successful installation supplies neither.', 'Возможности выше описывают проверенный пакет. Реальные инструменты и состояние подключения появляются после отдельного включения и подключения; успешная установка их не подтверждает.')}</p>
    </div> : null}
    <TextField label={choose(selectedRecipe?.launch === 'no-arguments' ? 'Explicit installation selection directory (no data grant for this recipe)' : 'Explicit data directory', selectedRecipe?.launch === 'no-arguments' ? 'Выбранный каталог установки (этот рецепт не получает доступ к данным)' : 'Явный каталог данных')} value={root} onChange={event => { setRoot(event.target.value); setConsent(false); }} action={api.pickInstallRoot ? <Button disabled={locked} onClick={() => void act(async () => { const chosen = await api.pickInstallRoot!(); if (!chosen.cancelled && chosen.root) { setRoot(chosen.root); setConsent(false); } })}>{choose('Choose directory', 'Выбрать каталог')}</Button> : undefined} />
    <Checkbox checked={consent} onChange={setConsent} label={choose('I select this exact package and its displayed data scope. Enablement, connection and tool approval are separate actions.', 'Я выбираю этот точный пакет и показанную область данных. Включение, подключение и подтверждение инструментов — отдельные действия.')} />
    <TextField label={choose('Stable installation action ID', 'Постоянный ID установки')} value={actionId} onChange={event => { setActionId(event.target.value); setReceipt(null); }} />
    <div className="agent-tools-state"><Button disabled={locked || !consent || !root || !status?.capabilities.install || !selectedRecipe} onClick={() => void act(async () => { setReceipt(await api.request({ action: 'prepareInstall', actionId, catalogId, allowedRoot: root, explicitUserAction: true }) as ManagedInstallReceipt); await refresh(); })}>{choose('Prepare dependency graph', 'Подготовить граф зависимостей')}</Button><Button disabled={locked || !actionId} onClick={() => void act(() => inspect())}>{choose('Inspect owned transaction', 'Посмотреть состояние операции')}</Button></div>
    {status?.installations?.rows.map(row => <div className="agent-tools-root" key={row.actionId}><span>{row.catalogId} · {row.state}</span><code>{row.actionId}</code><Button size="sm" disabled={locked} onClick={() => void act(async () => { setActionId(row.actionId); await inspect(row.actionId); })}>{choose('Inspect receipt', 'Посмотреть квитанцию')}</Button></div>)}
    {receipt ? <div><Badge tone={receipt.state === 'installed' ? 'success' : 'neutral'}>{receipt.state}</Badge><pre>{JSON.stringify(receipt, null, 2)}</pre>
      {receipt.state === 'prepared' ? <Button disabled={locked} onClick={() => void act(async () => { setReceipt(await api.request({ action: 'installReviewed', actionId: receipt.actionId, graphSha256: receipt.graphSha256, explicitUserAction: true }) as ManagedInstallReceipt); await refresh(); })}>{choose('Install this exact reviewed graph without scripts', 'Установить этот граф без package scripts')}</Button> : null}
      {receipt.state === 'installed' ? <><Notice>{choose('Package bytes are installed. Installation did not start or enable a server.', 'Файлы пакета установлены. Установка не включала и не запускала сервер.')}</Notice><Button disabled={locked} onClick={() => void act(async () => { onReview(await api.request({ action: 'reviewInstalled', actionId: receipt.actionId, explicitUserAction: true }) as Parameters<typeof onReview>[0]); })}>{choose('Review installed files before configuring', 'Проверить установленные файлы')}</Button><Button disabled={locked} onClick={() => void act(async () => { setReceipt(await api.request({ action: 'uninstallManaged', actionId: receipt.actionId, explicitUserAction: true }) as ManagedInstallReceipt); await refresh(); })}>{choose('Disable and archive owned package runtime', 'Выключить и архивировать свой runtime пакета')}</Button></> : null}
      {['preparing', 'prepared', 'installing', 'failed', 'cancelled'].includes(receipt.state) ? <Button disabled={locked} onClick={() => void act(async () => { setReceipt(await api.request({ action: 'cancelInstall', actionId: receipt.actionId, explicitUserAction: true }) as ManagedInstallReceipt); await refresh(); })}>{choose('Cancel owned work and archive staging', 'Остановить свою операцию и архивировать staging')}</Button> : null}
      {receipt.state === 'outcome_unknown' ? <Notice tone="warning">{choose('The prior owner or final receipt is unestablished. No automatic replay is allowed. Retained staging/runtime needs reconciliation.', 'Предыдущий владелец или итоговая квитанция не установлены. Автоматический повтор запрещён. Сохранённые staging/runtime требуют сверки.')}</Notice> : null}
    </div> : null}
  </Panel>;
}
