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
  providers: Array<Omit<OAuthMcpPin, 'endpoint'> & { label: string }>;
  bindings: Array<{ scope: OAuthMcpScope; pin: OAuthMcpPin; binding: string }>;
  receipts: Array<{ binding: string; providerId: string; serverId: string; stopped: boolean; activeCount: number;
    receiptCount: number; heldUnknownCount: number; ownerHeld: boolean;
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

/** Presents only public registration pins and task attachments. The main owner
 * resolves protected authorization; each actual tool call needs its own approval. */
export function AgentOAuthMcpPanel({ request, scope, accountScopeKey = '', language, disabled = false }: {
  request?: OAuthMcpTransport; scope?: OAuthMcpScope; accountScopeKey?: string; language: Language; disabled?: boolean;
}) {
  const ru = language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(request); transport.current = request;
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0);
  const scopeKey = JSON.stringify([accountScopeKey, scope ?? null]);
  const selectedScope = useRef(scopeKey); selectedScope.current = scopeKey;
  const [status, setStatus] = useState<OAuthMcpStatus | null>(null);
  const [review, setReview] = useState<OAuthMcpReview | null>(null);
  const [provider, setProvider] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerId = status?.providers.some(row => row.providerId === provider) ? provider : status?.providers[0]?.providerId ?? '';
  const locked = disabled || busy || !request;
  async function load() {
    if (!transport.current) return;
    const revision = ++sequence.current;
    const result = await transport.current({ action: 'oauthMcpStatus' });
    if (!('providers' in result) || !Array.isArray(result.providers) || !Array.isArray(result.bindings)) throw new Error(t('OAuth MCP status is unavailable.', 'Состояние OAuth MCP недоступно.'));
    if (mounted.current && revision === sequence.current) setStatus(result);
  }
  async function act(body: OAuthMcpRequest) {
    if (!transport.current || inFlight.current || !['oauthMcpStatus', 'oauthMcpDisconnect'].includes(body.action) && disabled) return;
    const currentScope = selectedScope.current;
    inFlight.current = true; setBusy(true); setError(null);
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
    setStatus(null); setError(null);
    void load().catch(reason => { if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason))); });
    return () => { mounted.current = false; ++sequence.current; };
  }, [accountScopeKey]);
  useEffect(() => { setReview(null); setAcknowledged(false); }, [scopeKey]);
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
