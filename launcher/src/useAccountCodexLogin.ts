import { useEffect, useRef, useState } from 'react';
import type { CodexLoginProgress } from './types';

type LoginApi = Pick<NonNullable<Window['codexWebLauncher']>, 'codexLoginSnapshot' | 'codexLoginStatus'
  | 'startCodexLogin' | 'cancelCodexLogin' | 'openCodexLogin' | 'copyCodexLoginCode'>;

export function useAccountCodexLogin({ api, transitionBusy, loadFailed, isQuotaBusy, setError }: {
  api: LoginApi; transitionBusy: boolean; loadFailed: boolean; isQuotaBusy: (id: string) => boolean;
  setError: (message: string | null) => void;
}) {
  const [login, setLogin] = useState<CodexLoginProgress | null>(null);
  const [loginSnapshotStatus, setLoginSnapshotStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [startingAccountId, setStartingAccountId] = useState<string | null>(null);
  const startingId = useRef<string | null>(null);
  const loginRevision = useRef(0);
  const loginActionInFlight = useRef(false);
  const [loginAction, setLoginAction] = useState<{ accountId: string; kind: "open" | "copy" | "cancel" } | null>(null);
  const loginLockedId = login && (login.active || login.settling) ? login.accountId : null;
  const loginLockedIdRef = useRef<string | null>(null);
  loginLockedIdRef.current = loginLockedId;
  useEffect(() => {
    let disposed = false;
    const revision = ++loginRevision.current;
    void api.codexLoginSnapshot().then(value => {
      if (!disposed && loginRevision.current === revision) {
        setLogin(value);
        setLoginSnapshotStatus("ready");
      }
    }).catch(error => {
      if (!disposed && loginRevision.current === revision) {
        setLoginSnapshotStatus("failed");
        setError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      disposed = true;
      loginRevision.current += 1;
    };
  }, [api, setError, loginAttempt]);

  useEffect(() => {
    if (!login || (!login.active && !login.settling) || loginSnapshotStatus !== "ready") return;
    const { flowId, accountId, deadlineAt } = login;
    const revision = ++loginRevision.current;
    const deadline = Date.parse(deadlineAt);
    const remainingSeconds = Number.isFinite(deadline)
      ? Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)) : 600;
    const maximumPolls = login.settling ? 105 : Math.min(660, remainingSeconds + 45);
    let disposed = false;
    let inFlight = false;
    let polls = 0;
    let consecutiveFailures = 0;
    let timer: number | undefined;
    const schedule = () => {
      if (disposed || loginRevision.current !== revision || timer !== undefined) return;
      if (polls >= maximumPolls) { setLoginSnapshotStatus("failed"); return; }
      timer = window.setTimeout(poll, 1_000);
    };
    const poll = () => {
      timer = undefined;
      if (disposed || inFlight || loginRevision.current !== revision || polls >= maximumPolls) return;
      polls += 1;
      inFlight = true;
      void api.codexLoginStatus(flowId, accountId).then(next => {
        if (disposed || loginRevision.current !== revision) return;
        consecutiveFailures = 0;
        setLogin(next);
        if (next.active || next.settling) schedule();
      }).catch(() => {
        if (disposed || loginRevision.current !== revision) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) setLoginSnapshotStatus("failed");
        else schedule();
      }).finally(() => { inFlight = false; });
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (loginRevision.current === revision) loginRevision.current += 1;
    };
  }, [api, login?.active, login?.accountId, login?.deadlineAt, login?.flowId, login?.phase, login?.settling, loginSnapshotStatus, pollAttempt]);

  const startCodexLogin = async (id: string) => {
    if (transitionBusy || loadFailed || isQuotaBusy(id) || startingId.current !== null || login?.active || login?.settling || loginSnapshotStatus !== "ready") return;
    startingId.current = id;
    setStartingAccountId(id);
    setError(null);
    const revision = ++loginRevision.current;
    try {
      const next = await api.startCodexLogin(id);
      if (loginRevision.current === revision) setLogin(next);
    } catch (error) {
      if (loginRevision.current === revision) {
        try {
          const current = await api.codexLoginSnapshot();
          if (loginRevision.current === revision) setLogin(current);
        } catch {
          // The host may have started the flow before the reply failed. Keep new starts
          // disabled until an explicit snapshot retry establishes its current owner.
          if (loginRevision.current === revision) setLoginSnapshotStatus("failed");
        }
        if (loginRevision.current === revision) setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (startingId.current === id) {
        startingId.current = null;
        setStartingAccountId(null);
      }
    }
  };

  const runLoginAction = async <T,>(accountId: string, kind: "open" | "copy" | "cancel", action: () => Promise<T>) => {
    if (loginActionInFlight.current || (transitionBusy && kind !== "cancel")) return null;
    loginActionInFlight.current = true;
    setLoginAction({ accountId, kind });
    setError(null);
    const revision = loginRevision.current;
    try {
      const result = await action();
      return loginRevision.current === revision ? result : null;
    } catch (error) {
      if (loginRevision.current === revision) setError(error instanceof Error ? error.message : String(error));
      return null;
    }
    finally { loginActionInFlight.current = false; setLoginAction(null); }
  };

  const cancelCodexLogin = async (progress: CodexLoginProgress) => {
    const revision = loginRevision.current;
    const next = await runLoginAction(progress.accountId, "cancel",
      () => api.cancelCodexLogin(progress.flowId, progress.accountId));
    if (next && loginRevision.current === revision) {
      loginRevision.current += 1;
      setLogin(next);
      // Even an identical settling receipt retires an older status request. Restart
      // observation explicitly because the flow/phase dependencies may not change.
      setPollAttempt(value => value + 1);
    }
  };

  const retryLogin = () => { setLoginSnapshotStatus("loading"); setLoginAttempt(value => value + 1); };
  const openCodexLogin = (progress: CodexLoginProgress) => runLoginAction(progress.accountId, "open",
    () => api.openCodexLogin(progress.flowId, progress.accountId));
  const copyCodexLoginCode = async (progress: CodexLoginProgress) => (await runLoginAction(progress.accountId, "copy",
    () => api.copyCodexLoginCode(progress.flowId, progress.accountId))) === true;
  return { login, loginSnapshotStatus, startingAccountId, startingId, loginAction, loginLockedId,
    loginLockedIdRef, startCodexLogin, cancelCodexLogin, openCodexLogin, copyCodexLoginCode, retryLogin };
}
