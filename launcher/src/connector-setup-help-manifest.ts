import type { ConnectorHelpTopic } from './connector-setup-help-copy';

const scope = new URL('./assets/connector-setup/account-scope.svg', import.meta.url).href;
const tunnel = new URL('./assets/connector-setup/tunnel-binding.svg', import.meta.url).href;
const key = new URL('./assets/connector-setup/restricted-key.svg', import.meta.url).href;

const schematic = (src: string) => ({ src, kind: 'schematic', owner: 'NEKODEX', reviewed: '2026-10-18' } as const);

/** Original, text-free schematic art. Localized labels are always rendered as real text. */
export const connectorSetupIllustrations = {
  platform: schematic(scope), tunnel: schematic(tunnel), key: schematic(key),
  developer: schematic(scope), connector: schematic(tunnel),
} satisfies Record<ConnectorHelpTopic, ReturnType<typeof schematic>>;
