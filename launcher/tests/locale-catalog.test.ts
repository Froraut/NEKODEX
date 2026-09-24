import { expect, test } from 'bun:test';
import { createLocaleCatalog, copyFor, type Copy } from '../src/locale-catalog';
import { createLanguageSelection } from '../src/language-selection';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const russian = deferred<{ default: Copy }>();
  const japanese = deferred<{ default: Copy }>();
  const english = copyFor('en');
  const catalog = createLocaleCatalog({ ru: () => russian.promise, ja: () => japanese.promise,
    'zh-CN': async () => ({ default: english }), 'zh-TW': async () => ({ default: english }), ko: async () => ({ default: english }) });
  return { catalog, russian, japanese, english };
}
test('locale resources share loads and isolate late completion by language', async () => {
  const { catalog, russian, japanese, english } = fixture();
  const first = catalog.load('ru');
  expect(catalog.load('ru')).toBe(first);
  expect(catalog.read('ru')).toMatchObject({ status: 'loading', language: 'en', copy: english });
  const newer = catalog.load('ja');
  japanese.resolve({ default: { ...english, product: '日本語' } }); await newer;
  russian.resolve({ default: { ...english, product: 'Русский' } }); await first;
  expect(catalog.read('ja').copy.product).toBe('日本語');
  expect(catalog.read('ru').copy.product).toBe('Русский');
  expect(catalog.read('en').copy).toBe(english);
});
test('failed or incomplete dictionaries expose a usable English fallback', async () => {
  const { catalog, russian, japanese, english } = fixture();
  const ru = catalog.load('ru'); russian.reject(new Error('offline'));
  await expect(ru).rejects.toThrow('Language files could not be loaded');
  expect(catalog.read('ru')).toEqual({ status: 'failed', language: 'en', copy: english });
  const ja = catalog.load('ja'); japanese.resolve({ default: { ...english, done: '' } });
  await expect(ja).rejects.toThrow('Language files could not be loaded');
  expect(catalog.read('ja').status).toBe('failed');
});
test('a superseded language preparation or failure cannot save or replace the latest preference', async () => {
  const { catalog, russian, japanese } = fixture();
  const select = createLanguageSelection(catalog.load), saved: string[] = [];
  const save = async (language: string) => { saved.push(language); return language; };
  const old = select('ru', save), latest = select('en', save);
  expect(await latest).toBe('en');
  russian.resolve({ default: { ...copyFor('en'), product: 'Русский' } });
  expect(await old).toBeNull();
  const failed = select('ja', save); await select('en', save);
  japanese.reject(new Error('late failure'));
  expect(await failed).toBeNull();
  expect(saved).toEqual(['en', 'en']);
});
