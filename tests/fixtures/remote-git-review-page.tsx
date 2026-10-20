import { createElement, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import RemoteGitReview from '../../launcher/src/RemoteGitReview';
import type { RemoteHost } from '../../launcher/src/remote-workspace-types';
import type { RemoteGitReviewApi, RemoteGitReviewAction, RemoteGitReviewCapture, RemoteGitReviewRepository, RemoteGitReviewTarget } from '../../launcher/electron/remote-git-review.cjs';

const target: RemoteGitReviewTarget = { hostId: 'fixture', fingerprint: 'a'.repeat(64), connectionId: 'connection-1', root: '/owned-fixture', hostname: 'inert.invalid', username: 'qa', port: 22 };
const repo: RemoteGitReviewRepository = { rootIdentity: 'root-1', gitDir: '/owned-fixture/.git', gitIdentity: 'git-1', commonDir: '/owned-fixture/.git', commonIdentity: 'common-1', headOid: '1'.repeat(40), headRef: 'refs/heads/fixture', indexDigest: 'b'.repeat(64), mergeHeads: [], mergeStateDigest: 'c'.repeat(64), objectFormat: 'sha1' };
const host: RemoteHost = { id: 'fixture', label: 'Inert Git QA', hostname: target.hostname, username: target.username, port: 22, root: target.root, canonicalRoot: target.root, fingerprint: target.fingerprint, connected: true, busy: false };
const state = { requests: [] as any[], actions: [] as RemoteGitReviewAction[], applies: [] as string[], opened: [] as string[],
  resolved: false, staged: false, loseFirstApply: true, settleHeld: false, staleDiff: false, holdDiff: false, diffPending: false,
  release: () => {}, enable: () => {}, changeRoot: () => {}, russian: () => {} };
(window as any).fixture = state;
const capture = (): RemoteGitReviewCapture => ({ captureId: 'capture-current', target, repository: repo,
  baseOid: repo.headOid, baseRef: repo.headRef, fingerprint: 'd'.repeat(64), truncated: false, limitations: ['global_and_system_git_configuration_and_attributes_disabled'], createdAt: '2026-10-19T00:00:00Z',
  entries: [{ path: 'conflict.txt', indexStatus: state.resolved ? state.staged ? 'M' : ' ' : 'U', worktreeStatus: state.resolved ? state.staged ? ' ' : 'M' : 'U',
    kind: state.resolved ? 'tracked' : 'conflict', ...(!state.resolved ? { stages: [{ stage: 1, mode: '100644', oid: '1'.repeat(40) }, { stage: 2, mode: '100644', oid: '2'.repeat(40) }, { stage: 3, mode: '100644', oid: '3'.repeat(40) }] } : {}) },
    { path: 'already-staged.txt', indexStatus: 'M', worktreeStatus: ' ', kind: 'tracked' }] });
const api: RemoteGitReviewApi = {
  async remoteGitListActions(id) { state.requests.push({ action: 'list', id }); return structuredClone(state.actions); },
  async remoteGitBases(id) { state.requests.push({ action: 'bases', id }); return { state: 'ready', target, repository: repo, choices: [{ baseId: 'head', kind: 'head', ref: repo.headRef, oid: repo.headOid }, { baseId: 'older', kind: 'local', ref: 'refs/heads/base', oid: '0'.repeat(40) }], truncated: false }; },
  async remoteGitCapture(id, input) { state.requests.push({ action: 'capture', id, input }); return structuredClone(capture()); },
  async remoteGitDiff(id, input) {
    state.requests.push({ action: 'diff', id, input });
    if (state.holdDiff) { state.diffPending = true; await new Promise<void>(resolve => { state.release = resolve; }); return { ...input, state: 'current', text: 'LATE_FOREIGN_SCOPE', binary: false, truncated: false, headOid: repo.headOid, baseOid: repo.headOid }; }
    return { ...input, state: state.staleDiff ? 'stale' : 'current', text: state.staleDiff ? '' : input.kind === 'conflict' ? `stage ${input.stage}: original conflict source` : 'RETAINED_DIFF\n-before\n+reviewed candidate', binary: false, truncated: false, ...(state.staleDiff ? { reason: 'External index changed; prior capture is stale.' } : {}), headOid: repo.headOid, baseOid: repo.headOid };
  },
  async remoteGitPrepare(id, input) {
    state.requests.push({ action: 'prepare', id, input });
    const paths = input.operation === 'commit' ? ['already-staged.txt'] : input.paths!;
    const row: RemoteGitReviewAction = { actionId: input.actionId, hostId: id, target, operation: input.operation, reviewDigest: 'e'.repeat(64), state: 'reviewed', ownerHeld: false, terminal: false,
      review: { headOid: repo.headOid, headRef: repo.headRef, indexDigest: repo.indexDigest, paths, parents: [repo.headOid!],
        ...(input.operation === 'commit' ? { message: input.message, author: input.author,
          stagedEntries: [{ path: 'already-staged.txt', mode: '100644', oid: '6'.repeat(40), stage: 0 }, { path: 'unchanged-in-tree.txt', mode: '100755', oid: '7'.repeat(40), stage: 0 }] } : {}),
        files: paths.map(path => ({ path, mode: '100644', revision: 'f'.repeat(64), bytes: 20, remove: false })), limitations: [] }, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z' };
    state.actions.push(row); return structuredClone(row);
  },
  async remoteGitApply(id, input) {
    state.requests.push({ action: 'apply', id, input }); state.applies.push(input.actionId);
    const row = state.actions.find(row => row.actionId === input.actionId)!;
    if (row.operation === 'stage') state.staged = true;
    if (row.operation === 'unstage') state.staged = false;
    if (state.loseFirstApply) { state.loseFirstApply = false; Object.assign(row, { state: 'unknown', ownerHeld: true, terminal: false }); throw new Error('Lost observation; original action retained.'); }
    Object.assign(row, { state: 'completed', ownerHeld: false, terminal: true, ...(row.operation === 'commit' ? { result: { commitOid: '4'.repeat(40), treeOid: '5'.repeat(40) } } : {}) });
    return structuredClone(row);
  },
  async remoteGitInspectAction(id, actionId) {
    state.requests.push({ action: 'inspect', id, actionId }); const row = state.actions.find(row => row.actionId === actionId);
    if (row && state.settleHeld && row.state === 'unknown') Object.assign(row, { state: 'completed', terminal: true, ownerHeld: false });
    return row ? structuredClone(row) : null;
  },
  async remoteGitPruneActions(id, actionIds) {
    state.requests.push({ action: 'prune', id, actionIds });
    const selected = state.actions.filter(row => actionIds.includes(row.actionId));
    if (selected.some(row => row.ownerHeld || !['reviewed', 'completed', 'failed'].includes(row.state))) throw new Error('Held/unknown history must remain retained');
    state.actions = state.actions.filter(row => !actionIds.includes(row.actionId));
    return { removed: selected.length };
  },
};
function Fixture() {
  const [disabled, setDisabled] = useState(true), [currentHost, setHost] = useState(host);
  const [language, setLanguage] = useState<'en' | 'ru'>('en');
  state.enable = () => setDisabled(false);
  state.changeRoot = () => setHost({ ...host, root: '/new-scope', canonicalRoot: '/new-scope' });
  state.russian = () => setLanguage('ru');
  return createElement(RemoteGitReview, { api, host: currentHost, language, disabled,
    onOpenFile: async (path: string) => { state.opened.push(path); } });
}
createRoot(document.getElementById('root')!).render(createElement(Fixture));
