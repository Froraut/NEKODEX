export type { RemoteWorkspaceApi, RemoteHost, RemoteHostInput, RemoteListing, RemotePreview, RemoteDraft,
  RemoteReceipt, RemoteCommandApproval, RemoteCommandResult, RemoteOperationCancellation } from '../electron/remote-workspace.cjs';
export type { RemoteGitReviewAction, RemoteGitReviewBases, RemoteGitReviewCapture, RemoteGitReviewDiff, RemoteGitReviewEntry, RemoteGitReviewPrepareInput, RemoteGitReviewSummary } from '../electron/remote-git-review.cjs';

import type { RemoteHost, RemoteHostInput } from '../electron/remote-workspace.cjs';

/** A new root inherits the saved connection, including explicit alias overrides. */
export function remoteHostForRoot(host: RemoteHost, root: string, label: string): RemoteHostInput {
  if (host.connectionMode === 'ssh-config-alias') {
    if (!host.configuredEndpoint) throw new Error('Reload this SSH alias before opening a new root.');
    return { label, ...host.configuredEndpoint, root };
  }
  return { label, hostname: host.hostname, username: host.username, port: host.port, root };
}
