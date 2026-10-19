import type { NativeInventoryWrapperPin } from './native-account-inventory.cjs';
export const NATIVE_PUBLISHER_TEAM_ID: 'CNMWGJF2CG';
export const NATIVE_HELPER_IDENTIFIER: 'dev.nekodex.owned-native-worker.v1';
/** Trusted-main only. Actual process resources/executable origin, never renderer claims. */
export function reviewedOwnedNativeProductionPin(input:{resourcesPath:string;executablePath?:string}):NativeInventoryWrapperPin;
/** Signature/static probe admission; no app-server/profile is launched. */
export function verifyOwnedNativeProductionWrapper(executable:string,sha256:string,pin:NativeInventoryWrapperPin['wrapperBuildPin']):void;
/** Pre-seal packaging producer. Preserves original build provenance and hashes the signed copy separately. */
export function createOwnedNativeProductionManifest(input:{sourceRoot:string;executable:string;target:string}):Record<string,unknown>;
/** Pure fixed-file closure check; provides no signature or runtime acceptance proof. */
export function validateOwnedNativeProductionManifest(input:{sourceRoot:string;executable:string;target:string}):Record<string,unknown>;
export function readProductionNativeBootstrap(pin:NativeInventoryWrapperPin):Buffer;
