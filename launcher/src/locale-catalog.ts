import english from './i18n-en.json';
import type { Language } from './types';

export type Copy = { [K in keyof typeof english]: string };
type TranslatedLanguage = Exclude<Language, 'en'>;
type LocaleLoaders = Record<TranslatedLanguage, () => Promise<{ default: Copy }>>;
export type LocaleResource = { status: 'idle' | 'loading' | 'ready' | 'failed'; language: Language; copy: Copy };

const loaders: LocaleLoaders = {
  // Russian copy retains the full-dictionary NEKODEX adaptation of upstream PR #584.
  ru: () => import('./i18n-ru.json'),
  'zh-CN': () => import('./i18n-zh-CN.json'),
  'zh-TW': () => import('./i18n-zh-TW.json'),
  ja: () => import('./i18n-ja.json'),
  ko: () => import('./i18n-ko.json'),
};

/** One shared resource per language, with a synchronous English fallback. */
export function createLocaleCatalog(sources: LocaleLoaders = loaders) {
  const fallback: LocaleResource = { status: 'ready', language: 'en', copy: english };
  const resources = new Map<Language, LocaleResource>([['en', fallback]]);
  const pending = new Map<Language, Promise<Copy>>();
  const listeners = new Set<() => void>();
  const read = (language: Language) => {
    if (!resources.has(language)) resources.set(language, { ...fallback, status: 'idle' });
    return resources.get(language)!;
  };
  const publish = (language: Language, resource: LocaleResource) => {
    resources.set(language, resource);
    for (const listener of listeners) listener();
  };
  const load = (language: Language): Promise<Copy> => {
    const resource = read(language);
    if (resource.status === 'ready') return Promise.resolve(resource.copy);
    const existing = pending.get(language);
    if (existing) return existing;
    // Establish the promise before publishing; a subscriber can request the
    // same language synchronously and must join this load.
    const promise = Promise.resolve().then(() => sources[language as TranslatedLanguage]()).then(module => {
      const copy = module.default;
      if (!copy || Object.keys(english).some(key => typeof copy[key as keyof Copy] !== 'string' || !copy[key as keyof Copy].trim())) {
        throw new Error('Language dictionary is incomplete');
      }
      publish(language, { status: 'ready', language, copy });
      return copy;
    }).catch(() => {
      publish(language, { ...fallback, status: 'failed' });
      throw new Error('Language files could not be loaded. Reload NEKODEX to try again.');
    }).finally(() => { pending.delete(language); });
    pending.set(language, promise);
    publish(language, { ...fallback, status: 'loading' });
    return promise;
  };
  return { read, load, subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  } };
}

export const localeCatalog = createLocaleCatalog();
export const loadLanguage = localeCatalog.load;
// Synchronous consumers must preload or subscribe through useLocaleCopy. Reads
// never start network work or throw while the renderer is handling an event.
export const copyFor = (language: Language): Copy => localeCatalog.read(language).copy;
