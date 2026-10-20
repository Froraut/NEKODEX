import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack, TextField } from './design';
import type { AgentToolsApi, AgentToolsStatus, AgentVmNetworkStatus, ToolScope, VmNetworkGrant, VmNetworkGrantInput } from './agent-tools-types';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/agent-host-network.css';

type Destination = { key: string; origin: string; addresses: string; methods: string[] };
type Review = { input: VmNetworkGrantInput; runtimeDigest: string; context: string };
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
// Core exposes these only after proving the failing grant call added no grant.
const PRE_GRANT_REFUSALS = new Set(['vm-network-destination-invalid', 'vm-network-origin-invalid', 'vm-network-limits-invalid', 'vm-network-address-mismatch', 'vm-network-url-invalid']);
const blankDestination = (): Destination => ({ key: crypto.randomUUID(), origin: '', addresses: '', methods: ['GET'] });
const inputKey = (value: VmNetworkGrantInput) => JSON.stringify({ scope: value.scope, destinations: value.destinations,
  credentialOwner: value.credentialOwner, dns: value.dns, proxy: value.proxy, maxRequests: value.maxRequests,
  maxRequestBytes: value.maxRequestBytes, maxResponseBytes: value.maxResponseBytes, maxRedirects: value.maxRedirects, timeoutMs: value.timeoutMs });
const message = (value: unknown) => stripIpcErrorPrefix(value instanceof Error ? value.message : String(value));

/** Host-broker grants only. This panel sends no HTTP request, resolves no DNS,
 * opens no guest NIC and cannot manufacture a saved model tool call. */
export function AgentHostNetwork({ api, status, scope, taskStatus, locked, choose, act, onChanged }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; scope?: ToolScope; taskStatus?: string; locked: boolean;
  choose: (en: string, ru: string) => string; act: (work: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const transport = useRef(api); transport.current = api;
  const currentScope = useRef(scope); currentScope.current = scope;
  const alive = useRef(false), sequence = useRef(0), granting = useRef(false), reading = useRef(false), revoking = useRef(new Set<string>());
  const runtimeDigest = status?.vmEnvironment?.runtimeDigest ?? '';
  const contextKey = JSON.stringify([scope?.taskId, scope?.generation, runtimeDigest]);
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const [network, setNetwork] = useState<AgentVmNetworkStatus | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>(() => [blankDestination()]);
  const [maxRequests, setMaxRequests] = useState('1'), [requestBytes, setRequestBytes] = useState('65536'), [responseBytes, setResponseBytes] = useState('65536');
  const [redirects, setRedirects] = useState('0'), [timeout, setTimeoutValue] = useState('15000');
  const [review, setReview] = useState<Review | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false), [readingState, setReading] = useState(false), [revokingIds, setRevokingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const uncertain = useRef<Review | null>(null); const [uncertainGrant, setUncertainGrant] = useState<Review | null>(null);
  const fieldPrefix = useId();
  const runtimeReady = status?.vmEnvironment?.supported === true && status.vmEnvironment.prepared === true && Boolean(runtimeDigest);
  const taskReady = Boolean(scope && ['ready', 'running', 'awaiting_input'].includes(taskStatus ?? ''));
  const namespaceConflict = status?.config.servers.some(server => server.id === 'vm-network') === true;
  const controlsLocked = locked || pending || Boolean(uncertainGrant);
  const canReview = taskReady && runtimeReady && network?.available === true && !namespaceConflict && !controlsLocked;

  function resolveUncertain(value: AgentVmNetworkStatus) {
    const held = uncertain.current;
    if (held && value.grants.some(row => inputKey(row.grant) === inputKey(held.input))) {
      uncertain.current = null; setUncertainGrant(null);
      setError(null);
      setNotice(choose('The exact grant was found in current host state. Registration was not repeated. Inspect whether it is active or revoked below.', 'Точное разрешение найдено в текущем состоянии хоста. Выдача разрешения не повторялась. Проверьте ниже, действует оно или отозвано.'));
    }
  }
  function accept(value: AgentVmNetworkStatus, captured: string) {
    if (!value || value.mode !== 'separately-approved-host-broker' || value.guestNic !== false || !Array.isArray(value.grants)) throw new Error(choose('Host network status is unavailable.', 'Состояние сети хоста недоступно.'));
    if (!alive.current || currentContext.current !== captured) return;
    setNetwork(value); resolveUncertain(value);
  }
  async function read() {
    if (reading.current) return;
    const captured = currentContext.current, target = currentScope.current ? { ...currentScope.current } : undefined;
    const revision = ++sequence.current; reading.current = true; setReading(true);
    try {
      const value = await transport.current.request({ action: 'vmNetworkStatus', ...(target ? { scope: target } : {}) }) as AgentVmNetworkStatus;
      if (revision === sequence.current) accept(value, captured);
      const held = uncertain.current;
      if (held && (held.input.scope.taskId !== target?.taskId || held.input.scope.generation !== target?.generation)) {
        const retained = await transport.current.request({ action: 'vmNetworkStatus', scope: { taskId: held.input.scope.taskId,
          generation: held.input.scope.generation, toolCallId: held.input.scope.actionId } }) as AgentVmNetworkStatus;
        if (alive.current && retained?.mode === 'separately-approved-host-broker' && retained.guestNic === false && Array.isArray(retained.grants)) resolveUncertain(retained);
      }
    } catch (cause) { if (alive.current && currentContext.current === captured) setError(message(cause)); }
    finally {
      reading.current = false;
      if (alive.current) { setReading(false); if (currentContext.current !== captured) void read(); }
    }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++sequence.current; }; }, []);
  useEffect(() => { setReview(null); setAcknowledged(false); setNetwork(null); setNotice(null); setError(null); void read(); }, [contextKey]);
  function edit(change: () => void) { change(); setReview(null); setAcknowledged(false); }
  function destinationChange(key: string, change: Partial<Destination>) { edit(() => setDestinations(rows => rows.map(row => row.key === key ? { ...row, ...change } : row))); }
  function reviewGrant() {
    if (!canReview || !scope) return;
    setError(null); setNotice(null); setAcknowledged(false);
    try {
      const selected = destinations.map(row => {
        const origin = row.origin.trim(), addresses = row.addresses.split(/[\s,]+/).filter(Boolean);
        if (origin.length > 8192 || addresses.some(address => address.length > 128)) throw new Error(choose('Keep the origin within 8192 characters and each IP pin within 128 characters.', 'Origin должен содержать не более 8192 символов, каждый IP — не более 128 символов.'));
        let parsed: URL;
        try { parsed = new URL(origin); }
        catch { throw new Error(choose('Enter an exact HTTP(S) origin: scheme, host and optional port, without a path.', 'Укажите точный HTTP(S) origin: схему, хост и при необходимости порт, без пути.')); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password || parsed.hash
          || !addresses.length || addresses.length > 8 || new Set(addresses).size !== addresses.length || !row.methods.length) throw new Error(choose('Use an exact HTTP(S) origin with 1–8 explicit public IP addresses and at least one method.', 'Укажите точный HTTP(S) origin, 1–8 явных публичных IP-адресов и хотя бы один метод.'));
        return { origin, addresses, methods: [...row.methods] };
      });
      const values = [Number(maxRequests), Number(requestBytes), Number(responseBytes), Number(redirects), Number(timeout)];
      const limits = [[1, 100], [1, 16 * 1024 * 1024], [1, 16 * 1024 * 1024], [0, 5], [1, 60000]];
      if (selected.length < 1 || selected.length > 16 || new Set(selected.map(row => row.origin)).size !== selected.length
        || values.some((value, i) => !Number.isSafeInteger(value) || value < limits[i][0] || value > limits[i][1])) throw new Error(choose('Check the destination list and bounded request, byte, redirect and timeout limits.', 'Проверьте список назначений и ограничения запросов, байтов, редиректов и времени.'));
      setReview({ context: contextKey, runtimeDigest, input: { scope: { taskId: scope.taskId, generation: scope.generation, actionId: crypto.randomUUID() }, destinations: selected,
        credentialOwner: 'none', dns: 'pinned-no-lookup', proxy: 'none', maxRequests: values[0], maxRequestBytes: values[1], maxResponseBytes: values[2], maxRedirects: values[3], timeoutMs: values[4] } });
    } catch (cause) { setReview(null); setError(message(cause)); }
  }
  async function grant() {
    const chosen = review;
    if (!chosen || !acknowledged || chosen.context !== currentContext.current || !canReview || granting.current || uncertain.current) return;
    granting.current = true; setPending(true); setError(null); setNotice(null); setAcknowledged(false); setReview(null);
    await act(async () => {
      uncertain.current = chosen; setUncertainGrant(chosen);
      try {
        await transport.current.request({ action: 'grantVmNetwork', input: chosen.input, explicitUserAction: true });
        // Status establishes the exact grant identity; a lost reply never resubmits it.
        await read(); await onChanged().catch(() => {});
      } catch (cause) {
        if (alive.current) {
          const reason = message(cause);
          if (PRE_GRANT_REFUSALS.has(reason)) {
            uncertain.current = null; setUncertainGrant(null);
            setError(choose('The host refused this permission before creating a grant. Check the exact origins, public IP pins and limits, then review the corrected permission.', 'Хост отклонил разрешение до его создания. Проверьте точные origin, публичные IP и лимиты, затем просмотрите исправленное разрешение.'));
          } else setError(reason);
        }
        await read();
      }
      finally { granting.current = false; if (alive.current) setPending(false); }
    });
    // Parent admission can refuse before entering the closure.
    granting.current = false; if (alive.current) setPending(false);
  }
  async function revoke(row: { grant: VmNetworkGrant; revoked: boolean }) {
    if (revoking.current.has(row.grant.id)) return;
    revoking.current.add(row.grant.id); setRevokingIds(ids => [...ids, row.grant.id]); setError(null); setNotice(null);
    try {
      await transport.current.request({ action: 'revokeVmNetwork', scope: { ...row.grant.scope }, grantId: row.grant.id, explicitUserAction: true });
      await read(); await onChanged().catch(() => {});
    } catch (cause) { if (alive.current) setError(message(cause)); await read(); }
    finally { revoking.current.delete(row.grant.id); if (alive.current) setRevokingIds(ids => ids.filter(id => id !== row.grant.id)); }
  }
  function policy(input: VmNetworkGrantInput) {
    return <><ul className="agent-host-network__destinations">{input.destinations.map(row => <li key={row.origin}><code>{row.origin}</code><p>{row.addresses.join(', ')}</p><p>{row.methods.join(', ')}</p></li>)}</ul>
      <dl className="agent-host-network__limits"><dt>{choose('Requests', 'Запросы')}</dt><dd>{input.maxRequests}</dd><dt>{choose('Request byte budget', 'Бюджет байтов запросов')}</dt><dd>{input.maxRequestBytes}</dd><dt>{choose('Response body byte budget', 'Бюджет байтов тела ответов')}</dt><dd>{input.maxResponseBytes}</dd><dt>{choose('Redirects', 'Редиректы')}</dt><dd>{input.maxRedirects}</dd><dt>{choose('Timeout per request', 'Лимит времени запроса')}</dt><dd>{input.timeoutMs} {choose('ms', 'мс')}</dd></dl></>;
  }
  return <Panel title={choose('Host network permissions', 'Разрешения сети хоста')} className="agent-host-network"><PanelStack>
    <BadgeRow><Badge>{choose('Guest VM remains offline', 'Гостевая VM остаётся без сети')}</Badge><Badge>{choose('Pinned IP · no DNS lookup', 'Фиксированный IP · без DNS lookup')}</Badge></BadgeRow>
    <p>{choose('Review a bounded host-broker permission for this task generation. It grants no credentials, cookies or proxy access. Granting permission sends no request; each exact saved vm-network/request call still needs separate tool approval above.', 'Проверьте ограниченное разрешение host-broker для этого поколения задачи. Оно не предоставляет credentials, cookies или доступ к proxy. Выдача разрешения не отправляет запрос; каждый точный сохранённый вызов vm-network/request по-прежнему требует отдельного подтверждения инструмента выше.')}</p>
    <div className="agent-host-network__actions"><Button disabled={readingState} busy={readingState} onClick={() => void read()}>{choose('Inspect host network state', 'Проверить состояние сети хоста')}</Button></div>
    {error ? <Notice tone="error">{error} {choose('Inspect state before another action. No request or grant is replayed automatically.', 'Перед следующим действием проверьте состояние. Запросы и разрешения автоматически не повторяются.')}</Notice> : null}
    {notice ? <Notice>{notice}</Notice> : null}
    {uncertainGrant ? <Notice tone="warning">{choose('The outcome of this exact grant is not confirmed. Inspect state; another grant is held until this identity is found. This does not establish that any HTTP request was sent.', 'Исход выдачи этого точного разрешения не подтверждён. Проверьте состояние; новое разрешение заблокировано до обнаружения этого идентификатора. Это не подтверждает отправку HTTP-запроса.')} <code>{uncertainGrant.input.scope.actionId}</code></Notice> : null}
    {!taskReady ? <Notice>{choose('Select an active owned task to review a new permission. Retained grants can still be inspected and revoked.', 'Для проверки нового разрешения выберите активную задачу. Сохранённые разрешения можно просмотреть и отозвать.')}</Notice> : null}
    {!runtimeReady ? <Notice>{choose('Prepare the reviewed VM runtime before granting network permissions. This panel does not prepare it or enable guest networking.', 'Перед выдачей сетевых разрешений подготовьте просмотренный VM runtime. Эта панель не подготавливает его и не включает сеть гостевой VM.')}</Notice> : null}
    {namespaceConflict ? <Notice tone="warning">{choose('An existing configured server uses the vm-network namespace. Resolve that configuration conflict before granting a built-in host permission.', 'Уже настроенный сервер использует имя vm-network. Устраните конфликт этой настройки перед выдачей встроенного разрешения хоста.')}</Notice> : null}
    {scope ? <p className="agent-host-network__identity">{scope.taskId} · gen {scope.generation}</p> : null}
    <fieldset disabled={!canReview}><legend>{choose('Exact public destinations', 'Точные публичные назначения')}</legend>
      <p>{choose('An origin is the scheme, host and optional port, without a path. Paths under that origin remain subject to the separate exact tool-call approval.', 'Origin — это схема, хост и при необходимости порт, без пути. Обращение к путям этого origin по-прежнему требует отдельного подтверждения точного вызова инструмента.')}</p>
      {destinations.map((row, index) => <div className="agent-host-network__destination" key={row.key}>
        <TextField label={`${choose('Origin', 'Origin')} ${index + 1}`} value={row.origin} maxLength={8192} placeholder="https://service.example" onChange={event => destinationChange(row.key, { origin: event.target.value })} />
        <div className="nk-field"><label htmlFor={`${fieldPrefix}-${row.key}`}>{choose('Public IP pins (one per line, maximum 8)', 'Публичные IP (по одному в строке, максимум 8)')}</label><textarea id={`${fieldPrefix}-${row.key}`} className="nk-input" rows={2} value={row.addresses} maxLength={1024} onChange={event => destinationChange(row.key, { addresses: event.target.value })} /></div>
        <p>{choose('Enter explicit public IPv4/IPv6 addresses. No address is looked up or inferred; the host validates the pins at approval.', 'Укажите явные публичные IPv4/IPv6-адреса. Адреса не ищутся и не выводятся автоматически; хост проверит их при подтверждении.')}</p>
        <div className="agent-host-network__methods" role="group" aria-label={choose('Allowed HTTP methods', 'Разрешённые HTTP-методы')}>{METHODS.map(method => <Checkbox key={method} label={method} checked={row.methods.includes(method)} onChange={value => destinationChange(row.key, { methods: value ? [...row.methods, method] : row.methods.filter(item => item !== method) })} />)}</div>
        <Button disabled={destinations.length === 1} onClick={() => edit(() => setDestinations(rows => rows.filter(item => item.key !== row.key)))}>{choose('Remove destination', 'Удалить назначение')}</Button>
      </div>)}
      <Button disabled={destinations.length >= 16} onClick={() => edit(() => setDestinations(rows => [...rows, blankDestination()]))}>{choose('Add destination', 'Добавить назначение')}</Button>
      <div className="agent-host-network__fields"><TextField type="number" min={1} max={100} label={choose('Maximum requests (1–100)', 'Максимум запросов (1–100)')} value={maxRequests} onChange={event => edit(() => setMaxRequests(event.target.value))} />
        <TextField type="number" min={1} max={16777216} label={choose('Total request bytes (1–16 MiB)', 'Всего байтов запросов (1–16 МиБ)')} value={requestBytes} onChange={event => edit(() => setRequestBytes(event.target.value))} />
        <TextField type="number" min={1} max={16777216} label={choose('Total response body bytes (1–16 MiB)', 'Всего байтов тела ответов (1–16 МиБ)')} value={responseBytes} onChange={event => edit(() => setResponseBytes(event.target.value))} />
        <TextField type="number" min={0} max={5} label={choose('Maximum redirects (0–5)', 'Максимум редиректов (0–5)')} value={redirects} onChange={event => edit(() => setRedirects(event.target.value))} />
        <TextField type="number" min={1} max={60000} label={choose('Request timeout, ms (1–60000)', 'Время запроса, мс (1–60000)')} value={timeout} onChange={event => edit(() => setTimeoutValue(event.target.value))} /></div>
    </fieldset>
    <div className="agent-host-network__actions"><Button disabled={!canReview} onClick={reviewGrant}>{choose('Review exact host permission', 'Проверить точное разрешение хоста')}</Button></div>
    {review && review.context === contextKey ? <section className="agent-host-network__card"><h4>{choose('Review before granting', 'Проверка перед выдачей разрешения')}</h4>
      <p className="agent-host-network__identity">{review.input.scope.taskId} · gen {review.input.scope.generation}<br />{choose('Action', 'Действие')}: {review.input.scope.actionId}<br />VM SHA-256: {review.runtimeDigest}</p>
      {policy(review.input)}<Notice>{choose('Credentials: none. DNS: pinned, no lookup. Proxy: none. Request bytes include generated headers and redirect hops. This is a permission review, not a connection test or a tool-call approval.', 'Credentials: нет. DNS: фиксированные IP, без lookup. Proxy: нет. Байты запросов включают создаваемые заголовки и переходы редиректов. Это проверка разрешения, а не тест соединения или подтверждение вызова инструмента.')}</Notice>
      <Checkbox checked={acknowledged} disabled={controlsLocked || !taskReady || !runtimeReady} onChange={setAcknowledged} label={choose('I reviewed this exact task generation, runtime, origins, pinned IPs, methods and limits. Allow this bounded host permission; keep the guest VM offline.', 'Я проверил это поколение задачи, runtime, origin, фиксированные IP, методы и лимиты. Разрешаю этот ограниченный доступ хоста; гостевая VM остаётся без сети.')} />
      <Button variant="primary" disabled={!acknowledged || !canReview} busy={pending} onClick={() => void grant()}>{choose('Grant reviewed host permission', 'Выдать проверенное разрешение хоста')}</Button>
    </section> : null}
    {network ? <p>{choose('Active host operations across all tasks', 'Активные операции хоста во всех задачах')}: {network.activeCount} · {choose('Retained grants in this view', 'Сохранённые разрешения в этой выборке')}: {network.grants.length}</p> : null}
    {network?.grants.map(row => <section className="agent-host-network__card" key={row.grant.id}><BadgeRow><Badge tone={row.revoked ? 'neutral' : 'success'}>{row.revoked ? choose('Revoked', 'Отозвано') : choose('Granted', 'Выдано')}</Badge><code>{row.grant.id}</code></BadgeRow>
      <p className="agent-host-network__identity">{row.grant.scope.taskId} · gen {row.grant.scope.generation}<br />{choose('Action', 'Действие')}: {row.grant.scope.actionId}</p>{policy(row.grant)}
      <p>{choose('These are the original grant limits, not a remaining-budget claim. Request outcomes and exact unknown receipts are inspected in the saved tool-call receipts above. Revocation retires permission and requests cancellation; it cannot roll back external effects.', 'Это исходные лимиты разрешения, а не остаток бюджета. Исходы запросов и точные неопределённые квитанции проверяются выше в сохранённых квитанциях вызовов. Отзыв прекращает действие разрешения и запрашивает отмену; он не откатывает внешние эффекты.')}</p>
      {!row.revoked ? <Button disabled={revokingIds.includes(row.grant.id)} busy={revokingIds.includes(row.grant.id)} onClick={() => void revoke(row)}>{choose('Revoke this host permission', 'Отозвать это разрешение хоста')}</Button> : null}
    </section>)}
  </PanelStack></Panel>;
}
