import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { localeCatalog } from './locale-catalog';
import type { Language } from './types';

export function useLocaleCopy(language: Language) {
  const read = useCallback(() => localeCatalog.read(language), [language]);
  const resource = useSyncExternalStore(localeCatalog.subscribe, read);
  useEffect(() => { void localeCatalog.load(language).catch(() => {}); }, [language]);
  return { ...resource, pending: resource.status === 'idle' || resource.status === 'loading' };
}
