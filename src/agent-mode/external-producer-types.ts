import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AgentLoopSourceAuthority } from './types';
export const LOOP_PRODUCER_TOKEN = /^nk-loop-[a-f0-9]{64}$/;
export const LOOP_MAILBOX_QUOTA = 512;
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
export const producerScopeSchema = z.object({ familyId: identity, generation: z.number().int().positive(), revision: z.number().int().positive() }).strict();
const substantive = (value: string) => !/^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(value.trim());
export const producerRegistrationSchema = z.object({ action: z.literal('register'), actionId: identity, taskId: identity,
  scope: producerScopeSchema, runId: identity, label: z.string().trim().min(1).max(160), instruction: z.string().trim().min(1).max(4096).refine(value => Buffer.byteLength(value) <= 4096).refine(substantive),
  eventBound: z.number().int().min(1).max(LOOP_MAILBOX_QUOTA), credentialHash: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict();
export const producerRotationSchema = z.object({ action: z.literal('rotate'), actionId: identity, producerId: identity, credentialHash: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict();
export const producerEventSchema = z.object({ producerId: identity, eventId: identity, sourceEventKey: identity,
  subject: z.string().trim().min(1).max(512).refine(value => Buffer.byteLength(value) <= 512), observationText: z.string().trim().min(1).max(8192).refine(value => Buffer.byteLength(value) <= 8192).refine(substantive), observedAt: z.string().datetime().max(64) }).strict();
export const producerReviewSchema = producerRegistrationSchema.omit({ action: true, actionId: true, credentialHash: true, runId: true }).extend({ action: z.literal('review') }).strict();
export const producerAdminSchema = z.discriminatedUnion('action', [producerRegistrationSchema, producerRotationSchema, producerReviewSchema,
  z.object({ action: z.literal('status'), taskId: identity.optional() }).strict(),
  z.object({ action: z.literal('action-receipt'), actionId: identity }).strict(),
  z.object({ action: z.literal('revoke'), producerId: identity, explicitUserAction: z.literal(true) }).strict()]);
export type ProducerRegistration = z.infer<typeof producerRegistrationSchema>;
export type ProducerRotation = z.infer<typeof producerRotationSchema>;
export type ProducerEvent = z.infer<typeof producerEventSchema>;
export interface ExternalProducerRecord {
  version: 1; producerId: string; taskId: string; label: string; instruction: string; eventBound: number; acceptedEvents: number;
  credentialHash: string; registrationActionId: string; registrationFingerprint: string; rotationActions: Array<{ actionId: string; fingerprint: string }>;
  authority: AgentLoopSourceAuthority; revoked: boolean; createdAt: number;
}
export interface ExternalProducerReceipt {
  producerId: string; eventId: string; sourceEventKey: string; fingerprint: string; observationDigest: string;
  state: 'accepted' | 'unchanged'; workId?: string; workKey?: string; taskId: string; generation: number; revision: number; createdAt: number;
}
export class ExternalProducerConflict extends Error {
  constructor(readonly code: string) { super(code); }
}
export function producerCheck(value: unknown, code: string): asserts value { if (!value) throw new ExternalProducerConflict(code); }
export function producerCanonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(producerCanonical).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + producerCanonical((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new ExternalProducerConflict('invalid_producer_json');
}
export const producerDigest = (value: unknown) => createHash('sha256').update(producerCanonical(value)).digest('hex');
export const producerCredentialHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function producerRegistrationFingerprint(value: ProducerRegistration) {
  const { credentialHash: _credentialHash, ...publicInput } = value; return producerDigest(publicInput);
}

export function producerHashesEqual(a: string, b: string): boolean { return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
