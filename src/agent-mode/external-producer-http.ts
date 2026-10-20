import { NativeRequestBodyError, readJsonRequestBody } from '../http-body';
import { z } from 'zod';
import { producerCheck, producerAdminSchema, producerEventSchema, producerCredentialHash, LOOP_PRODUCER_TOKEN, ExternalProducerConflict } from './external-producer-types';
import type { AgentModeRuntime } from './runtime';
const peers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const prefix = '/api/loop-events/v1/';
const identity = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const success = (value: unknown, status = 200) => Response.json({ apiVersion: '1', ok: true, value }, { status, headers: { 'cache-control': 'no-store' } });
const failure = (error: string, status: number, outcome: 'not_started' | 'unknown' = 'not_started') => Response.json({ apiVersion: '1', ok: false, error, outcome }, { status, headers: { 'cache-control': 'no-store' } });
/** Separate submit credential. Its token namespace is rejected on every foreign route.
 * runtime() is passive: an external request must never open/recover/start an Agent owner. */
export function createAgentLoopProducerRoutes(options: {
  runtime(): AgentModeRuntime | undefined; authorizeAdmin(request: Request): boolean;
  localGuard(request: Request, url: URL, port: number): Response | undefined; port(): number;
  peerAddress(request: Request): string | undefined; canStart?(): boolean;
}) {
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url), token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
    const admin = url.pathname === '/admin/agent-loop-producers';
    if (!admin && !url.pathname.startsWith(prefix) && !token.startsWith('nk-loop-')) return;
    const guard = options.localGuard(request, url, options.port()); if (guard) return guard;
    if (!peers.has(options.peerAddress(request) ?? '')) return failure('loopback_peer_required', 403);
    try {
      if (!admin && !url.pathname.startsWith(prefix)) return failure('producer_credential_route_forbidden', 403);
      if (admin) {
        if (token.startsWith('nk-loop-') || token.startsWith('nk-read-') || !options.authorizeAdmin(request)) return failure('admin_authority_required', 403);
        if (request.method !== 'POST') return failure('method_not_allowed', 405);
        const body = producerAdminSchema.parse(await readJsonRequestBody(request, 16 * 1024, 16 * 1024));
        producerCheck(!/nk-loop-[a-f0-9]{64}/.test(JSON.stringify(body)), 'producer_credential_in_payload');
        if (['review', 'register', 'rotate'].includes(body.action) && options.canStart?.() === false) return failure('producer_admission_closed', 409);
        const runtime = options.runtime(); if (!runtime) return failure('producer_owner_unavailable', 503);
        if (body.action === 'status') return success({ status: runtime.externalProducerStatus(body.taskId) });
        if (body.action === 'action-receipt') return success(runtime.externalProducerActionReceipt(body.actionId));
        if (body.action === 'review') return success(runtime.reviewExternalProducer(body));
        if (body.action === 'register') return success(runtime.registerExternalProducer(body));
        if (body.action === 'rotate') return success(runtime.rotateExternalProducer(body));
        return success(runtime.revokeExternalProducer(body.producerId));
      }
      if (!LOOP_PRODUCER_TOKEN.test(token)) return failure('producer_credential_required', 403);
      const runtime = options.runtime(); if (!runtime) return failure('producer_owner_unavailable', 503);
      const credentialHash = producerCredentialHash(token);
      if (url.pathname === prefix + 'events') {
        if (request.method !== 'POST' || url.search) return failure('method_or_query_not_allowed', 405);
        if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') return failure('json_required', 415);
        const body = producerEventSchema.parse(await readJsonRequestBody(request, 32 * 1024, 32 * 1024));
        producerCheck(!/nk-loop-[a-f0-9]{64}/.test(JSON.stringify(body)), 'producer_credential_in_payload');
        if (options.canStart?.() === false) return failure('producer_admission_closed', 409);
        return success(runtime.publishExternalProducerEvent(credentialHash, body), 202);
      }
      const parts = url.pathname.slice(prefix.length).split('/');
      if (parts.length === 3 && parts[0] === 'receipts' && identity.test(parts[1]!) && identity.test(parts[2]!)) {
        if (request.method !== 'GET' || url.search) return failure('method_or_query_not_allowed', 405);
        return success(runtime.externalProducerReceipt(credentialHash, parts[1]!, parts[2]!));
      }
      return failure('producer_route_not_found', 404);
    } catch (error) {
      if (error instanceof NativeRequestBodyError) return failure('invalid_producer_body', error.status);
      if (error instanceof z.ZodError) return failure('invalid_producer_request', 400);
      if (error instanceof ExternalProducerConflict) return failure(error.code, error.code === 'producer_credential_rejected' ? 403 : 409);
      // Storage/transport exceptions cannot certify that a durable transaction did not commit.
      return failure('producer_observation_unavailable', 503, 'unknown');
    }
  };
}
