import type { Stats } from "node:fs";
/** A private preimage. Never publish bytes through status/event channels. */
export interface CapturedWorkspaceFile {
  path: string; revision: string | null; bytes: string | null; mode: number | null; contentHash?: string;
}
export type WorkspaceDirectoryChain = Array<[path: string, deviceAndInode: string]>;
export const CAPTURE_LIMITS: Readonly<{ files: number; fileBytes: number; snapshotBytes: number }>;
/** Rejects escaping/reserved paths; returns the validated workspace-relative path. */
export function relative(value: string): string;
/** Validates 1..64 unique relative paths. */
export function selectedPaths(values: string[]): string[];
/** Captures full directory ancestry while refusing symlinks and non-directory ancestors. */
export function chain(directory: string): WorkspaceDirectoryChain;
export function assertChain(captured: WorkspaceDirectoryChain): void;
/** A safe write boundary; revalidate parents and expected content immediately before replacing a file. */
export function targetFile(root: string, path: string): { target: string; parents: WorkspaceDirectoryChain; stat: Stats | null };
/** The caller supplies a trusted canonical root; this function grants no root authority. */
export function captureFile(root: string, path: string): CapturedWorkspaceFile;
/** Validates 1..64 unique paths. Each file <=256 KiB; total <=4 MiB. Existing safe parent directories are required. */
export function captureFiles(root: string, paths: string[]): CapturedWorkspaceFile[];
