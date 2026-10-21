import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { registerNativeAccounts } = createRequire(import.meta.url)('../launcher/electron/ipc/native-accounts.cjs');

test('Native account IPC keeps opaque action scope and opens/copies only its current device prompt', async () => {
  const handlers = new Map<string, Function>(), calls: any[] = [], opened: string[] = [], copied: string[] = [];
  const id = randomUUID(), epoch = randomUUID(), login = randomUUID(), actionId = randomUUID();
  const snapshot = { available: true, profiles: [{ id, epoch, state: 'fresh', label: 'Fixture' }] as any[], receipts: [], activeCount: 0, executionAvailable: false };
  const authority = { inspect: () => snapshot,
    prepareProfile: (input: any) => calls.push(['prepare', input]),
    beginDeviceLogin: (input: any) => calls.push(['login', input]),
    cancelLogin: async (input: any) => calls.push(['cancel', input]),
  };
  registerNativeAccounts({ handle: (name: string, handler: Function) => handlers.set(name, handler), getAuthority: () => authority,
    openExternal: async (url: string) => opened.push(url), clipboard: { writeText: (value: string) => copied.push(value) } });
  const request = (body: unknown) => handlers.get('launcher:native-accounts')!(null, body);
  expect(await request({ action: 'status' })).toEqual(snapshot); expect(calls).toHaveLength(0);
  await expect(request({ action: 'begin-device-login', actionId, profileId: id, epoch, executable: '/foreign' })).rejects.toThrow();
  expect(calls).toHaveLength(0);
  expect(await request({ action: 'begin-device-login', actionId, profileId: id, epoch })).toEqual(snapshot);
  expect(calls).toEqual([['login', { actionId, profileId: id, epoch }]]);
  const open = (url: string) => handlers.get('launcher:native-accounts-open')!(null, url);
  await expect(open('https://auth.openai.com/codex/device')).rejects.toThrow();
  snapshot.profiles[0].login = { id: login, state: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'DEVICE-CODE' };
  await expect(open('https://example.com')).rejects.toThrow();
  await open('https://auth.openai.com/codex/device'); expect(opened).toEqual(['https://auth.openai.com/codex/device']);
  const copy = (code: string) => handlers.get('launcher:native-accounts-copy')!(null, code);
  expect(() => copy('FOREIGN-CODE')).toThrow(); copy('DEVICE-CODE'); expect(copied).toEqual(['DEVICE-CODE']);
  snapshot.profiles[0].login.state = 'signed-in-checking';
  expect(() => copy('DEVICE-CODE')).toThrow();
  await expect(open('https://auth.openai.com/codex/device')).rejects.toThrow();
  await request({ action: 'cancel-login', actionId, loginAttemptId: login });
  expect(calls.at(-1)).toEqual(['cancel', { actionId, loginAttemptId: login }]);
  authority.beginDeviceLogin = () => { throw Object.assign(new Error('Known fixture precondition'), { actionRecorded: false }); };
  const refusedId = randomUUID();
  expect((await request({ action: 'begin-device-login', actionId: refusedId, profileId: id, epoch })).rejectedAction).toEqual({ actionId: refusedId, knownNotStarted: true });
  expect((await request({ action: 'status', actionId: refusedId })).rejectedAction).toEqual({ actionId: refusedId, knownNotStarted: true });
});

test('Native inventory IPC admits only inspected visible models and closes the exact account generation', async () => {
  const handlers = new Map<string, Function>(), profileId = randomUUID(), epoch = randomUUID();
  let ran = 0, admitted = 0, destroyed = 0, closed = 0, beforeClosed = 0;
  let held = true;
  const authority = { inspect: () => ({ available: true, profiles: [], receipts: [] }) };
  const inventory = { async run(body: any) { expect(body).toMatchObject({ profileId, epoch, explicitUserAction: true }); ran++; },
    trustedInventory: () => ({ picker: [{ id: 'native-one' }, { id: 'hidden', hidden: true }, { id: 'native-two' }, { id: 'native-three' }] }),
    inspect: () => ({ receipts: [], models: [], activeCount: 0, executionAvailable: false }) };
  const execution = { async admit(body: any) { expect(body).toMatchObject({ profileId, epoch, modelIds: ['native-one', 'native-two'] }); admitted++; },
    inspect: () => ({ profileId, epoch, ownerHeld: held, models: [] }), async destroy() { destroyed++; held = false; } };
  registerNativeAccounts({ handle: (name: string, handler: Function) => handlers.set(name, handler), getAuthority: () => authority,
    getInventory: () => inventory, getExecution: () => execution,
    beforeExecutionClosed: async (owner: any) => { expect(owner).toBe(execution); expect(destroyed).toBe(0); beforeClosed++; },
    onExecutionClosed: (owner: any) => { expect(beforeClosed).toBe(1); expect(owner).toBe(execution); closed++; },
    openExternal: async () => {}, clipboard: { writeText() {} } });
  const request = (body: any) => handlers.get('launcher:native-accounts')!(null, body);
  await request({ action: 'inspect-models', actionId: randomUUID(), profileId, epoch });
  expect([ran, admitted, destroyed]).toEqual([1, 1, 0]);
  await expect(request({ action: 'close-execution', actionId: randomUUID(), profileId, epoch: randomUUID() })).rejects.toThrow('scope changed');
  expect(destroyed).toBe(0);
  const actionId = randomUUID();
  const result = await request({ action: 'close-execution', actionId, profileId, epoch });
  expect([destroyed, closed]).toEqual([1, 1]);
  expect(result.receipts).toContainEqual({ actionId, kind: 'close-execution', profileId, epoch, state: 'completed' });
  expect((await request({ action: 'status', actionId })).receipts).toContainEqual({ actionId, kind: 'close-execution', profileId, epoch, state: 'completed' });
});

test('Native profile removal closes only the exact owned execution after explicit confirmation', async () => {
  const handlers = new Map<string, Function>(), profileId = randomUUID(), epoch = randomUUID(), removed: any[] = [];
  let held = true, destroyed = 0, beforeClosed = 0, closed = 0;
  const authority = { inspect: () => ({ available: true, profiles: [], receipts: [] }),
    removeProfile: (input: any) => removed.push(input) };
  const execution = { inspect: () => ({ profileId, epoch, ownerHeld: held, models: [] }), async destroy() { destroyed++; held = false; } };
  registerNativeAccounts({ handle: (name: string, handler: Function) => handlers.set(name, handler), getAuthority: () => authority,
    getExecution: () => execution, beforeExecutionClosed: async () => { beforeClosed++; }, onExecutionClosed: () => { closed++; },
    openExternal: async () => {}, clipboard: { writeText() {} } });
  const request = (body: any) => handlers.get('launcher:native-accounts')!(null, body);
  await expect(request({ action: 'remove-profile', actionId: randomUUID(), profileId, epoch, confirmSignedIn: 'yes' })).rejects.toThrow();
  await expect(request({ action: 'remove-profile', actionId: randomUUID(), profileId, epoch, path: '/foreign' })).rejects.toThrow();
  const refused = randomUUID();
  expect((await request({ action: 'remove-profile', actionId: refused, profileId, epoch })).rejectedAction).toEqual({ actionId: refused, knownNotStarted: true });
  expect([destroyed, removed.length]).toEqual([0, 0]);
  // Another profile's removal never touches this execution.
  const other = randomUUID(), otherEpoch = randomUUID();
  await request({ action: 'remove-profile', actionId: randomUUID(), profileId: other, epoch: otherEpoch });
  expect(destroyed).toBe(0); expect(removed.at(-1)).toMatchObject({ profileId: other, epoch: otherEpoch, confirmSignedIn: false });
  const actionId = randomUUID();
  await request({ action: 'remove-profile', actionId, profileId, epoch, confirmSignedIn: true });
  expect([beforeClosed, destroyed, closed]).toEqual([1, 1, 1]);
  expect(removed.at(-1)).toEqual({ actionId, profileId, epoch, confirmSignedIn: true });
});

test('Native profile removal refuses before side effects and retires account state only for a signed-in profile', async () => {
  const handlers = new Map<string, Function>(), order: string[] = [], profileId = randomUUID(), epoch = randomUUID();
  let signedIn = false, retireFails = false, refuse = false;
  const authority = { inspect: () => ({ available: true, profiles: [], receipts: [] }),
    checkRemovable: () => { order.push('check'); if (refuse) throw Object.assign(new Error('refused'), { actionRecorded: false }); return { signedIn }; },
    removeProfile: () => order.push('remove') };
  registerNativeAccounts({ handle: (name: string, handler: Function) => handlers.set(name, handler), getAuthority: () => authority,
    beforeProfileRemoved: async (scope: any) => { expect(scope).toEqual({ profileId, epoch }); order.push('retire'); if (retireFails) throw new Error('OAuth revocation failed'); },
    openExternal: async () => {}, clipboard: { writeText() {} } });
  const request = (body: any) => handlers.get('launcher:native-accounts')!(null, body);
  await request({ action: 'remove-profile', actionId: randomUUID(), profileId, epoch });
  expect(order).toEqual(['check', 'remove']);
  order.length = 0; refuse = true;
  const refusedId = randomUUID();
  expect((await request({ action: 'remove-profile', actionId: refusedId, profileId, epoch, confirmSignedIn: true })).rejectedAction).toEqual({ actionId: refusedId, knownNotStarted: true });
  expect(order).toEqual(['check']);
  order.length = 0; refuse = false; signedIn = true; retireFails = true;
  const failedId = randomUUID();
  expect((await request({ action: 'remove-profile', actionId: failedId, profileId, epoch, confirmSignedIn: true })).rejectedAction).toEqual({ actionId: failedId, knownNotStarted: true });
  expect(order).toEqual(['check', 'retire']);
  order.length = 0; retireFails = false;
  await request({ action: 'remove-profile', actionId: randomUUID(), profileId, epoch, confirmSignedIn: true });
  expect(order).toEqual(['check', 'retire', 'remove']);
});

test('an owned execution stays open until every refusal and the OAuth retirement have passed', async () => {
  const handlers = new Map<string, Function>(), order: string[] = [], profileId = randomUUID(), epoch = randomUUID();
  let held = true, retireFails = true;
  const authority = { inspect: () => ({ available: true, profiles: [], receipts: [] }),
    checkRemovable: (input: any) => { order.push(`check:${input.executionHeld}`); return { signedIn: true }; },
    removeProfile: () => order.push('remove') };
  const execution = { inspect: () => ({ profileId, epoch, ownerHeld: held, models: [] }), async destroy() { order.push('close'); held = false; } };
  registerNativeAccounts({ handle: (name: string, handler: Function) => handlers.set(name, handler), getAuthority: () => authority, getExecution: () => execution,
    beforeProfileRemoved: async () => { order.push('retire'); if (retireFails) throw new Error('A pending OAuth authorization owns the provider'); },
    openExternal: async () => {}, clipboard: { writeText() {} } });
  const request = (body: any) => handlers.get('launcher:native-accounts')!(null, body);
  const failed = randomUUID();
  expect((await request({ action: 'remove-profile', actionId: failed, profileId, epoch, confirmSignedIn: true })).rejectedAction).toEqual({ actionId: failed, knownNotStarted: true });
  expect(order).toEqual(['check:true', 'retire']); expect(held).toBe(true);
  order.length = 0; retireFails = false;
  await request({ action: 'remove-profile', actionId: randomUUID(), profileId, epoch, confirmSignedIn: true });
  expect(order).toEqual(['check:true', 'retire', 'close', 'remove']);
});
