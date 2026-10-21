import { expect, test } from 'bun:test';
import { nativeModelsOfflineTarget } from '../launcher/src/native-models-offline';
import type { NativeAccountProfile, NativeAccountsSnapshot } from '../launcher/src/native-accounts-types';

const profile = (id: string, state: NativeAccountProfile['state'] = 'signed-in-checking', login?: NativeAccountProfile['login']): NativeAccountProfile =>
  ({ id, epoch: `${id}-epoch`, label: `${id} label`, state, ...(login ? { login } : {}) });
const receipt = (profileId: string, updatedAt: number, state: 'completed' | 'unknown' | 'running' = 'completed', ownerHeld = false) => ({
  actionId: `${profileId}-${updatedAt}`, profileId, epoch: `${profileId}-epoch`, state, phase: 'complete' as const, ownerHeld, createdAt: updatedAt, updatedAt });
const snapshot = (overrides: Partial<NativeAccountsSnapshot> = {}): NativeAccountsSnapshot => ({
  available: true, reasonCode: null, profiles: [], activeCount: 0, executionAvailable: false, receipts: [], ...overrides });
const execution = (ownerHeld: boolean, models: unknown[]) => ({ models, profileId: 'a', epoch: 'a-epoch', server: null, ownerHeld, failed: false }) as unknown as NativeAccountsSnapshot['execution'];

test('a signed-in profile without a ready execution after restart is offline and targets the last inspected profile', () => {
  // After a restart main holds no execution; durable receipts survive but never restore a catalog.
  const restarted = snapshot({ profiles: [profile('older'), profile('alex')],
    inventory: { activeCount: 0, receipts: [receipt('older', 10), receipt('alex', 20)], models: [], executionAvailable: false },
    execution: execution(false, []) });
  expect(nativeModelsOfflineTarget(restarted)).toEqual({ profileId: 'alex', epoch: 'alex-epoch', label: 'alex label', checking: false, lastCheckUnconfirmed: false });
  // Without any receipt, the authority's order decides.
  expect(nativeModelsOfflineTarget(snapshot({ profiles: [profile('first'), profile('second')] }))?.profileId).toBe('first');
});

test('only a confirmed, check-able state shows the banner', () => {
  expect(nativeModelsOfflineTarget(null)).toBeNull();
  expect(nativeModelsOfflineTarget(snapshot({ available: false, profiles: [profile('a')] }))).toBeNull();
  // Not signed in, unknown outcome or a live login: the panel's own actions apply, not inventory.
  expect(nativeModelsOfflineTarget(snapshot({ profiles: [profile('a', 'fresh'), profile('b', 'auth-outcome-unknown'), profile('c', 'login-failed')] }))).toBeNull();
  expect(nativeModelsOfflineTarget(snapshot({ profiles: [profile('a', 'signed-in-checking', { id: 'l', state: 'pending' })] }))).toBeNull();
  // A ready execution means models are online; a held preparing/failed owner is closed explicitly first.
  expect(nativeModelsOfflineTarget(snapshot({ profiles: [profile('a')], execution: execution(true, [{ id: 'gpt' }]) }))).toBeNull();
  expect(nativeModelsOfflineTarget(snapshot({ profiles: [profile('a')], execution: execution(true, []) }))).toBeNull();
});

test('a running inspection is reported as checking and an unconfirmed last check is surfaced without replay', () => {
  const running = nativeModelsOfflineTarget(snapshot({ profiles: [profile('a')],
    inventory: { activeCount: 1, receipts: [receipt('a', 5, 'running', true)], models: [], executionAvailable: false } }));
  expect(running).toMatchObject({ profileId: 'a', checking: true, lastCheckUnconfirmed: false });
  const unknown = nativeModelsOfflineTarget(snapshot({ profiles: [profile('a')],
    inventory: { activeCount: 0, receipts: [receipt('a', 4), receipt('a', 9, 'unknown')], models: [], executionAvailable: false } }));
  expect(unknown).toMatchObject({ checking: false, lastCheckUnconfirmed: true });
});
