import { classifyCanonicalText } from "../../launcher/electron/canonical-history-policy.cjs";
import type { ExecutionRequest } from "./types";

function identity(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()) && value.length <= 160 && !/[\u0000-\u001f]/u.test(value); }

/** Historical receipts are informational data. They cannot resolve a pending call or grant authority. */
export function projectPriorToolContext(request: ExecutionRequest) {
  const context = request.priorToolContext;
  let complete = context?.complete ?? true;
  const ancestors = new Set<object>();
  function safe(value: unknown, depth = 0): unknown {
    if (typeof value === "string") {
      if (classifyCanonicalText(value) === "known-secret-content") { complete = false; return "[historical sensitive text omitted]"; }
      const redacted = value
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]")
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "[redacted authorization]")
        .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g, "[redacted credential]")
        .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[redacted]");
      if (redacted !== value) complete = false;
      if (/data:image\//i.test(redacted)) { complete = false; return "[historical image data omitted]"; }
      if (Buffer.byteLength(redacted) <= 8192) return redacted;
      complete = false;
      return Buffer.from(redacted).subarray(0, 8000).toString("utf8") + "[historical text truncated]";
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (!value || typeof value !== "object" || depth >= 8 || ancestors.has(value)) { complete = false; return "[historical value omitted]"; }
    ancestors.add(value);
    try {
      if (!Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (["image", "input_image", "output_image", "image_url"].includes(String(record.type)) || "image_url" in record
          || typeof record.mimeType === "string" && record.mimeType.startsWith("image/")) {
          complete = false;
          return { type: "historical-image", imageDelivery: { state: "omitted" } };
        }
      }
      if (Array.isArray(value)) {
        if (value.length > 64) complete = false;
        return value.slice(0, 64).map(item => safe(item, depth + 1));
      }
      const entries = Object.entries(value);
      if (entries.length > 64) complete = false;
      return Object.fromEntries(entries.slice(0, 64).map(([key, item]) => {
        if (/(?:password|passwd|secret|token|authorization|cookie|private.?key|api.?key|credential|^(?:data|blob|base64)$)/i.test(key)) {
          complete = false; return [key, "[redacted]"];
        }
        return [key, safe(item, depth + 1)];
      }));
    } finally { ancestors.delete(value); }
  }
  const receipts: unknown[] = [];
  for (const row of context?.receipts ?? []) {
    const outcome = row.outcome;
    if (!outcome || outcome.scope.taskId !== request.task.id || !Number.isSafeInteger(outcome.scope.generation)
      || outcome.scope.generation < 1 || outcome.scope.generation > request.task.generation || !Number.isSafeInteger(row.taskRevision)
      || row.taskRevision < 1 || row.taskRevision > request.task.revision || !identity(row.dispatchId) || !identity(row.stageId)
      || !identity(outcome.scope.toolCallId) || !identity(outcome.idempotencyKey) || !["completed", "failed", "outcome_unknown"].includes(outcome.state)) {
      complete = false; continue;
    }
    const receipt = {
      provenance: { kind: "host-retained-tool-receipt", dispatchId: row.dispatchId, stageId: row.stageId, taskId: request.task.id,
        generation: outcome.scope.generation, taskRevision: row.taskRevision, toolCallId: outcome.scope.toolCallId, receipt: outcome.idempotencyKey,
        currentScope: outcome.scope.generation === request.task.generation && row.taskRevision === request.task.revision },
      tool: outcome.tool, state: outcome.state,
      ...(outcome.state === "outcome_unknown" ? { result: "[unknown outcome has no result evidence]" } : { result: safe(outcome.result ?? null) }),
      ...(outcome.reason ? { reason: safe(outcome.reason) } : {}),
    };
    if (receipts.length >= 16 || Buffer.byteLength(JSON.stringify([...receipts, receipt])) > 48 * 1024) { complete = false; continue; }
    receipts.push(receipt);
  }
  return { authority: "inert-historical-data-only", complete, receipts };
}
