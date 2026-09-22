import { loadLanguage, type Copy } from './locale-catalog';
import type { Language } from './types';

/** A late preparation cannot save over a newer selection from another screen. */
export function createLanguageSelection(prepare: (language: Language) => Promise<Copy> = loadLanguage) {
  let revision = 0;
  return async function select<T>(language: Language, save: (language: Language) => Promise<T>): Promise<T | null> {
    const owner = ++revision;
    try {
      await prepare(language);
      if (owner !== revision) return null;
      const result = await save(language);
      return owner === revision ? result : null;
    } catch (cause) {
      if (owner !== revision) return null;
      throw cause;
    }
  };
}
export const selectLanguage = createLanguageSelection();
