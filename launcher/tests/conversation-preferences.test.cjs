const test = require("node:test");
const assert = require("node:assert/strict");
const { syncConversationPreferences, changeConversationPreference } = require("../electron/conversation-preferences.cjs");
const { createLifecycleAdmission } = require("../electron/lifecycle-admission.cjs");
const { AccountBrowserPool } = require("../electron/account-pool.cjs");
const { RuntimeHost } = require("../electron/runtime.cjs");

function fixture() {
  let state = { useSavedChats: false, experimentalFreshConversationPerTurn: false };
  const released = [], published = [];
  return {
    stateStore: { read: () => state, update: patch => (state = { ...state, ...patch }) },
    browserHost: {
      turnTabs: new Map([
        ["automatic", { status: "ready", interactionMode: "automatic", conversationKey: "automatic" }],
        ["manual", { status: "ready", interactionMode: "manual", conversationKey: "manual" }],
        ["running", { status: "running", interactionMode: "automatic", conversationKey: "running" }],
      ]),
      releaseRetainedConversation: key => released.push(key),
    },
    publish: state => published.push(state), released, published,
  };
}

test("saved-chat changes retire ready conversations in both modes and preserve running work", () => {
  const f = fixture();
  const config = { useSavedChats: true, experimentalFreshConversationPerTurn: false };
  assert.equal(syncConversationPreferences({ ...f, config }).useSavedChats, true);
  assert.deepEqual(f.released, ["automatic", "manual"]);
  assert.equal(f.published.length, 1);
  syncConversationPreferences({ ...f, config });
  assert.equal(f.released.length, 2);
  assert.equal(f.published.length, 1);
});

test("fresh-chat changes are independent of saved history and wait for the transition owner", () => {
  const f = fixture();
  const config = { useSavedChats: false, experimentalFreshConversationPerTurn: true };
  assert.equal(syncConversationPreferences({ ...f, config, busy: true }).experimentalFreshConversationPerTurn, false);
  assert.deepEqual(f.released, []);
  assert.deepEqual(syncConversationPreferences({ ...f, config }), config);
  assert.deepEqual(f.released, ["automatic"]);
});

test("failed retirement does not claim that a new retention policy was published", () => {
  const f = fixture();
  f.browserHost.releaseRetainedConversation = () => { throw new Error("owner changed"); };
  assert.throws(() => syncConversationPreferences({ ...f, config: { useSavedChats: true } }), /owner changed/);
  assert.equal(f.stateStore.read().useSavedChats, false);
  assert.deepEqual(f.published, []);
});

test("saved-chat setup uses isolated DEV settings and requires a committed preference", async () => {
  let config = { useSavedChats: false, autoApproveToolCalls: true };
  const invocations = [];
  const host = {
    launcherProfile: "development", browserDescriptorPath: "/fixture/browser.json",
    runtimeConfigSnapshot: () => ({ configured: true, mode: "full", config }),
    browserInteractionArgs: () => ["--browser-interaction-mode", "automatic"],
    runSetup: () => assert.fail("DEV must not change the production route"),
    runDevSetup: async (_name, args) => {
      invocations.push(args);
      config = { ...config, useSavedChats: args.includes("--saved-chats") };
      return { status: "ok" };
    },
  };
  assert.equal((await RuntimeHost.prototype.setUseSavedChats.call(host, true)).enabled, true);
  assert.equal(invocations[0].includes("--replace-codex-route"), false);
  assert.equal(invocations[0].includes("--auto-approve-tool-calls"), true);
  assert.equal((await RuntimeHost.prototype.setUseSavedChats.call(host, false)).enabled, false);
  host.runDevSetup = async () => ({ status: "ok" });
  await assert.rejects(RuntimeHost.prototype.setUseSavedChats.call(host, true), /did not persist/);
  await assert.rejects(RuntimeHost.prototype.setUseSavedChats.call(host, "true"), /must be a boolean/);
});

test("conversation policy change excludes reserved turns and competing transitions until settlement", async () => {
  const admission = createLifecycleAdmission();
  let open = true, reserved = true, changes = 0;
  const browserHost = {
    closeTurnAdmission: () => { open = false; }, openTurnAdmission: () => { open = true; },
    setTurnAdmissionBlocker: () => {},
    hasActiveTurns: () => reserved, currentOperation: () => null,
  };
  const options = { lifecycleAdmission: admission, browserHost, runtimeHost: { currentOperation: () => null },
    label: "conversation change", sync: lease => { admission.assertOwner(lease); return "saved"; }, shouldReopen: () => true };
  await assert.rejects(changeConversationPreference({ ...options, change: async () => { changes++; } }), /Finish active tasks/);
  assert.equal(changes, 0);
  assert.equal(open, true);
  reserved = false;
  let settle;
  const pending = changeConversationPreference({ ...options, change: () => new Promise(resolve => { settle = resolve; }) });
  assert.equal(open, false);
  await assert.rejects(changeConversationPreference({ ...options, change: async () => {} }), /Wait for conversation change/);
  assert.equal(open, false);
  settle();
  assert.equal(await pending, "saved");
  assert.equal(open, true);
  assert.equal(admission.busy(), false);
});

test("committed policy with a failed projection pauses new turns until successful retry", async () => {
  const admission = createLifecycleAdmission();
  let committed = false;
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    turnAdmission: { open: true, reason: null }, turnAdmissionRevision: 0,
    turnAdmissionBlockers: new Map(), inspectionsPaused: false,
    hasActiveTurns: () => false, currentOperation: () => null,
  });
  const options = {
    lifecycleAdmission: admission, label: "saved chat policy",
    browserHost: pool,
    runtimeHost: { currentOperation: () => null },
    change: async () => { committed = true; },
    sync: () => { throw new Error("state write failed"); }, shouldReopen: () => true,
  };
  await assert.rejects(changeConversationPreference(options), /policy was saved.*turns are paused/);
  assert.equal(committed, true); // The intended fault follows the actual commit boundary.
  assert.equal(pool.turnAdmission.open, false);
  pool.closeTurnAdmission("unrelated preference");
  pool.openTurnAdmission(); // Another operation cannot release this recovery owner.
  assert.equal(pool.turnAdmission.open, false);
  assert.match(pool.turnAdmission.reason, /conversation policy recovery/);
  assert.equal(admission.busy(), false); // The user can retry the setting.
  const state = await changeConversationPreference({ ...options, sync: () => ({ useSavedChats: committed }) });
  assert.deepEqual(state, { useSavedChats: true });
  assert.equal(pool.turnAdmission.open, true);
});
