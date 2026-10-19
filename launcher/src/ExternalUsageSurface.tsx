import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Notice, Page, Panel, Select, TextField } from './design';
import type { Language } from './types';
import type { ExternalUsageApi, ExternalUsageCatalog, ExternalUsageClient, ExternalUsageEstimate, ExternalUsageScope, ExternalUsageSnapshot } from './external-usage-types';
import { externalUsageCopy } from './external-usage-copy';
import './surfaces/external-usage.css';

const SAMPLE_CATALOG = JSON.stringify({version:'my-rates-v1',effectiveDate:'2026-10-18',currency:'USD',models:[{model:'exact-recorded-model',priceModel:'exact-priced-model',inputPerMillion:null,cachedInputPerMillion:null,cacheWritePerMillion:null,outputPerMillion:null}]}, null, 2);
export function ExternalUsageSurface({ api, language = 'en' }: { api: ExternalUsageApi; language?: Language }) {
  const c = externalUsageCopy(language);
  const [snapshot, setSnapshot] = useState<ExternalUsageSnapshot | null>(null);
  const [client, setClient] = useState<ExternalUsageClient>('codex');
  const [account, setAccount] = useState('local-account');
  const [scope, setScope] = useState<ExternalUsageScope>('unknown');
  const [consent, setConsent] = useState(false);
  const [catalog, setCatalog] = useState(SAMPLE_CATALOG);
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const owner = useRef(0), inFlight = useRef(false), catalogEdited = useRef(false);
  const apply = (next: ExternalUsageSnapshot) => {
    setSnapshot(next);
    if (!catalogEdited.current && next.catalog) setCatalog(JSON.stringify(next.catalog, null, 2));
  };
  const run = async (work: () => Promise<ExternalUsageSnapshot>) => {
    if (inFlight.current) return;
    inFlight.current = true; const generation = owner.current;
    setBusy(true); setError('');
    try { const next = await work(); if (generation === owner.current) apply(next); }
    catch (reason) { if (generation === owner.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; if (generation === owner.current) setBusy(false); }
  };
  useEffect(() => { const generation = ++owner.current; setBusy(true); void api.request({action:'status'}).then(next => {
    if (generation === owner.current) apply(next);
  }).catch(reason => { if (generation === owner.current) setError(String(reason)); }).finally(() => { if (generation === owner.current) setBusy(false); });
    return () => { owner.current++; }; }, [api]);
  const options = [{value:'unknown',label:c.unknown},{value:'external-only',label:c.external},{value:'may-overlap-nekodex',label:c.overlap}];
  const estimate = (value: ExternalUsageEstimate) => <div className="external-usage__estimate">
    <strong>{value.amount === null ? c.noPrice : new Intl.NumberFormat(language, {style:'currency',currency:'USD',maximumFractionDigits:6}).format(value.amount)}</strong>
    <span>{value.complete ? c.complete : c.partial} · {c.unpriced}: {value.unpricedTokens.toLocaleString(language)} · {c.missing}: {value.unknownRecords.toLocaleString(language)}</span>
    {value.catalogVersion ? <span>{value.catalogVersion} · {value.effectiveDate} · USD</span> : null}
  </div>;
  return <Page width="wide"><section className="external-usage" aria-label={c.title}>
    <Panel title={c.title} actions={<Button disabled={busy} onClick={() => void run(() => api.request({action:'status'}))}>{c.refresh}</Button>}>
      <p className="external-usage__intro">{c.intro}</p>
      <details className="external-usage__details"><summary>{c.importDetails}</summary><p>{c.description}</p><p className="external-usage__muted">{c.coverage}</p></details>
      {error ? <Notice tone="error" title={error} role="alert" /> : null}
      <div className="external-usage__form">
        <label className="external-usage__field"><span>{c.client}</span><Select label={c.client} value={client} onChange={value => setClient(value as ExternalUsageClient)} options={[{value:'codex',label:'Codex'},{value:'claude',label:'Claude Code'}]} disabled={busy} /></label>
        <TextField label={c.account} hint={c.accountHint} value={account} onChange={event => setAccount(event.target.value)} pattern="[A-Za-z0-9_-]{1,40}" maxLength={40} disabled={busy} />
        <label className="external-usage__field"><span>{c.scope}</span><Select label={c.scope} value={scope} onChange={value => setScope(value as ExternalUsageScope)} options={options} disabled={busy} /></label>
      </div>
      <div className="external-usage__import">
        <Checkbox checked={consent} onChange={setConsent} label={c.consent} disabled={busy} />
        <Button variant="primary" disabled={busy || !consent || !/^[A-Za-z0-9_-]{1,40}$/.test(account)} onClick={() => void run(() => api.selectRoot({client,accountPseudonym:account,scope,consent:true}))}>{c.pick}</Button>
      </div>
    </Panel>
    {!snapshot?.sources.length ? <Panel title={c.recorded}><p>{c.empty}</p></Panel> : snapshot.sources.map(source => <Panel key={source.id} title={`${source.client === 'codex' ? 'Codex' : 'Claude Code'} · ${source.accountPseudonym}`}>
      <p>{source.enabled ? c.active : c.paused} · {c.unknownCoverage} · {source.adapter}</p>
      <div className="external-usage__stats">
        <div><span>{c.input}</span><strong>{source.reportedRecords ? source.inputTokens.toLocaleString(language) : '—'}</strong></div>
        <div><span>{c.output}</span><strong>{source.reportedRecords ? source.outputTokens.toLocaleString(language) : '—'}</strong></div>
        <div><span>{c.rows}</span><strong>{source.reportedRecords}</strong></div>
        <div><span>{c.missing}</span><strong>{source.unknownRecords}</strong></div>
      </div>
      <p className="external-usage__muted">{c.models}: {source.models.join(', ') || '—'} · {c.versions}: {source.clientVersions.join(', ') || '—'}</p>
      <p className="external-usage__muted">{source.directoryName} · {c.last}: {source.lastImport ? new Date(source.lastImport).toLocaleString(language) : c.never}</p>
      <label className="external-usage__field external-usage__source-scope"><span>{c.scope}</span><Select label={c.scope} value={source.scope} onChange={value => void run(() => api.request({action:'set-scope',sourceId:source.id,scope:value as ExternalUsageScope}))} options={options} disabled={busy} /></label>
      {source.warnings.length ? <Notice tone="warning" title={c.warnings}><ul>{source.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></Notice> : null}
      <h3>{c.estimate}</h3>{estimate(source.estimate)}
      <div className="external-usage__actions">
        <Button disabled={busy || !source.enabled} onClick={() => void run(() => api.request({action:'import',sourceId:source.id}))}>{c.import}</Button>
        <Button disabled={busy} onClick={() => void run(() => api.request({action:'set-enabled',sourceId:source.id,enabled:!source.enabled}))}>{source.enabled ? c.pause : c.resume}</Button>
        <Button disabled={busy} variant="ghost" className="external-usage__forget" onClick={() => setDeleting(source.id)}>{c.forget}</Button>
      </div>
      {deleting === source.id ? <div role="group" aria-label={c.confirm}><p>{c.confirm}</p><Button variant="danger" disabled={busy} onClick={() => void run(async () => {const next=await api.request({action:'forget-source',sourceId:source.id});setDeleting(null);return next;})}>{c.yes}</Button><Button disabled={busy} onClick={() => setDeleting(null)}>{c.cancel}</Button></div> : null}
    </Panel>)}
    {snapshot?.sources.length ? <Panel title={c.externalTotal}><p>{c.excluded}: {snapshot.aggregate.excludedSources}</p>{estimate(snapshot.aggregate)}</Panel> : null}
    <Panel title={c.catalog}><p>{c.pricingHelp}</p>
      {snapshot?.catalog ? <p>{snapshot.catalog.version} · {snapshot.catalog.effectiveDate} · USD</p> : null}
      <label className="external-usage__catalog">JSON<textarea rows={14} maxLength={60000} spellCheck={false} value={catalog} onChange={event => {setCatalog(event.target.value);catalogEdited.current=true;setCatalogDirty(true);}} /></label>
      <div className="external-usage__actions"><Button disabled={busy || !catalogDirty} onClick={() => void run(async () => {
        const parsed = JSON.parse(catalog) as ExternalUsageCatalog;
        const next = await api.request({action:'set-catalog',catalog:parsed}); catalogEdited.current=false;setCatalogDirty(false);return next;
      })}>{c.save}</Button><Button disabled={busy || !snapshot?.catalog} onClick={() => void run(async () => {const next=await api.request({action:'set-catalog',catalog:null});return next;})}>{c.clear}</Button></div>
    </Panel>
  </section></Page>;
}
