import { useId, useRef, useState } from 'react';
import { accountToolsCopy } from './account-tools-onboarding';
import { connectorSetupHelpCopy, type ConnectorHelpTopic } from './connector-setup-help-copy';
import { connectorSetupIllustrations } from './connector-setup-help-manifest';
import { Button, Dialog, Select, TextField } from './design';
import type { BrowserInteractionMode, Language } from './types';
import './surfaces/connector-setup-help.css';

export type ConnectorHelpAction = { label: string; onOpen: () => void; disabled?: boolean };
type Props = {
  accountId: string; accountLabel: string; interactionMode: BrowserInteractionMode; language: Language;
  initialTopic?: ConnectorHelpTopic; connectorName?: string; connectorLabel?: string; disabled?: boolean;
  actions: Partial<Record<ConnectorHelpTopic, ConnectorHelpAction>>;
};

/** Pure instructional state, keyed by captured account + mode. Never writes setup or readiness. */
export function ConnectorSetupHelp(props: Props) {
  return <ScopedConnectorSetupHelp key={JSON.stringify([props.accountId, props.interactionMode])} {...props} />;
}

function ScopedConnectorSetupHelp({ accountId, accountLabel, interactionMode, language, initialTopic = 'platform',
  connectorName, connectorLabel, disabled, actions }: Props) {
  const text = connectorSetupHelpCopy(language);
  const accountText = accountToolsCopy(language);
  const [topic, setTopic] = useState<ConnectorHelpTopic>(initialTopic);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const guide = text.guides[topic];
  const illustration = connectorSetupIllustrations[topic];
  const action = actions[topic];
  return <div className="nk-connector-help-entry" data-testid="connector-setup-help" data-account-id={accountId} data-interaction-mode={interactionMode}>
    <Button size="sm" variant="ghost" ref={trigger} aria-haspopup="dialog" onClick={() => { setTopic(initialTopic); setOpen(true); }}>
      {text.show}
    </Button>
    <Dialog open={open} title={text.title} className="nk-connector-help" onClose={() => setOpen(false)} restoreFocus={trigger}
      aria-describedby={descriptionId} actions={<Button data-modal-autofocus onClick={() => setOpen(false)}>{text.close}</Button>}>
      <p className="nk-connector-help__scope">{accountText.target}: <strong>{accountLabel}</strong> · {interactionMode === 'manual' ? accountText.manualMode : accountText.automaticMode}</p>
      <Select label={text.topics} value={topic} onChange={value => setTopic(value as ConnectorHelpTopic)}
        options={(Object.keys(text.guides) as ConnectorHelpTopic[]).map(value => ({ value, label: text.guides[value].title }))} />
      <section className="nk-connector-help__guide" aria-label={guide.title}>
        <h3>{guide.title}</h3>
        <figure className="nk-connector-help__figure">
          <span className="nk-connector-help__art" aria-hidden="true" style={{ maskImage: `url("${illustration.src}")`, WebkitMaskImage: `url("${illustration.src}")` }} />
          <ol className="nk-connector-help__labels">{guide.labels.map((label, index) => <li key={index}>{label}</li>)}</ol>
          <figcaption>{text.illustration}</figcaption>
        </figure>
        <ol className="nk-connector-help__steps">{guide.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        {topic === 'connector' && connectorName && connectorLabel ? <TextField label={connectorLabel} readOnly value={connectorName}
          onFocus={event => event.currentTarget.select()} /> : null}
        {action ? <Button size="sm" iconEnd="browser" disabled={disabled || action.disabled} onClick={action.onOpen}>{action.label}</Button> : null}
      </section>
      <p className="nk-connector-help__proof" id={descriptionId}>{text.proof}</p>
    </Dialog>
  </div>;
}
