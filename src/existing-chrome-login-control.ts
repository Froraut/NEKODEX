/** A private launcher pipe can cancel the importer, never the user's Chrome process. */
export function createExistingChromeLoginControl(input: NodeJS.ReadStream = process.stdin) {
  const controller = new AbortController();
  let pending = "";
  let closed = false;
  const abort = () => controller.abort(new Error("Existing Chrome sign-in cancelled"));
  const onData = (chunk: Buffer | string) => {
    pending += chunk.toString();
    if (Buffer.byteLength(pending) > 4096) return abort();
    while (pending.includes("\n")) {
      const end = pending.indexOf("\n");
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { return abort(); }
      if (message?.version !== 1 || message.type !== "existing-chrome-login-cancel"
        || Object.keys(message).some(key => !["version", "type"].includes(key))) return abort();
      abort();
    }
  };
  const onEnd = () => { if (!closed) abort(); };
  input.on("data", onData);
  input.once("end", onEnd);
  input.once("error", onEnd);
  input.resume();
  return {
    signal: controller.signal,
    close() {
      closed = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onEnd);
      input.pause();
    },
  };
}
