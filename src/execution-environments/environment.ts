import { isActionId, isSha256, sha256, vmAssert } from './protocol';
import { admitVmRuntime, vmRuntimeProtectedPaths, type AdmittedVmRuntime, type VmRuntimeSelection } from './executor';

export interface VmEnvironmentReview {
  actionId: string; reviewDigest: string; helperSha256: string; guestManifestSha256: string;
  cpuCount: 2; memoryBytes: 2147483648; network: false; hostShares: false;
  state: 'reviewed' | 'preparing' | 'prepared' | 'failed'; reason?: string;
}
export interface VmEnvironmentStatus {
  supported: boolean; prepared: boolean; runtimeDigest?: string; reason?: string; review?: VmEnvironmentReview;
}
/** Main-injected fixed artifact selection; no HTTP/renderer executable paths,
 * downloads, VM launch or automatic admission during construction/status. */
export class VmEnvironmentController {
  private readonly selection?: VmRuntimeSelection;
  private readonly actions = new Map<string, VmEnvironmentReview>();
  private latest?: string;
  private runtime?: AdmittedVmRuntime;
  constructor(selection?: VmRuntimeSelection) { this.selection = selection && Object.freeze({ ...selection, ...(selection.production ? { production: Object.freeze({ ...selection.production }) } : {}) }); }
  status(): VmEnvironmentStatus {
    if (this.runtime) {
      try { vmRuntimeProtectedPaths(this.runtime); }
      catch { this.runtime = undefined; const row = this.latest ? this.actions.get(this.latest) : undefined;
        if (row?.state === 'prepared') { row.state = 'failed'; row.reason = 'The admitted runtime artifacts changed; a new reviewed preparation is required'; } }
    }
    const supported = process.platform === 'darwin' && process.arch === 'arm64' && Boolean(this.selection);
    return { supported, prepared: Boolean(this.runtime), ...(this.runtime ? { runtimeDigest: this.runtime.runtimeDigest } : {}),
      ...(!supported ? { reason: 'The fixed offline Linux VM runtime is not supplied in this application layout' }
        : !this.runtime ? { reason: 'Review and explicitly prepare the selected offline Linux runtime' } : {}),
      ...(this.latest ? { review: structuredClone(this.actions.get(this.latest)!) } : {}) };
  }
  getRuntime(): AdmittedVmRuntime | undefined { return this.runtime; }
  review(actionId: string, explicit: boolean): VmEnvironmentStatus {
    vmAssert(explicit && isActionId(actionId) && this.status().supported && this.selection, 'vm-explicit-review-required');
    if (this.actions.has(actionId)) { this.latest = actionId; return this.status(); }
    vmAssert(this.actions.size < 32, 'vm-review-capacity');
    const selected = this.selection;
    vmAssert([selected.helperSha256, selected.helperManifestSha256, selected.kernelSha256, selected.initrdSha256, selected.guestManifestSha256].every(isSha256), 'vm-runtime-selection-invalid');
    const review: VmEnvironmentReview = { actionId, reviewDigest: sha256(JSON.stringify({ selection: selected, policy: 1 })),
      helperSha256: selected.helperSha256, guestManifestSha256: selected.guestManifestSha256,
      cpuCount: 2, memoryBytes: 2147483648, network: false, hostShares: false, state: 'reviewed' };
    this.actions.set(actionId, review); this.latest = actionId; return this.status();
  }
  prepare(actionId: string, reviewDigest: string, explicit: boolean): VmEnvironmentStatus {
    const row = this.actions.get(actionId);
    vmAssert(explicit && row && row.reviewDigest === reviewDigest && this.selection, 'vm-exact-review-required');
    this.latest = actionId;
    if (row.state !== 'reviewed') return this.status(); // lost ACK never repeats preparation
    row.state = 'preparing';
    try { this.runtime = admitVmRuntime(this.selection); row.state = 'prepared'; }
    catch { row.state = 'failed'; row.reason = 'The selected helper, signature or guest artifacts could not be admitted'; }
    return this.status();
  }
}
