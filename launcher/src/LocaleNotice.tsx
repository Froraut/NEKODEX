import languages from '../electron/languages.json';
import { Button, StateDot, Toast } from './design';
import type { Copy } from './locale-catalog';
import type { Language } from './types';
import './locale-notice.css';

/** Shows that a language catalog is loading or failed. Floating: a kit Toast; inline: a status line. */
export function LocaleNotice({ language, copy, failed, floating = false }: {
  language: Language; copy: Copy; failed: boolean; floating?: boolean;
}) {
  const label = `${copy.language}: ${languages[language].label}`;
  const status = failed ? copy.failed : copy.loading;
  const reload = () => window.location.reload();
  if (floating) {
    return <Toast fixed className="locale-notice-toast" title={label} tone={failed ? 'error' : 'busy'}
      onDismiss={failed ? reload : undefined} dismissLabel={copy.reload}>{status}</Toast>;
  }
  return <div className="locale-notice nk-type-small" role={failed ? 'alert' : 'status'}>
    <StateDot state={failed ? 'error' : 'busy'} />
    <span>{label} — {status}</span>
    {failed ? <Button variant="link" size="sm" onClick={reload}>{copy.reload}</Button> : null}
  </div>;
}
