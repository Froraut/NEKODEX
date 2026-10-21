import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Notice } from './design';
import type { Language } from './types';
import type { NativeAccountsApi, NativeAccountsSnapshot, NativeInventoryRequest } from './native-accounts-types';
import { nativeModelsOfflineTarget, type NativeModelsOfflineTarget } from './native-models-offline';

/** Presentation only. The caller owns the explicit `inspect-models` request and its receipt. */
export function NativeModelsOfflineNotice({ language, target, busy = false, disabled = false, failed = false, consequence, onCheck }: {
  language: Language; target: NativeModelsOfflineTarget; busy?: boolean; disabled?: boolean; failed?: boolean;
  /** What is unavailable on this surface until the check completes. */
  consequence?: string; onCheck: () => void;
}) {
  const ru = language === 'ru';
  const checking = target.checking || busy;
  return <Notice tone="warning" className="native-models-offline" data-native-models-offline=""
    title={ru ? `Native-модели не подключены — ${target.label}` : `Native models are offline — ${target.label}`}
    action={<Button size="sm" disabled={disabled || checking} busy={checking} onClick={onCheck}>
      {ru ? 'Проверить аккаунт и модели' : 'Inspect account and models'}</Button>}
    meta={failed || target.lastCheckUnconfirmed ? (ru ? 'Последняя проверка не подтвердила каталог. Её квитанция сохранена; повторной отправки не было.' : 'The last check did not confirm a catalog. Its receipt is kept; nothing was resent.') : undefined}>
    {checking
      ? (ru ? 'Проверяем аккаунт и каталог моделей…' : 'Checking the account and model catalog…')
      : `${ru ? 'После перезапуска или обновления NEKODEX не подключает Native сам: проверка обращается к OpenAI и запускает исполнителя аккаунта, поэтому выполняется только по вашей команде.'
        : 'After a restart or update NEKODEX does not reconnect Native by itself: the check contacts OpenAI and starts the account worker, so it runs only when you ask.'}${consequence ? ` ${consequence}` : ''}`}
  </Notice>;
}

/**
 * Self-contained banner for surfaces without the Native accounts panel (Agent tools OAuth).
 * It reads passive status, sends one explicit `inspect-models` per click and keeps that exact
 * identity when the response is lost: refresh reconciles its receipt and never resubmits it.
 */
export function NativeModelsOfflineBanner({ api, language, disabled = false, consequence, fallback = null, onRestored }: {
  api: NativeAccountsApi; language: Language; disabled?: boolean; consequence?: string;
  /** Shown while no signed-in profile can be checked from here. */
  fallback?: ReactNode; onRestored?: () => void;
}) {
  const transport = useRef(api); transport.current = api;
  const restored = useRef(onRestored); restored.current = onRestored;
  const mounted = useRef(false), inFlight = useRef(false);
  const outstanding = useRef<NativeInventoryRequest | null>(null);
  const [snapshot, setSnapshot] = useState<NativeAccountsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const reported = useRef(false);
  const online = (result: NativeAccountsSnapshot) => Boolean(result.execution?.ownerHeld && result.execution.models.length);
  // Whoever started the check (this banner, or Agent mode while this surface polls a running
  // inventory), the parent re-reads its own status once models are observed online.
  const accept = (result: NativeAccountsSnapshot) => {
    setSnapshot(result);
    if (online(result) && !reported.current) { reported.current = true; restored.current?.(); }
  };
  // Clears the retained request once its receipt (or a known pre-intent refusal) is visible.
  const settle = (result: NativeAccountsSnapshot) => {
    const request = outstanding.current; if (!request) return;
    const receipt = result.inventory?.receipts.find(row => row.actionId === request.actionId);
    if (result.rejectedAction?.actionId === request.actionId || receipt && !receipt.ownerHeld && ['completed', 'unknown'].includes(receipt.state)) {
      outstanding.current = null; setUnknown(false);
      if (!online(result)) setFailed(true);
    }
  };
  const read = async () => {
    if (inFlight.current) return; inFlight.current = true;
    try {
      const request = outstanding.current;
      const result = await transport.current.request({ action: 'status', ...(request ? { actionId: request.actionId } : {}) });
      if (!mounted.current) return; accept(result); settle(result);
    } catch { /* Passive status only; the banner stays hidden without a confirmed snapshot. */ }
    finally { inFlight.current = false; }
  };
  useEffect(() => { mounted.current = true; void read(); return () => { mounted.current = false; }; }, []);
  const target = nativeModelsOfflineTarget(snapshot);
  const observing = Boolean(target?.checking || unknown);
  useEffect(() => {
    if (!observing || disabled) return;
    const timer = window.setInterval(() => void read(), 2000);
    return () => window.clearInterval(timer);
  }, [observing, disabled]);
  if (!target) return <>{fallback}</>;
  const check = async () => {
    if (inFlight.current || outstanding.current || disabled || target.checking) return;
    const body: NativeInventoryRequest = { action: 'inspect-models', actionId: crypto.randomUUID(), profileId: target.profileId, epoch: target.epoch };
    inFlight.current = true; outstanding.current = body; setBusy(true); setFailed(false);
    try {
      const result = await transport.current.request(body);
      if (!mounted.current) return;
      outstanding.current = null; accept(result);
      if (!online(result)) setFailed(true);
    } catch {
      // The request may have started: keep its identity and observe its receipt instead of resending.
      if (mounted.current) { setFailed(true); setUnknown(true); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && outstanding.current) void read();
    }
  };
  return <NativeModelsOfflineNotice language={language} target={target} busy={busy || unknown} disabled={disabled}
    failed={failed} consequence={consequence} onCheck={() => void check()} />;
}
