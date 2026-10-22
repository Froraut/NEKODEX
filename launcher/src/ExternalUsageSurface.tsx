import { useEffect, useId, useRef, useState } from 'react';
import { Button, Checkbox, Notice, Page, Panel, Select, SurfaceHeader, TextField } from './design';
import type { Language } from './types';
import type { ExternalUsageApi, ExternalUsageClient, ExternalUsageEstimate, ExternalUsageScope, ExternalUsageSnapshot } from './external-usage-types';
import { externalUsageCopy } from './external-usage-copy';
import './surfaces/external-usage.css';
import { UsagePricingPanel } from './UsagePricingPanel';

export function ExternalUsageSurface({ api, language = 'en' }: { api: ExternalUsageApi; language?: Language }) {
  const c = externalUsageCopy(language);
  const baseId = useId();
  const [snapshot, setSnapshot] = useState<ExternalUsageSnapshot | null>(null);
  const [client, setClient] = useState<ExternalUsageClient>('codex');
  const [account, setAccount] = useState('local-account');
  const [scope, setScope] = useState<ExternalUsageScope>('unknown');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const owner = useRef(0), inFlight = useRef(false);
  const apply = (next: ExternalUsageSnapshot) => {
    setSnapshot(next);
  };
  const run = async (work: () => Promise<ExternalUsageSnapshot>, propagateError = false) => {
    if (inFlight.current) { if (propagateError) throw new Error('An external usage operation is already running'); return; }
    inFlight.current = true; const generation = owner.current;
    setBusy(true); setError('');
    try { const next = await work(); if (generation === owner.current) apply(next); }
    catch (reason) { if (generation === owner.current) setError(reason instanceof Error ? reason.message : String(reason)); if (propagateError) throw reason; }
    finally { inFlight.current = false; if (generation === owner.current) setBusy(false); }
  };
  useEffect(() => { const generation = ++owner.current; setBusy(true); void api.request({action:'status'}).then(next => {
    if (generation === owner.current) apply(next);
  }).catch(reason => { if (generation === owner.current) setError(String(reason)); }).finally(() => { if (generation === owner.current) setBusy(false); });
    return () => { owner.current++; }; }, [api]);
  const options = [{value:'unknown',label:c.unknown},{value:'external-only',label:c.external},{value:'may-overlap-nekodex',label:c.overlap}];
  const estimate = (value: ExternalUsageEstimate) => <div className="external-usage__estimate">
    <strong>{value.amount === null ? c.noPrice : new Intl.NumberFormat(language, {style:'currency',currency:'USD',maximumFractionDigits:6}).format(value.amount)}</strong>{' '}
    <span>{value.complete ? c.complete : c.partial} · {c.unpriced}: {value.unpricedTokens.toLocaleString(language)} · {c.missing}: {value.unknownRecords.toLocaleString(language)}</span>
    {value.catalogVersion ? <> <span>{value.catalogVersion} · {value.effectiveDate} · USD · {value.sourceStatus === 'legacy-unverified' ? c.legacyPricing : value.sourceStatus === 'user-import' ? c.userPricing : c.officialPricing}</span></> : null}
    {value.pricingScenario ? <> <span>{value.pricingScenario}</span></> : null}
    {value.unmappedModels.length ? <> <span>{c.unmappedModels}: {value.unmappedModels.join(', ')}</span></> : null}
  </div>;
  return <Page width="wide"><SurfaceHeader title={c.title} subtitle={c.intro} actions={<Button busy={busy} onClick={() => void run(() => api.request({action:'status'}))}>{c.refresh}</Button>} />
    <section className="external-usage" aria-label={c.title}>
    <Panel title={language === 'ru' ? 'Источники и импорт' : 'Sources and import'}>
      {busy ? <Notice>{language === 'ru' ? 'Загрузка данных источников…' : 'Loading source data…'}</Notice> : null}
      <details className="external-usage__details"><summary>{c.importDetails}</summary><p>{c.description}</p><p>{c.formats}</p><p className="external-usage__muted">{c.coverage}</p></details>
      {error ? <Notice tone="error" title={language === 'ru' ? 'Данные источников недоступны' : 'Source data is unavailable'} meta={snapshot ? (language === 'ru' ? 'Показаны ранее загруженные данные; их актуальность не подтверждена.' : 'Previously loaded data is shown; its current state is unconfirmed.') : undefined}>{error}</Notice> : null}
      <div className="external-usage__form">
        <div className="external-usage__field"><label htmlFor={`${baseId}-client`}>{c.client}</label><Select id={`${baseId}-client`} label={c.client} value={client} onChange={value => setClient(value as ExternalUsageClient)} options={[{value:'codex',label:'Codex'},{value:'claude',label:'Claude Code'},{value:'gemini',label:'Gemini CLI'}]} disabled={busy} /></div>
        <TextField label={c.account} hint={c.accountHint} value={account} onChange={event => setAccount(event.target.value)} pattern="[A-Za-z0-9_-]{1,40}" maxLength={40} disabled={busy} />
        <div className="external-usage__field"><label htmlFor={`${baseId}-scope`}>{c.scope}</label><Select id={`${baseId}-scope`} label={c.scope} value={scope} onChange={value => setScope(value as ExternalUsageScope)} options={options} disabled={busy} /></div>
      </div>
      <div className="external-usage__import">
        <Checkbox checked={consent} onChange={setConsent} label={c.consent} disabled={busy} />
        <Button variant="primary" disabled={busy || !consent || !/^[A-Za-z0-9_-]{1,40}$/.test(account)} onClick={() => void run(() => api.selectRoot({client,accountPseudonym:account,scope,consent:true}).then(next => { setConsent(false); return next; }))}>{c.pick}</Button>
      </div>
    </Panel>
    {snapshot && !snapshot.sources.length ? <Panel title={c.recorded}><p>{c.empty}</p></Panel> : snapshot?.sources.map(source => <Panel key={source.id} title={`${{codex:'Codex',claude:'Claude Code',gemini:'Gemini CLI'}[source.client]} · ${source.accountPseudonym}`}>
      <p>{source.enabled ? c.active : c.paused} · {c.unknownCoverage} · {source.adapter}</p>
      <div className="external-usage__stats">
        <div><span>{c.input}</span> <strong>{source.reportedRecords ? source.inputTokens.toLocaleString(language) : '—'}</strong></div>
        <div><span>{c.output}</span> <strong>{source.reportedRecords ? source.outputTokens.toLocaleString(language) : '—'}</strong></div>
        <div><span>{c.rows}</span> <strong>{source.reportedRecords.toLocaleString(language)}</strong></div>
        <div><span>{c.missing}</span> <strong>{source.unknownRecords.toLocaleString(language)}</strong></div>
      </div>
      <div className="external-usage__meta">
        <p className="external-usage__muted">{c.models}: {source.models.join(', ') || '—'} · {c.versions}: {source.clientVersions.join(', ') || '—'}</p>
        <p className="external-usage__muted">{source.directoryName} · {c.last}: {source.lastImport ? new Date(source.lastImport).toLocaleString(language) : c.never}</p>
      </div>
      <div className="external-usage__field external-usage__source-scope"><label htmlFor={`${baseId}-scope-${source.id}`}>{c.scope}</label><Select id={`${baseId}-scope-${source.id}`} label={c.scope} value={source.scope} onChange={value => void run(() => api.request({action:'set-scope',sourceId:source.id,scope:value as ExternalUsageScope}))} options={options} disabled={busy} /></div>
      {source.warnings.length ? <Notice tone="warning" title={c.warnings} className="external-usage__warnings">{source.warnings.map((warning, index) => <span key={warning} className="external-usage__warning-item">{index ? ' · ' : ''}{warning}</span>)}</Notice> : null}
      <div className="external-usage__estimate-block"><h3>{c.estimate}</h3>{estimate(source.estimate)}</div>
      {renaming?.id === source.id ? <form onSubmit={event => { event.preventDefault(); if (!/^[A-Za-z0-9_-]{1,40}$/.test(renaming.label)) return; void run(async () => { const next = await api.request({ action: 'rename-source', sourceId: source.id, accountPseudonym: renaming.label }); setRenaming(null); return next; }); }}>
        <TextField autoFocus label={c.account} hint={c.accountHint} value={renaming.label} maxLength={40} pattern="[A-Za-z0-9_-]{1,40}" disabled={busy} onChange={event => setRenaming({ id: source.id, label: event.target.value })} />
        <Button type="submit" disabled={busy || !/^[A-Za-z0-9_-]{1,40}$/.test(renaming.label)}>{language === 'ru' ? 'Сохранить название' : 'Save label'}</Button>
        <Button disabled={busy} onClick={() => setRenaming(null)}>{c.cancel}</Button>
      </form> : null}
      <div className="external-usage__actions">
        <Button disabled={busy} onClick={() => setRenaming({ id: source.id, label: source.accountPseudonym })}>{language === 'ru' ? 'Изменить название' : 'Rename source'}</Button>
        <Button disabled={busy || !source.enabled} onClick={() => void run(() => api.request({action:'import',sourceId:source.id}))}>{c.import}</Button>
        <Button disabled={busy} onClick={() => void run(() => api.request({action:'set-enabled',sourceId:source.id,enabled:!source.enabled}))}>{source.enabled ? c.pause : c.resume}</Button>
        <Button disabled={busy} variant="ghost" className="external-usage__forget" onClick={() => setDeleting(source.id)}>{c.forget}</Button>
      </div>
      {deleting === source.id ? <div className="external-usage__confirmation" role="group" aria-label={c.confirm}><p>{c.confirm}</p><div className="external-usage__actions"><Button variant="danger" disabled={busy} onClick={() => void run(async () => {const next=await api.request({action:'forget-source',sourceId:source.id});setDeleting(null);return next;})}>{c.yes}</Button><Button disabled={busy} onClick={() => setDeleting(null)}>{c.cancel}</Button></div></div> : null}
    </Panel>)}
    {snapshot?.sources.length ? <Panel title={c.externalTotal}><p>{c.excluded}: {snapshot.aggregate.excludedSources}</p>{estimate(snapshot.aggregate)}</Panel> : null}
    {snapshot ? <UsagePricingPanel catalog={snapshot.catalog} recordedModels={[...new Set(snapshot.sources.flatMap(source => source.models).filter(model => model !== 'unknown'))]} language={language} disabled={busy} onApply={async catalog => { await run(() => api.request({action:'set-catalog',catalog}), true); }} /> : null}
  </section></Page>;
}
