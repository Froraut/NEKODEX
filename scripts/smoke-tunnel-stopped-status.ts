import assert from "node:assert/strict";
import { runtimeStatusReportsStopped } from "../src/tunnel-status";

const result = (body: unknown, status = 0) => ({ status, stdout: JSON.stringify(body), stderr: "" });
const stopped = { process_running: false, runtime_state: "stopped", healthy: false, ready: false };
for (const error of [undefined, null, ""]) {
  assert.equal(runtimeStatusReportsStopped(result({ ...stopped, error })), true);
}
for (const body of [
  { ...stopped, error: "status inspection failed" },
  { ...stopped, process_running: true },
  { runtime_state: "stopped", error: "" },
  { ...stopped, runtime_state: "unknown" },
]) assert.equal(runtimeStatusReportsStopped(result(body)), false);
assert.equal(runtimeStatusReportsStopped(result(stopped, 1)), false);
assert.equal(runtimeStatusReportsStopped({ status: 0, stdout: "not JSON", stderr: "" }), false);
console.log("Scoped SDK stopped proof accepts canonical no-error values and rejects uncertain ownership");
