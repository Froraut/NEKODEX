import { useEffect, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack } from './design';
import type { AgentOAuthPanelPort, OAuthProviderStatus, OAuthProviderRegistrationReview } from '../../src/agent-tools/oauth-types';

/** Status-only interface: no token fields, callback URL paste box or generic network endpoint. */
export function AgentOAuthPanel({ api, scopeKey, choose, locked = false }: {
  api?: AgentOAuthPanelPort;
  scopeKey: string;
  choose: (en: string, ru: string) => string;
  locked?: boolean;
}) {
  const [rows, setRows] = useState<OAuthProviderStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [review, setReview] = useState<OAuthProviderRegistrationReview | null>(null);
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const generation = useRef(0), owned = useRef(false);
  useEffect(() => {
    const epoch = ++generation.current;
    setRows([]); setError(false); setBusy(false); setReview(null); setRegistrationConsent(false); owned.current = false;
    if (api) void api.list().then(value => { if (generation.current === epoch) setRows(value); }, () => { if (generation.current === epoch) setError(true); });
    return () => { generation.current++; };
  }, [api, scopeKey]);
  const act = async (operation: () => Promise<unknown>) => {
    if (owned.current || !api) return;
    const epoch = generation.current; owned.current = true; setBusy(true); setError(false);
    try {
      await operation(); const value = await api.list();
      if (generation.current === epoch) setRows(value);
    } catch {
      if (generation.current === epoch) {
        setError(true);
        try { const value = await api.list(); if (generation.current === epoch) setRows(value); } catch { /* Keep last safe status. */ }
      }
    } finally { if (generation.current === epoch) { owned.current = false; setBusy(false); } }
  };
  return <Panel title={choose('MCP provider authorization', 'Авторизация MCP-провайдеров')}>
    <PanelStack className="agent-tools-panel-body">
    <p>{choose('Choose a configured provider to open its sign-in and consent page. Credentials stay in protected storage. Resource authorization and approval of each tool call are separate.', 'Выберите настроенного провайдера для входа и согласия в браузере. Учётные данные остаются в защищённом хранилище. Доступ к ресурсу и подтверждение каждого вызова инструмента — отдельные действия.')}</p>
    {!api ? <Notice>{choose('The protected OAuth service is unavailable in this session.', 'Защищённый сервис OAuth недоступен в этой сессии.')}</Notice> : null}
    {api && !rows.length ? <Notice>{choose('No provider with validated OAuth metadata and an explicitly registered client is configured.', 'Нет провайдеров с проверенными метаданными OAuth и явно зарегистрированным клиентом.')}</Notice> : null}
    {api?.pickProvider ? <Button className="agent-tools-button" disabled={busy || locked} onClick={() => void act(async () => {
      const epoch = generation.current;
      const selection = await api.pickProvider!();
      if (generation.current === epoch && !selection.cancelled && selection.review) { setReview(selection.review); setRegistrationConsent(false); }
    })}>{choose('Review a public provider registration file', 'Проверить файл публичной регистрации провайдера')}</Button> : null}
    {review ? <PanelStack className="agent-tools-card">
      <strong>{choose('Review exact provider registration', 'Проверка регистрации провайдера')}: {review.label}</strong>
      <p>{choose('Issuer', 'Издатель')}: <code>{review.issuer}</code></p>
      <p>{choose('Resource', 'Ресурс')}: <code>{review.resource}</code></p>
      <p>{choose('Public client ID', 'Публичный ID клиента')}: <code>{review.clientId}</code></p>
      <p>{choose('Requested scopes', 'Запрашиваемые разрешения')}: {review.scopes.join(', ') || choose('Provider default', 'По умолчанию провайдера')}</p>
      <p>{choose('Authorization endpoint', 'Адрес авторизации')}: <code>{review.authorizationEndpoint}</code></p>
      <p>{choose('Token endpoint', 'Адрес обмена токенов')}: <code>{review.tokenEndpoint}</code></p>
      {review.revocationEndpoint ? <p>{choose('Revocation endpoint', 'Адрес отзыва')}: <code>{review.revocationEndpoint}</code></p> : null}
      <p>{choose('Provider registration evidence', 'Источник регистрации')}: <code>{review.registrationEvidenceUrl}</code></p>
      <p>{choose('Validated metadata digest', 'Хеш проверенных метаданных')}: <code>{review.metadataDigest}</code></p>
      <Notice>{choose('The provider metadata was checked. The client ID comes from your selected registration file; only provider sign-in can verify its acceptance. Registration does not start sign-in or approve tool calls.', 'Метаданные провайдера проверены. ID клиента указан в выбранном вами файле; его принятие проверяется только при авторизации у провайдера. Сохранение регистрации не запускает вход и не подтверждает вызовы инструментов.')}</Notice>
      <Checkbox checked={registrationConsent} onChange={setRegistrationConsent} label={choose('I selected this public client registration and these exact endpoints and scopes for the current account.', 'Я выбрал эту публичную регистрацию клиента, эти адреса и разрешения для текущего аккаунта.')} />
      <Button className="agent-tools-button" disabled={busy || locked || !registrationConsent || !api?.registerProvider || review.state !== 'reviewed'} onClick={() => void act(async () => {
        const epoch = generation.current;
        const result = await api!.registerProvider!({ reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true });
        if (generation.current === epoch) { setReview(result); setRegistrationConsent(false); }
      })}>{choose('Save this reviewed provider registration', 'Сохранить проверенную регистрацию')}</Button>
    </PanelStack> : null}
    {error ? <Notice tone="warning">{choose('Authorization did not complete. Inspect the provider status before another action. A pending refresh or revocation may have an unknown remote outcome.', 'Авторизация не завершена. Проверьте состояние перед следующим действием. У ожидающих обновления или отзыва возможен неизвестный удалённый исход.')}</Notice> : null}
    {rows.map(row => {
      const input = { providerId: row.providerId, explicitUserAction: true as const };
      const blocked = locked || busy || row.state === 'unavailable';
      const unsettled = row.state === 'refresh_pending' || row.state === 'revocation_pending';
      return <PanelStack className="agent-tools-card" key={row.providerId}>
        <BadgeRow><strong>{row.label}</strong> <Badge tone={row.state === 'connected' ? 'success' : 'neutral'}>{row.state}</Badge></BadgeRow>
        <p>{choose('Resource', 'Ресурс')}: <code>{row.resource}</code></p>
        <p>{choose('Issuer', 'Издатель')}: <code>{row.issuer}</code></p>
        <p>{choose('Requested scopes', 'Запрашиваемые разрешения')}: {row.scopes.join(', ') || choose('Provider default', 'По умолчанию провайдера')}</p>
        {row.reason ? <Notice>{row.reason}</Notice> : null}
        {unsettled ? <Notice tone="warning">{choose('A protected pending operation is retained. Automatic replay and tool access are blocked; reconcile the provider outcome before replacing credentials.', 'Сохранена защищённая ожидающая операция. Автоповтор и доступ инструментов заблокированы; сверка удалённого исхода требуется до замены учётных данных.')}</Notice> : null}
        <div className="agent-tools-state">
          <Button className="agent-tools-button" disabled={blocked || unsettled || row.state === 'authorization_pending'} onClick={() => void act(() => api!.begin(input))}>{choose('Authorize in browser', 'Авторизовать в браузере')}</Button>
          {row.state === 'authorization_pending' ? <Button className="agent-tools-button" disabled={blocked} onClick={() => void act(() => api!.cancel(input))}>{choose('Cancel pending authorization', 'Отменить ожидающую авторизацию')}</Button> : null}
          <Button className="agent-tools-button" disabled={blocked || !row.canRefresh || unsettled || row.state === 'authorization_pending'} onClick={() => void act(() => api!.refresh(input))}>{choose('Refresh authorization', 'Обновить авторизацию')}</Button>
          <Button className="agent-tools-button" disabled={blocked || !row.canRevoke || unsettled || row.state === 'authorization_pending'} onClick={() => void act(() => api!.revoke(input))}>{choose('Revoke provider access', 'Отозвать доступ у провайдера')}</Button>
        </div>
      </PanelStack>;
    })}
    {api ? <Button className="agent-tools-button" disabled={busy} onClick={() => void act(() => Promise.resolve())}>{choose('Inspect authorization status', 'Проверить состояние авторизации')}</Button> : null}
    </PanelStack>
  </Panel>;
}
