import languages from '../electron/languages.json';
import type { Copy } from './locale-catalog';
import type { Language } from './types';
import './locale-notice.css';

export function LocaleNotice({ language, copy, failed, floating = false }: {
  language: Language; copy: Copy; failed: boolean; floating?: boolean;
}) {
  return <div className={`locale-notice${floating ? ' is-floating' : ''}`} role={failed ? 'alert' : 'status'}>
    <span>{copy.language}: {languages[language].label} — {failed ? copy.failed : copy.loading}</span>
    {failed ? <button className="text-button" type="button" onClick={() => window.location.reload()}>{copy.reload}</button> : null}
  </div>;
}
