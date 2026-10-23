/** Inert actual-source UI only: memory receipts; no preload, host, account or model API. */
import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { NativeAccountsPanel } from '../../launcher/src/NativeAccountsPanel';
import type { NativeAccountsApi, NativeAccountsSnapshot } from '../../launcher/src/native-accounts-types';
import '../../launcher/src/tokens.css';
import '../../launcher/src/design/components.css';
const params = new URLSearchParams(location.search), requests: unknown[] = [];
const profileId = '11111111-1111-4111-8111-111111111111', epoch = '22222222-2222-4222-8222-222222222222';
const rename = params.get('surface') === 'rename';
let state: NativeAccountsSnapshot = { available: rename, reasonCode: rename ? null : 'authority_held_elsewhere', recoverySupported: true,
  profiles: [{ id: profileId, epoch, label: 'Inert signed-in Native profile', state: 'signed-in-checking' }], activeCount: 0, executionAvailable: false, receipts: [],
  ...(rename ? { execution: { profileId, epoch, ownerHeld: true, models: [{ id: 'inert-model', label: 'Inert retained model' }] } as NativeAccountsSnapshot['execution'] } : {}) };
let lost = false;
const api: NativeAccountsApi = { async request(body) {
  requests.push(structuredClone(body));
  if (body.action === 'status') return structuredClone(state);
  if (body.action === 'preview-owner-recovery') {
    if (params.get('state') === 'error') throw new Error('Inert pause refused');
    state = { ...state, recoveryPreview: { state: params.get('state') === 'foreign' ? 'blocked' : 'reviewable',
      ...(params.get('state') === 'foreign' ? { reasonCode: 'recovery_physical_owner_unverified' } : { reviewDigest: 'a'.repeat(64) }),
      observedAt: Date.now(), unsettledActionCount: 0, markers: [{ kind: 'authority', formerPid: 86402, sha256: 'b'.repeat(64) }] } };
  } else if (body.action === 'recover-owner') {
    if (body.reviewDigest !== state.recoveryPreview?.reviewDigest) throw new Error('Stale inert review');
    state = { ...state, available: true, reasonCode: null, recoveryReceipt: { actionId: body.actionId, reviewDigest: body.reviewDigest, state: 'completed', terminal: true, ownerHeld: false, archivedCount: 1, unsettledActionCount: 0 } };
  } else if (body.action === 'rename-profile') {
    if (body.profileId !== profileId || body.epoch !== epoch || body.expectedLabel !== state.profiles[0]!.label) throw new Error('Stale inert profile');
    state = { ...state, profiles: [{ ...state.profiles[0]!, label: body.label }], receipts: [...state.receipts, { actionId: body.actionId, kind: 'rename-profile', profileId, epoch, state: 'completed' }] };
    if (params.get('state') === 'lost' && !lost) { lost = true; throw new Error('Inert lost rename ACK; refresh observes receipt'); }
  } else throw new Error(`Unsupported inert action ${body.action}`);
  return structuredClone(state);
}, async openVerificationUrl() { throw new Error('No external navigation in inert fixture'); } };
(window as any).nativeRecoveryFixture = { requests, snapshot: () => structuredClone(state), providerCreated: false, processesStarted: false };
createRoot(document.getElementById('root')!).render(createElement('div', null,
  createElement('p', null, 'Inert Native recovery / Rename fixture. Memory-only receipts; no account, helper, model, filesystem or process actions. Use ?surface=rename; &state=lost or ?state=foreign/error.'),
  createElement(NativeAccountsPanel, { api, language: params.get('language') === 'ru' ? 'ru' : 'en' })));
