import { useRef, useState } from 'react';

/** One mounted feature owns one action; selection changes never retarget it. */
export function useFeatureAction<Identity>(disabled: boolean, onError: (error: unknown, identity: Identity) => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Identity | null>(null);
  const run = async (identity: Identity, operation: () => Promise<unknown>) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(identity);
    try { await operation(); }
    catch (error) { onError(error, identity); }
    finally { inFlight.current = false; setPending(null); }
  };
  return { pending, run };
}
