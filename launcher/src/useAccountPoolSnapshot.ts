import { useEffect, useRef, useState } from 'react';
import type { AccountPoolSnapshot } from './types';
import { createAccountSnapshotController } from './account-snapshot-controller';

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
    const reader = createAccountSnapshotController({
      read: () => api.accounts(),
      defer(action) {
        const timer = window.setTimeout(action, 150);
        return () => window.clearTimeout(timer);
      },
      onSnapshot(value) { setSnapshot(value); setFailed(false); },
      onLoading: setLoading,
      onFailure() { setFailed(true); if (!retainOnFailure) setSnapshot(null); },
    });
    controller.current = { invalidate: reader.refresh, apply: reader.apply };
    setSnapshot(null); setFailed(false); setLoading(true);
    const unsubscribeBrowser = api.onBrowserState(reader.observe);
    const unsubscribeOperation = api.onOperation(operation => {
      if (operation.status !== 'running') reader.refresh();
    });
    reader.start(initial === 'immediate');
    return () => {
      reader.dispose();
      unsubscribeBrowser(); unsubscribeOperation(); controller.current = null;
    };
  }, [api, initial, identity, retainOnFailure]);
  return { snapshot, loading, failed,
    retry: () => controller.current?.invalidate(),
    invalidate: () => controller.current?.invalidate(),
    applyReceipt: (value: AccountPoolSnapshot) => controller.current?.apply(value),
  };
}
