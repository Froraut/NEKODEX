// Production presentation with an inert authority: no filesystem, account or model operations.
import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { NativeAccountsPanel } from '../../launcher/src/NativeAccountsPanel';
import type { NativeAccountsApi, NativeAccountsRequest, NativeAccountsSnapshot } from '../../launcher/src/native-accounts-types';
import type { NativeOwnerRecoveryPreview, NativeOwnerRecoveryReceipt } from '../../launcher/electron/native-account-recovery.cjs';

const state = { requests: [] as Array<{ action: string; actionId?: string; reviewDigest?: string }>,
  plan: 'a', blocked: false, observedAt: 1, phase: 'prepared', actionId: '', recoveries: 0 };
(window as any).fixture = state;
const base = (): NativeAccountsSnapshot => ({ available: false, reasonCode: 'owner-stale', profiles: [], activeCount: 0, executionAvailable: false, recoverySupported: true, receipts: [] });
const preview = (): NativeOwnerRecoveryPreview => ({ state: state.blocked ? 'blocked' : 'reviewable',
  ...(state.blocked ? { reasonCode: 'owner-live' } : { reviewDigest: state.plan.repeat(64) }), observedAt: state.observedAt,
  markers: [{ kind: 'authority', sha256: 'c'.repeat(64), formerPid: 123456, profileId: 'fixture-profile', epoch: 'fixture-epoch' }], unsettledActionCount: 2 });
const receipt = (): NativeOwnerRecoveryReceipt => ({ actionId: state.actionId, reviewDigest: 'b'.repeat(64),
  state: state.phase as NativeOwnerRecoveryReceipt['state'], ownerHeld: state.phase !== 'completed', terminal: state.phase === 'completed',
  archivedCount: state.phase === 'completed' ? 1 : 0, unsettledActionCount: 2 });
const api: NativeAccountsApi = {
  async request(body) {
    state.requests.push({ ...body });
    if (body.action === 'status') return { ...base(), ...(body.actionId === state.actionId && state.actionId ? { recoveryReceipt: receipt() } : {}) };
    if (body.action === 'preview-owner-recovery') return { ...base(), recoveryPreview: preview() };
    if (body.action === 'recover-owner') {
      state.recoveries++; state.actionId = body.actionId;
      return { ...base(), recoveryReceipt: receipt() };
    }
    throw new Error(`Unexpected action: ${(body as NativeAccountsRequest).action}`);
  },
  async openVerificationUrl() { throw new Error('Sign-in unavailable in fixture'); },
};
createRoot(document.getElementById('root')!).render(createElement(NativeAccountsPanel, { api, language: 'en' }));
