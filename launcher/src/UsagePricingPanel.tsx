import { useId, useRef, useState } from 'react';
import { Button, Notice, Panel, Select } from './design';
import type { Language } from './types';
import type { UsagePricingCatalog, UsagePricingPrice } from '../electron/usage-pricing.cjs';
import bundledCatalogs from '../electron/usage-pricing-snapshots.json';
import './surfaces/usage-pricing.css';

const snapshots = bundledCatalogs as UsagePricingCatalog[];
const keys = ['inputPerMillion', 'cachedInputPerMillion', 'cacheWritePerMillion', 'outputPerMillion'] as const;
const officialHosts = new Set(['developers.openai.com', 'platform.openai.com', 'openai.com', 'platform.claude.com', 'docs.anthropic.com', 'anthropic.com', 'www.anthropic.com', 'claude.com', 'ai.google.dev', 'cloud.google.com']);
function safeSourceUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port && officialHosts.has(url.hostname); }
  catch { return false; }
}
// This only prepares a readable preview. The main-owned service validates the
// entire catalog again before saving; a renderer preview confers no authority.
function previewImport(text: string): UsagePricingCatalog {
  if (new TextEncoder().encode(text).byteLength > 60000) throw new Error('Catalog JSON exceeds 60,000 bytes');
  const parsed = JSON.parse(text) as UsagePricingCatalog;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'string' || parsed.version.length > 160
      || typeof parsed.effectiveDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(parsed.effectiveDate)
      || parsed.currency !== 'USD' || !Array.isArray(parsed.models) || parsed.models.length > 80
      || parsed.models.some(row => !row || typeof row.model !== 'string' || typeof row.priceModel !== 'string'
        || (row.sourceId !== undefined && typeof row.sourceId !== 'string')
        || keys.some(key => row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key]! < 0)))) {
    throw new Error('Expected a dated USD catalog with exact model IDs and input, cached input, cache-write and output rates (number or null)');
  }
  if (!parsed.provenance || !Array.isArray(parsed.provenance.sources) || !parsed.provenance.sources.length
      || parsed.provenance.sources.length > 8 || typeof parsed.provenance.retrievedAt !== 'string'
      || typeof parsed.provenance.pricingScenario !== 'string' || parsed.provenance.pricingScenario.length > 1200
      || parsed.provenance.sources.some(source => !source || typeof source.id !== 'string'
        || !['openai', 'anthropic', 'google'].includes(source.provider)
        || typeof source.url !== 'string' || !safeSourceUrl(source.url))) {
    throw new Error('Imported catalogs require provenance with official provider HTTPS source URLs and an explicit pricing scenario');
  }
  // Pasted/file values remain user supplied even when they cite an official URL.
  parsed.provenance.kind = 'user-import';
  return parsed;
}
export interface UsagePricingPanelProps {
  catalog: UsagePricingCatalog | null;
  recordedModels: string[];
  language?: Language;
  disabled?: boolean;
  onApply: (catalog: UsagePricingCatalog | null) => Promise<void>;
}
export function UsagePricingPanel({ catalog, recordedModels, language = 'en', disabled = false, onApply }: UsagePricingPanelProps) {
  const ru = language === 'ru';
  const baseId = useId();
  const [choice, setChoice] = useState(snapshots[0]?.version ?? '');
  const [json, setJson] = useState(JSON.stringify(catalog ?? { ...snapshots[0], provenance: { ...snapshots[0]?.provenance, kind: 'user-import' } }, null, 2));
  const [preview, setPreview] = useState<UsagePricingCatalog | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const fileGeneration = useRef(0);
  const locked = disabled || pending;
  const number = (value: number | null) => value === null ? (ru ? 'Неизвестно' : 'Unknown') : new Intl.NumberFormat(language, { maximumFractionDigits: 6 }).format(value);
  const shown = preview ?? catalog;
  const unmapped = [...new Set(recordedModels)].filter(model => !shown?.models.some(row => row.model === model));
  const prepare = (work: () => UsagePricingCatalog) => {
    setError(''); setNotice(''); setPreview(null);
    try { setPreview(structuredClone(work())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const apply = async (value: UsagePricingCatalog | null) => {
    if (inFlight.current || locked) return;
    inFlight.current = true; setPending(true); setError(''); setNotice('');
    try { await onApply(value === null ? null : structuredClone(value)); setPreview(null); setNotice(ru ? 'Выбор сохранён.' : 'Selection saved.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setPending(false); }
  };
  const provenance = (value: UsagePricingCatalog) => <div className="usage-pricing__provenance">
    <p><strong>{value.version}</strong> · {value.currency} · {value.provenance ? (ru ? 'Дата наблюдения' : 'Observed on') : (ru ? 'Дата каталога' : 'Catalog date')} {value.effectiveDate}</p>
    <p>{value.provenance?.kind === 'official-provider-snapshot'
      ? (ru ? 'Сохранённый снимок официальных тарифов; автоматического обновления нет.' : 'Saved official pricing snapshot; no automatic refresh.')
      : value.provenance ? (ru ? 'Импортированные значения пользователя; ссылка не подтверждает указанные числа.' : 'User-imported values; a source URL does not authenticate the numeric rates.')
        : (ru ? 'Старый каталог без подтверждённого источника.' : 'Legacy catalog without source attribution.')}</p>
    {value.provenance ? <>
      <p>{ru ? 'Источник просмотрен' : 'Source observed'}: {value.provenance.retrievedAt}</p>
      <p className="usage-pricing__scenario">{value.provenance.pricingScenario}</p>
      <ul>{value.provenance.sources.map(source => <li key={source.id}>{source.provider} · {safeSourceUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a> : source.url}</li>)}</ul>
    </> : null}
  </div>;
  return <Panel title={ru ? 'Источник оценки стоимости' : 'Cost estimate pricing source'}>
    <div className="usage-pricing">
      <p>{ru ? 'Оценка эквивалента API по выбранному сценарию. Это не счёт провайдера и не доказанная экономия. Подписка, налоги и неизвестные категории не рассчитываются.' : 'Estimated API equivalent under the selected pricing scenario. This is not a provider bill or proven savings. Subscription charges, taxes and unknown categories are not calculated.'}</p>
      {catalog ? <details><summary>{ru ? 'Текущий выбранный каталог' : 'Current selected catalog'}</summary>{provenance(catalog)}</details> : <p>{ru ? 'Каталог не выбран: стоимость остаётся неизвестной.' : 'No catalog selected: cost remains unknown.'}</p>}
      {error ? <Notice tone="error" title={error} role="alert" /> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="usage-pricing__choice">
        <div className="usage-pricing__field">
          <label htmlFor={`${baseId}-snapshot`}>{ru ? 'Сохранённый официальный снимок' : 'Saved official snapshot'}</label>
          <Select id={`${baseId}-snapshot`} label={ru ? 'Сохранённый официальный снимок' : 'Saved official snapshot'} value={choice} disabled={locked} options={snapshots.map(value => ({ value: value.version, label: `${value.provenance?.sources[0]?.provider} · ${value.effectiveDate} · USD` }))} onChange={value => { fileGeneration.current++; setChoice(value); setPreview(null); setNotice(''); }} />
        </div>
        <Button className="usage-pricing__button" disabled={locked || !choice} onClick={() => prepare(() => snapshots.find(value => value.version === choice)!)}>{ru ? 'Просмотреть тарифы' : 'Review rates'}</Button>
      </div>
      <details>
        <summary>{ru ? 'Импортировать каталог с официальными источниками' : 'Import a catalog citing official sources'}</summary>
        <p>{ru ? 'Импорт не загружает цены по ссылке. Проверьте дату, сценарий, точное соответствие моделей и все ставки перед применением. null означает неизвестную ставку.' : 'Import does not fetch rates from a URL. Review the date, scenario, exact model mappings and every rate before applying. null means an unknown rate.'}</p>
        <div className="usage-pricing__file"><label htmlFor={`${baseId}-file`}>{ru ? 'Выбрать JSON-файл' : 'Choose JSON file'}</label><input id={`${baseId}-file`} type="file" accept="application/json,.json" disabled={locked} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          const generation = ++fileGeneration.current;
          setPreview(null); setError(''); setNotice('');
          if (file.size > 60000) { setError(ru ? 'Файл превышает 60 000 байт.' : 'File exceeds 60,000 bytes.'); return; }
          void file.text().then(value => { if (generation === fileGeneration.current) setJson(value); }).catch(reason => { if (generation === fileGeneration.current) setError(String(reason)); });
        }} /></div>
        <div className="usage-pricing__json"><label htmlFor={`${baseId}-json`}>JSON</label><textarea id={`${baseId}-json`} rows={12} maxLength={60000} spellCheck={false} disabled={locked} value={json} onChange={event => { fileGeneration.current++; setJson(event.target.value); setPreview(null); setNotice(''); }} /></div>
        <Button className="usage-pricing__button" disabled={locked} onClick={() => prepare(() => previewImport(json))}>{ru ? 'Просмотреть импорт' : 'Review import'}</Button>
      </details>
      {shown ? <div className="usage-pricing__review">
        {preview ? <h3>{ru ? 'Просмотр перед применением' : 'Review before applying'}</h3> : <h3>{ru ? 'Выбранные ставки' : 'Selected rates'}</h3>}
        {provenance(shown)}
        <div className="usage-pricing__table" role="region" aria-label={ru ? 'Тарифы в USD за 1 миллион токенов' : 'Rates in USD per 1 million tokens'} tabIndex={0}><table>
          <caption>{ru ? 'USD за 1 миллион токенов' : 'USD per 1 million tokens'}</caption>
          <thead><tr><th>{ru ? 'Модель в журнале → тариф' : 'Recorded model → priced model'}</th><th>{ru ? 'Вход' : 'Input'}</th><th>{ru ? 'Чтение кэша' : 'Cache read'}</th><th>{ru ? 'Запись кэша' : 'Cache write'}</th><th>{ru ? 'Выход' : 'Output'}</th></tr></thead>
          <tbody>{shown.models.map((row: UsagePricingPrice) => <tr key={row.model}><th scope="row">{row.model} → {row.priceModel}{row.sourceId ? <> <small>{row.sourceId}</small></> : null}</th>{keys.map(key => <td key={key}>{number(row[key])}</td>)}</tr>)}</tbody>
        </table></div>
      </div> : null}
      {unmapped.length ? <Notice tone="warning" title={ru ? 'Модели без точного тарифа: стоимость неизвестна' : 'Models without an exact mapping: cost unknown'}>{unmapped.join(', ')}</Notice> : null}
      <div className="usage-pricing__actions">
        {preview ? <Button className="usage-pricing__button" variant="primary" disabled={locked} onClick={() => void apply(preview)}>{ru ? 'Применить просмотренный каталог' : 'Apply reviewed catalog'}</Button> : null}
        <Button className="usage-pricing__button" disabled={locked || !catalog} onClick={() => void apply(null)}>{ru ? 'Убрать выбранный каталог' : 'Clear selected catalog'}</Button>
      </div>
    </div>
  </Panel>;
}
