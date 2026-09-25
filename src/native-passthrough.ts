import { fetchNativeCodex } from "./native-network";
import { enqueueNativeUsageTelemetry } from "./native-usage-telemetry";
import { codexClientVersionFromUserAgent, NativeRequestBodyError, prepareNativeRequestBody, type NativeCodexEndpoint } from "./native-request-preparation";
import { failureCategoryForHttp, observeNativeResponseBody, withUncleanCloseTolerance } from "./native-response-body";
import type { NativeUsageFailureCategory, NativeUsageOutcome, NativeUsageTelemetryEvent } from "./usage/native-contract";
export type { NativeImageEndpoint } from "./native-request-preparation";

const CODEX_BACKEND = "https://chatgpt.com/backend-api/codex";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/** Fetch-compatible transport: response bodies use the runtime's automatic decompression. */
export type NativeFetch = (request: Request) => Promise<Response>;

function nativeDiagnosticId(value: string | null): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function endToEndHeaders(source: Headers): Headers {
  const hopByHopHeaders = new Set(HOP_BY_HOP_HEADERS);
  for (const name of (source.get("connection") ?? "").split(",")) {
    const normalized = name.trim().toLowerCase();
    if (normalized) hopByHopHeaders.add(normalized);
  }
  const headers = new Headers();
  for (const [name, value] of source) {
    if (!hopByHopHeaders.has(name.toLowerCase())) headers.append(name, value);
  }
  headers.delete("content-length");
  return headers;
}

function localRequestFailure(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ error: { type, code: null, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function forwardNativeCodexRequest(
  request: Request,
  endpoint: NativeCodexEndpoint,
  fetchUpstream: NativeFetch = fetchNativeCodex,
  decodedBody?: unknown,
): Promise<Response> {
  const telemetryStartedAtMs = Date.now();
  const telemetryStartedAt = new Date(telemetryStartedAtMs).toISOString();
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    void request.body?.cancel().catch(() => {});
    return localRequestFailure(401, "authentication_error", "Native Codex passthrough requires the incoming Bearer authorization");
  }

  const incomingUrl = new URL(request.url);
  if (endpoint === "models" && !incomingUrl.searchParams.has("client_version")) {
    const clientVersion = codexClientVersionFromUserAgent(request.headers.get("user-agent"));
    if (clientVersion) incomingUrl.searchParams.set("client_version", clientVersion);
  }
  const headers = endToEndHeaders(request.headers);
  if (endpoint === "models") headers.delete("if-none-match");
  const method = endpoint === "models" ? "GET" : "POST";
  let preparation: Awaited<ReturnType<typeof prepareNativeRequestBody>>;
  try {
    preparation = await prepareNativeRequestBody(request, endpoint, decodedBody);
  } catch (error) {
    // Cancellation and unexpected stream/internal failures retain their existing propagation.
    if (request.signal.aborted) throw error;
    if (error instanceof NativeRequestBodyError) {
      return localRequestFailure(error.status, "invalid_request_error", error.message);
    }
    throw error;
  }
  if (preparation.kind === "rejected") return preparation.response;
  const { body, model, compactionRequest } = preparation;
  if (preparation.kind === "rewritten") headers.delete("content-encoding");
  const upstreamRequest = new Request(`${CODEX_BACKEND}/${endpoint}${incomingUrl.search}`, {
    method,
    headers,
    ...(body ? { body } : {}),
    signal: request.signal,
    // Preserve redirects as responses. Native POSTs create work and must not be replayed, while
    // every endpoint carries account-scoped headers that must stay on the exact trusted origin.
    redirect: "manual",
  });
  const telemetryEndpoint = endpoint === "responses" || endpoint === "responses/compact"
    ? (compactionRequest ? "responses/compact" : endpoint)
    : undefined;
  // A receipt for a request whose response body was never observed, so no usage was reported.
  const reportUnobserved = (
    telemetry: NativeUsageTelemetryEvent["endpoint"],
    outcome: NativeUsageOutcome,
    httpStatus: number,
    failureCategory: NativeUsageFailureCategory | null,
  ): void => enqueueNativeUsageTelemetry({
    endpoint: telemetry,
    requestedModelId: model ?? null,
    reportedModelId: null,
    startedAt: telemetryStartedAt,
    durationMs: Math.max(0, Math.round(Date.now() - telemetryStartedAtMs)),
    outcome,
    httpStatus,
    failureCategory,
    usageStatus: "unreported",
    usage: null,
  });
  let upstream: Response;
  try {
    upstream = await fetchUpstream(upstreamRequest);
  } catch (error) {
    if (telemetryEndpoint) {
      const aborted = request.signal.aborted
        || (error instanceof DOMException && error.name === "AbortError");
      reportUnobserved(telemetryEndpoint, aborted ? "aborted" : "failed", 0, aborted ? "aborted" : "transport");
    }
    throw error;
  }
  if (compactionRequest && !upstream.ok) {
    console.warn(`[codex-chatgpt-web] native_compaction_upstream_failed ${JSON.stringify({
      endpoint, model, status: upstream.status,
      requestId: nativeDiagnosticId(upstream.headers.get("x-request-id")),
      cfRay: nativeDiagnosticId(upstream.headers.get("cf-ray")),
    })}`);
  }
  const responseHeaders = endToEndHeaders(upstream.headers);
  // NativeFetch exposes decoded bodies on every endpoint, including upstream errors.
  // Retaining gzip/br would make the downstream client decode those bytes twice.
  responseHeaders.delete("content-encoding");
  const isEventStream = (upstream.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/event-stream");
  const tolerantBody = upstream.body
    ? withUncleanCloseTolerance(upstream.body, isEventStream, bytes => {
        console.warn(
          `[codex-chatgpt-web] native_upstream_unclean_close endpoint=${endpoint} bytes=${bytes}`
          + " (turn had already completed; closing the client stream normally)",
        );
      })
    : upstream.body;
  let responseBody = tolerantBody;
  if (telemetryEndpoint) {
    if (tolerantBody) {
      responseBody = observeNativeResponseBody(tolerantBody, {
        endpoint: telemetryEndpoint,
        requestedModelId: model ?? null,
        startedAt: telemetryStartedAt,
        startedAtMs: telemetryStartedAtMs,
        httpStatus: upstream.status,
        eventStream: isEventStream,
        signal: request.signal,
      });
    } else {
      const failureCategory = failureCategoryForHttp(upstream.status);
      reportUnobserved(telemetryEndpoint, failureCategory ? "failed" : "completed", upstream.status, failureCategory);
    }
  }
  return new Response(
    responseBody,
    {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    },
  );
}
