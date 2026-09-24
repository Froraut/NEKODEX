/** A private launcher pipe can cancel the importer, never the user's Chrome process. */
import type { ExistingChromeProfileClaim } from "./existing-chrome-login";

export function createExistingChromeLoginControl(input: NodeJS.ReadStream = process.stdin,
  { selectedDiscovery = false, selectedProfileClaim = false } = {}) {
  const controller = new AbortController();
  let pending = "";
  let closed = false;
  let discoveryReceived = false;
  let profileClaimReceived = false;
  let resolveDiscovery: ((contents: string) => void) | undefined;
  let rejectDiscovery: ((error: Error) => void) | undefined;
  const discoveryData = selectedDiscovery ? new Promise<string>((resolve, reject) => {
    resolveDiscovery = resolve; rejectDiscovery = reject;
  }) : undefined;
  let resolveProfileClaim: ((claim: ExistingChromeProfileClaim) => void) | undefined;
  let rejectProfileClaim: ((error: Error) => void) | undefined;
  const profileClaim = selectedProfileClaim ? new Promise<ExistingChromeProfileClaim>((resolve, reject) => {
    resolveProfileClaim = resolve; rejectProfileClaim = reject;
  }) : undefined;
  // A control error can arrive before the caller begins awaiting discoveryData.
  void discoveryData?.catch(() => {});
  void profileClaim?.catch(() => {});
  const abort = () => {
    const error = new Error("Existing Chrome sign-in cancelled");
    controller.abort(error);
    rejectDiscovery?.(error);
    rejectProfileClaim?.(error);
  };
  const onData = (chunk: Buffer | string) => {
    pending += chunk.toString();
    if (Buffer.byteLength(pending) > 4096) return abort();
    while (pending.includes("\n")) {
      const end = pending.indexOf("\n");
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { return abort(); }
      if (message?.version !== 1 || !message || typeof message !== "object" || Array.isArray(message)) return abort();
      if (message.type === "existing-chrome-discovery" && selectedDiscovery && !discoveryReceived
        && Object.keys(message).length === 3 && typeof message.contents === "string"
        && Buffer.byteLength(message.contents) <= 2048) {
        discoveryReceived = true;
        resolveDiscovery?.(message.contents);
      } else if (message.type === "existing-chrome-profile-claim" && selectedProfileClaim && !profileClaimReceived
        && Object.keys(message).length === 3 && message.claim && typeof message.claim === "object"
        && !Array.isArray(message.claim) && Buffer.byteLength(JSON.stringify(message.claim)) <= 1024) {
        profileClaimReceived = true;
        resolveProfileClaim?.(message.claim as ExistingChromeProfileClaim);
      } else if (message.type === "existing-chrome-login-cancel"
        && Object.keys(message).every(key => ["version", "type"].includes(key))) abort();
      else return abort();
    }
  };
  const onEnd = () => { if (!closed) abort(); };
  input.on("data", onData);
  input.once("end", onEnd);
  input.once("error", onEnd);
  input.resume();
  return {
    signal: controller.signal,
    discoveryData,
    profileClaim,
    close() {
      if (selectedDiscovery && !discoveryReceived) rejectDiscovery?.(new Error("Existing Chrome discovery channel closed"));
      if (selectedProfileClaim && !profileClaimReceived) rejectProfileClaim?.(new Error("Existing Chrome profile claim channel closed"));
      closed = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onEnd);
      input.pause();
    },
  };
}
