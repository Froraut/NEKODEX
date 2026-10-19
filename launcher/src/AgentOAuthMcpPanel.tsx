import { useEffect, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack, Select } from './design';
import { stripIpcErrorPrefix } from './ipc-error';
import type { Language } from './types';

export interface OAuthMcpScope { taskId: string; generation: number; toolCallId: string }
export interface OAuthMcpPin {
  providerId: string; resource: string; endpoint: string; issuer: string; clientId: string;
  metadataDigest: string; accountId: string; epoch: string; serverId: string;
}
export interface OAuthMcpStatus {
  closed?: boolean; unavailable?: boolean;
  providers: Array<Omit<OAuthMcpPin, 'endpoint'> & { label: string }>;
  bindings: Array<{ scope: OAuthMcpScope; pin: OAuthMcpPin; binding: string }>;
  receipts: Array<{ binding: string; providerId: string; serverId: string; stopped: boolean; activeCount: number;
    receiptCount: number; heldUnknownCount: number; ownerHeld: boolean; ownerCurrent?: boolean;
    receipts: Array<{ invocationHash: string; tool: string; state: 'completed' | 'failed' | 'outcome_unknown'; createdAt: number; updatedAt: number }> }>;
}
export interface OAuthMcpReview {
  reviewId: string; reviewDigest: string; pin: OAuthMcpPin; scope: OAuthMcpScope;
  toolApprovalRequired: true; authorizationStarted: false;
}
export type OAuthMcpRequest = { action: 'oauthMcpStatus' }
  | { action: 'oauthMcpReview'; providerId: string; scope: OAuthMcpScope; explicitUserAction: true }
  | { action: 'oauthMcpAttach'; reviewId: string; reviewDigest: string; explicitUserAction: true }
  | { action: 'oauthMcpDisconnect'; scope: OAuthMcpScope; explicitUserAction: true };
export type OAuthMcpResponse = OAuthMcpStatus | OAuthMcpReview;
export type OAuthMcpTransport = (body: OAuthMcpRequest) => Promise<OAuthMcpResponse>;
const sameScope = (a: OAuthMcpScope, b: OAuthMcpScope) => a.taskId === b.taskId && a.generation === b.generation && a.toolCallId === b.toolCallId;
export interface OAuthMcpTaskConnection {
  accountScopeKey: string; refreshRevision: number; taskId: string; generation: number;
  bindings: Array<{ binding: string; serverId: string }>;
}
/** Presentation availability only. Main still validates the exact binding and saved call. */
export function oauthMcpTaskConnection(status: OAuthMcpStatus | null, scope: OAuthMcpScope | undefined, accountScopeKey: string, refreshRevision = 0): OAuthMcpTaskConnection | null {
  if (!status || status.closed !== false || status.unavailable !== false || !scope || !accountScopeKey) return null;
  let account: unknown;
  try { account = JSON.parse(accountScopeKey); } catch { return null; }
  if (!Array.isArray(account) || account.length !== 2 || typeof account[0] !== 'string') return null;
  const pinKeys = ['providerId', 'resource', 'issuer', 'clientId', 'metadataDigest', 'accountId', 'epoch', 'serverId'] as const;
  const bindings = status.bindings.filter(row => row?.scope?.taskId === scope.taskId && row.scope.generation === scope.generation
    && /^[a-f0-9]{64}$/.test(row.binding) && row.pin?.serverId === 'oauth_mcp_tools'
    && row.pin.accountId === account[0] && String(row.pin.epoch) === String(account[1])
    && status.providers.some(provider => pinKeys.every(key => provider?.[key] === row.pin[key]))
    && status.receipts.some(receipt => receipt?.binding === row.binding && receipt.providerId === row.pin.providerId
      && receipt.serverId === row.pin.serverId && receipt.stopped === false && (receipt.ownerHeld === false || receipt.ownerCurrent === true)
      && receipt.activeCount === 0 && receipt.heldUnknownCount === 0))
    .map(row => ({ binding: row.binding, serverId: row.pin.serverId }));
  return bindings.length ? { accountScopeKey, refreshRevision, taskId: scope.taskId, generation: scope.generation, bindings } : null;
}
export function oauthMcpCallMatches(connection: OAuthMcpTaskConnection | null, call: { tool: string; arguments: Record<string, unknown> } | undefined): boolean {
  return !!call && !!connection?.bindings.some(binding => binding.binding === call.arguments.binding
    && call.tool.startsWith(`${binding.serverId}/${binding.binding.slice(0, 16)}__`));
}
export function oauthMcpConnectionMatches(connection: OAuthMcpTaskConnection | null, scope: Pick<OAuthMcpScope, 'taskId' | 'generation'> | undefined, accountScopeKey: string, refreshRevision: number): boolean {
  return !!scope && !!connection && connection.accountScopeKey === accountScopeKey && connection.refreshRevision === refreshRevision
    && connection.taskId === scope.taskId && connection.generation === scope.generation;
}

/** Presents only public registration pins and task attachments. The main owner
 * resolves protected authorization; each actual tool call needs its own approval. */
export function AgentOAuthMcpPanel({ request, scope, accountScopeKey = '', refreshRevision = 0, language, disabled = false, onConnectionChange }: {
  request?: OAuthMcpTransport; scope?: OAuthMcpScope; accountScopeKey?: string; language: Language; disabled?: boolean;
  refreshRevision?: number;
  onConnectionChange?: (connection: OAuthMcpTaskConnection | null) => void;
}) {
  const ru = language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(request); transport.current = request;
  const connectionChange = useRef(onConnectionChange); connectionChange.current = onConnectionChange;
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0);
  const scopeKey = JSON.stringify([accountScopeKey, scope ?? null, refreshRevision]);
  const selectedScope = useRef(scopeKey); selectedScope.current = scopeKey;
  const [snapshot, setSnapshot] = useState<{ scopeKey: string; status: OAuthMcpStatus } | null>(null);
  const status = snapshot?.scopeKey === scopeKey ? snapshot.status : null;
  const [review, setReview] = useState<OAuthMcpReview | null>(null);
  const [provider, setProvider] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerId = status?.providers.some(row => row.providerId === provider) ? provider : status?.providers[0]?.providerId ?? '';
  const locked = disabled || busy || !request;
  async function load() {
    connectionChange.current?.(null);
    if (!transport.current) { if (mounted.current) setSnapshot(null); return; }
    const revision = ++sequence.current;
    const requestedScope = selectedScope.current;
    if (mounted.current) setSnapshot(null);
    try {
      const result = await transport.current({ action: 'oauthMcpStatus' });
      if (!('providers' in result) || !Array.isArray(result.providers) || !Array.isArray(result.bindings) || !Array.isArray(result.receipts)) throw new Error(t('OAuth MCP status is unavailable.', 'Состояние OAuth MCP недоступно.'));
      if (mounted.current && revision === sequence.current && requestedScope === selectedScope.current) setSnapshot({ scopeKey: requestedScope, status: result });
    } catch (reason) {
      if (mounted.current && revision === sequence.current && requestedScope === selectedScope.current) { setSnapshot(null); connectionChange.current?.(null); }
      throw reason;
    }
  }
  async function act(body: OAuthMcpRequest) {
    if (!transport.current || inFlight.current || !['oauthMcpStatus', 'oauthMcpDisconnect'].includes(body.action) && disabled) return;
    const currentScope = selectedScope.current;
    inFlight.current = true; setBusy(true); setError(null);
    if (body.action === 'oauthMcpAttach' || body.action === 'oauthMcpDisconnect') { ++sequence.current; setSnapshot(null); connectionChange.current?.(null); }
    if (body.action !== 'oauthMcpStatus') { setReview(null); setAcknowledged(false); }
    try {
      if (body.action === 'oauthMcpStatus') await load();
      else {
        const result = await transport.current(body);
        if (body.action === 'oauthMcpReview' && 'reviewId' in result && mounted.current && selectedScope.current === currentScope) setReview(result);
        await load();
      }
    } catch (reason) {
      if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason)));
      // A lost response may follow a commit. Read status, never replay attachment.
      if (body.action !== 'oauthMcpStatus') try { await load(); } catch { /* Retain the original error. */ }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    setSnapshot(null); setError(null);
    void load().catch(reason => { if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason))); });
    return () => { mounted.current = false; ++sequence.current; connectionChange.current?.(null); };
  }, [scopeKey, Boolean(request)]);
  useEffect(() => { setReview(null); setAcknowledged(false); }, [scopeKey]);
  useEffect(() => { onConnectionChange?.(request ? oauthMcpTaskConnection(status, scope, accountScopeKey, refreshRevision) : null); }, [status, scopeKey, Boolean(request), onConnectionChange]);
  const currentReview = review && scope && sameScope(review.scope, scope) && review.pin.providerId === providerId ? review : null;
  return <Panel title={t('OAuth MCP task connection', 'Подключение OAuth MCP к задаче')}>
    <PanelStack className="agent-tools-panel-body">
      <p>{t('Attach a reviewed registered provider to the selected task generation. Sign-in and provider consent remain in the authorization panel. Connecting does not approve any tool call.', 'Подключите проверенного зарегистрированного провайдера к выбранному поколению задачи. Вход и согласие провайдеру выполняются в панели авторизации. Подключение не подтверждает вызовы инструментов.')}</p>
      {!request ? <Notice>{t('OAuth MCP transport is unavailable in this session.', 'Транспорт OAuth MCP недоступен в этой сессии.')}</Notice> : null}
      {error ? <Notice tone="warning">{error} {t('Inspect connection status before another action; the previous action is never replayed automatically.', 'Проверьте состояние подключения перед следующим действием; предыдущее действие не повторяется автоматически.')}</Notice> : null}
      {request && !status && !error ? <p role="status">{t('Reading public connection metadata…', 'Загрузка публичных метаданных подключения…')}</p> : null}
      {status && !status.providers.length ? <Notice>{t('No reviewed OAuth MCP provider is configured for the current account. Register a public provider and authorize it above.', 'Для текущего аккаунта не настроен проверенный OAuth MCP провайдер. Зарегистрируйте публичного провайдера и авторизуйте его выше.')}</Notice> : null}
      {!scope ? <p>{t('Select an open Agent task below to review a connection.', 'Выберите ниже открытую Agent-задачу для проверки подключения.')}</p> : <>
        <p><code>{scope.taskId}</code> · {t('generation', 'поколение')} {scope.generation}</p>
        <Select label={t('Registered provider', 'Зарегистрированный провайдер')} value={providerId} disabled={locked || !status?.providers.length}
          onChange={value => { setProvider(value); setReview(null); setAcknowledged(false); }} options={status?.providers.length ? status.providers.map(row => ({ value: row.providerId, label: row.label })) : [{ value: '', label: t('No provider available', 'Нет доступного провайдера') }]} />
        <Button className="agent-tools-button" disabled={locked || !providerId} onClick={() => void act({ action: 'oauthMcpReview', providerId, scope, explicitUserAction: true })}>{t('Review exact task connection', 'Проверить точное подключение к задаче')}</Button>
        {currentReview ? <PanelStack className="agent-tools-card">
          <strong>{t('Review before connecting', 'Проверка перед подключением')}</strong>
          <p>{t('Provider', 'Провайдер')}: <code>{currentReview.pin.providerId}</code><br />{t('Resource', 'Ресурс')}: <code>{currentReview.pin.resource}</code><br />{t('Endpoint', 'Адрес MCP')}: <code>{currentReview.pin.endpoint}</code><br />{t('Issuer', 'Издатель')}: <code>{currentReview.pin.issuer}</code></p>
          <p>{t('Public client ID', 'Публичный ID клиента')}: <code>{currentReview.pin.clientId}</code><br />{t('Account', 'Аккаунт')}: <code>{currentReview.pin.accountId}</code><br />{t('Account epoch', 'Поколение аккаунта')}: <code>{currentReview.pin.epoch}</code></p>
          <p>{t('Metadata SHA-256', 'SHA-256 метаданных')}: <code>{currentReview.pin.metadataDigest}</code><br />{t('Review SHA-256', 'SHA-256 проверки')}: <code>{currentReview.reviewDigest}</code></p>
          <Checkbox checked={acknowledged} disabled={locked} onChange={setAcknowledged} label={t('I reviewed this provider, resource, account and task generation. I allow this exact connection; tool calls still need separate approval.', 'Я проверил провайдера, ресурс, аккаунт и поколение задачи. Разрешаю это точное подключение; вызовы инструментов потребуют отдельного подтверждения.')} />
          <Button className="agent-tools-button" disabled={locked || !acknowledged || currentReview.toolApprovalRequired !== true || currentReview.authorizationStarted !== false} onClick={() => void act({ action: 'oauthMcpAttach', reviewId: currentReview.reviewId, reviewDigest: currentReview.reviewDigest, explicitUserAction: true })}>{t('Connect reviewed provider', 'Подключить проверенного провайдера')}</Button>
        </PanelStack> : null}
      </>}
      {status?.bindings.map(binding => <PanelStack className="agent-tools-card" key={`${binding.binding}:${binding.scope.taskId}:${binding.scope.generation}`}>
          <BadgeRow><Badge>{t('Task attachment recorded', 'Подключение к задаче сохранено')}</Badge><code>{binding.pin.providerId}</code></BadgeRow>
          <p><code>{binding.scope.taskId}</code> · {t('generation', 'поколение')} {binding.scope.generation}<br /><code>{binding.pin.resource}</code><br />{t('Binding SHA-256', 'SHA-256 привязки')}: <code>{binding.binding}</code></p>
          <Notice>{t('The attachment is not a successful discovery or tool result. Use the existing discovery and exact pending-call approval flow below.', 'Сохранённая привязка не подтверждает поиск инструментов или их результат. Используйте ниже существующий поиск и подтверждение точного ожидающего вызова.')}</Notice>
          <Button className="agent-tools-button" disabled={busy || !request} onClick={() => void act({ action: 'oauthMcpDisconnect', scope: binding.scope, explicitUserAction: true })}>{t('Disconnect this task connection', 'Отключить эту привязку задачи')}</Button>
        </PanelStack>)}
      {status?.receipts.length ? <details open={status.receipts.some(row => row.heldUnknownCount > 0 || row.ownerHeld)}>
        <summary>{t('Retained connection receipts', 'Сохранённые квитанции подключений')}</summary>
        <ul className="agent-tools-records">{status.receipts.map(row => <li key={row.binding}>
          <strong>{row.providerId}</strong><code>{row.serverId}</code>
          <p>{t('Active operations', 'Активные операции')}: {row.activeCount} · {t('Receipts', 'Квитанции')}: {row.receiptCount} · {t('Unknown outcomes held', 'Удерживаемые неопределённые исходы')}: {row.heldUnknownCount}</p>
          <BadgeRow><Badge>{row.stopped ? t('Transport stopped', 'Транспорт остановлен') : t('Transport recorded', 'Транспорт сохранён')}</Badge>{row.ownerHeld ? <Badge tone="warning">{t('Owner retained', 'Владелец удерживается')}</Badge> : null}</BadgeRow>
          {row.heldUnknownCount > 0 ? <Notice tone="warning">{t('Unknown outcomes remain held. This panel cannot replay them or treat connection status as a completed result.', 'Неопределённые исходы остаются удержанными. Эта панель не повторяет их и не считает состояние подключения завершённым результатом.')}</Notice> : null}
          {row.receipts.map(receipt => <p key={receipt.invocationHash}><code>{receipt.tool}</code> · {receipt.state}</p>)}
        </li>)}</ul>
      </details> : null}
      {request ? <Button className="agent-tools-button" disabled={busy} busy={busy} onClick={() => void act({ action: 'oauthMcpStatus' })}>{t('Inspect connection status', 'Проверить состояние подключения')}</Button> : null}
    </PanelStack>
  </Panel>;
}
