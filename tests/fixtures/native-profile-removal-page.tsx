// Production presentation with an inert authority: no filesystem, account or model operations.
import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { NativeAccountsPanel } from '../../launcher/src/NativeAccountsPanel';
import type { NativeAccountsApi, NativeAccountsSnapshot } from '../../launcher/src/native-accounts-types';

const state = { requests: [] as any[], profiles: [
  { id: '11111111-1111-4111-8111-111111111111', epoch: '22222222-2222-4222-8222-222222222222', label: 'Fresh test profile', state: 'fresh' },
  { id: '33333333-3333-4333-8333-333333333333', epoch: '44444444-4444-4444-8444-444444444444', label: 'Failed login profile', state: 'login-failed' },
] as NativeAccountsSnapshot['profiles'], receipts: [] as NativeAccountsSnapshot['receipts'] };
(window as any).fixture = state;
const snapshot = (): NativeAccountsSnapshot => ({ available: true, reasonCode: null, profiles: state.profiles, activeCount: 0, executionAvailable: false, receipts: state.receipts });
const api: NativeAccountsApi = {
  async request(body) {
    state.requests.push({ ...body });
    if (body.action === 'remove-profile') {
      state.profiles = state.profiles.filter(row => row.id !== body.profileId);
      state.receipts = [...state.receipts, { actionId: body.actionId, kind: 'remove-profile', profileId: body.profileId, epoch: body.epoch, state: 'completed' }];
    } else if (body.action !== 'status') throw new Error(`Unexpected action: ${body.action}`);
    return snapshot();
  },
  async openVerificationUrl() { throw new Error('Sign-in unavailable in fixture'); },
};
createRoot(document.getElementById('root')!).render(createElement(NativeAccountsPanel, { api, language: 'en' }));
