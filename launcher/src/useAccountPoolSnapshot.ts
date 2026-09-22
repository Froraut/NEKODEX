import { useEffect, useRef, useState } from 'react';
import type { AccountPoolSnapshot } from './types';

type PoolApi = Pick<NonNullable<Window['codexWebLauncher']>, 'accounts' | 'onBrowserState' | 'onOperation'>;

/** Owns account evidence only; quota and login lifetimes remain independent. */
export function useAccountPoolSnapshot({ api, initial = 'scheduled', identity = '', retainOnFailure = true }: {
  api: PoolApi; initial?: 'immediate' | 'scheduled'; identity?: string; retainOnFailure?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<AccountPoolSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const controller = useRef<{ invalidate: () => void; apply: (value: AccountPoolSnapshot) => void } | null>(null);
  useEffect(() => {
    let disposed = false, inFlight = false, revision = 0;
    let timer: number | undefined;
    const load = () => {
      timer = undefined;
      if (disposed || inFlight) return;
      inFlight = true;
      setLoading(true);
      const requestedRevision = revision;
      void api.accounts().then(value => {
        if (disposed || requestedRevision !== revision) return;
        setSnapshot(value); setFailed(false);
      }).catch(() => {
        if (disposed || requestedRevision !== revision) return;
        setFailed(true);
        if (!retainOnFailure) setSnapshot(null);
      }).finally(() => {
        inFlight = false;
        if (disposed) return;
        if (requestedRevision !== revision) schedule(false);
        else setLoading(false);
      });
    };
    const schedule = (invalidate = true) => {
      if (disposed) return;
      if (invalidate) revision += 1;
      if (timer === undefined && !inFlight) timer = window.setTimeout(load, 150);
    };
    controller.current = {
      invalidate: () => schedule(),
      apply(value) {
        // Retire every older read before accepting a mutation receipt.
        revision += 1;
        setSnapshot(value); setFailed(false);
        schedule(false);
      },
    };
    setSnapshot(null); setFailed(false); setLoading(true);
    const unsubscribeBrowser = api.onBrowserState(() => schedule());
    const unsubscribeOperation = api.onOperation(operation => {
      if (operation.status !== 'running') schedule();
    });
    if (initial === 'immediate') load(); else schedule();
    return () => {
      disposed = true; window.clearTimeout(timer);
      unsubscribeBrowser(); unsubscribeOperation(); controller.current = null;
    };
  }, [api, initial, identity, retainOnFailure]);
  return { snapshot, loading, failed,
    retry: () => controller.current?.invalidate(),
    invalidate: () => controller.current?.invalidate(),
    applyReceipt: (value: AccountPoolSnapshot) => controller.current?.apply(value),
  };
}
